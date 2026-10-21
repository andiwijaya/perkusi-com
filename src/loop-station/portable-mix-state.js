import { eqGains, limiterEnabled, softLimit } from "./fx-model.js";
import { panMatrix } from "../audio/frame-dsp.js";
import { SourceWindows } from "./source-windows.js";
import { portableMixBytes } from "./portable-mix.js";
import { fail } from "../project/instrument-contract.js";

const f32 = Math.fround;
// Incremental mix/EQ kernel for canonical continuous transport and finite
// verification. Callers own source loans and output chunks; this lease owns the
// persistent mixer/FX/window state until explicit disposal, including faults.
export function createPortableMixState(
  project,
  program,
  { memory, boundedSourceViews = true, eventSource = null } = {},
) {
  if (
    !Number.isSafeInteger(program.frames) ||
    program.frames < 1 ||
    !Number.isInteger(program.rate) ||
    program.rate < 8000 ||
    program.rate > 192000
  )
    fail("invalidLoopPlan");
  let held = memory.reserve(
    portableMixBytes(project, program, { boundedSourceViews }) +
      (program.events.length + (eventSource ? 16 : 0)) * 256 +
      65536,
    "portable-mix/persistent-state",
  );
  let mapEvent,
    events,
    tracks,
    inputs,
    windows,
    views,
    curve,
    active = [],
    cursor = 0,
    frame = 0,
    disposed = false,
    fault = null;
  try {
    const solo = project.tracks.some((t) => t.solo),
      indices = new Map(project.tracks.map((t, i) => [t.id, i]));
    views = new Map();
    windows = boundedSourceViews ? new SourceWindows() : null;
    tracks = project.tracks.map((t) => {
      const g = eqGains(t.eq);
      return {
        gain: f32(t.mute || (solo && !t.solo) ? 0 : t.gain),
        matrix: panMatrix(f32(t.pan)),
        g: [f32(g.high), f32(g.upper), f32(g.lower)],
        active: g.high !== 1 || g.upper !== 0 || g.lower !== 0,
        low: [0, 0],
        upper: [0, 0],
      };
    });
    mapEvent = (e) => {
      const b = e.spec.buffer;
      if (!boundedSourceViews && !views.has(b))
        views.set(
          b,
          Array.from({ length: b.numberOfChannels }, (_, c) =>
            b.getChannelData(c),
          ),
        );
      return {
        ...e.spec,
        track: indices.get(e.trackId),
        data: views.get(b),
        level: f32(e.spec.velocity * 0.25),
        scale: f32(e.spec.scale),
        matrix:
          e.spec.pan === 0
            ? [1, 0, 0, 1]
            : panMatrix(f32(e.spec.pan), b.numberOfChannels === 1),
      };
    };
    events = program.events
      .map(mapEvent)
      .sort((a, b) => a.startFrame - b.startFrame || a.track - b.track);
    inputs = new Float32Array(tracks.length * 2);
    curve = limiterEnabled(project.master)
      ? Float32Array.from({ length: 65537 }, (_, i) => softLimit(i / 32768 - 1))
      : null;
  } catch (error) {
    held.release();
    throw error;
  }
  const a = Math.exp((-2 * Math.PI * 200) / program.rate),
    b = Math.exp((-2 * Math.PI * 3000) / program.rate),
    dampFrames = Math.round(0.02 * program.rate),
    master = f32(project.master.volume);
  function renderInto(channels) {
    if (disposed) fail("memoryReleased");
    if (fault) throw fault;
    if (
      ![2, 4].includes(channels?.length) ||
      channels.some(
        (c) => !(c instanceof Float32Array) || c.length !== channels[0].length,
      ) ||
      channels[0].length < 1 ||
      channels[0].length > 4096 ||
      channels.some((c, i) =>
        channels
          .slice(0, i)
          .some(
            (p) =>
              p.buffer === c.buffer &&
              p.byteOffset < c.byteOffset + c.byteLength &&
              c.byteOffset < p.byteOffset + p.byteLength,
          ),
      )
    )
      fail("invalidRenderChunk");
    const from = frame,
      count = Math.min(channels[0].length, program.frames - frame);
    for (const c of channels) c.fill(0);
    try {
      for (let n = 0; n < count; n++, frame++) {
        eventSource?.beforeFrame?.(frame, active);
        for (let i = active.length - 1; i >= 0; i--)
          if (active[i].endFrame <= frame) active.splice(i, 1);
        while (cursor < events.length && events[cursor].startFrame <= frame) {
          const e = events[cursor++];
          if (e.endFrame > frame) active.push(e);
        }
        while (eventSource && eventSource.nextFrame <= frame) {
          if (active.length >= 16) fail("voiceLimit");
          const e = mapEvent(eventSource.take(frame));
          if (e.endFrame > frame) active.push(e);
        }
        if (active.length > 16) fail("voiceLimit");
        inputs.fill(0);
        for (const e of active) {
          const at = e.loopFrames
              ? (((frame - e.startFrame + (e.phaseOffsetFrames ?? 0)) %
                  e.loopFrames) +
                  e.loopFrames) %
                e.loopFrames
              : frame - e.startFrame,
            level =
              e.dampFrame !== null && frame >= e.dampFrame
                ? f32(
                    e.level *
                      Math.max(0, 1 - (frame - e.dampFrame) / dampFrames),
                  )
                : e.level,
            l = f32(
              f32(
                (windows ? windows.read(e.buffer, 0, at) : e.data[0][at]) *
                  level,
              ) * e.scale,
            ),
            r = f32(
              f32(
                (windows
                  ? windows.read(e.buffer, e.buffer.numberOfChannels - 1, at)
                  : e.data[e.data.length - 1][at]) * level,
              ) * e.scale,
            ),
            m = e.matrix,
            i = e.track * 2;
          inputs[i] = f32(inputs[i] + f32(f32(l * m[0]) + f32(r * m[1])));
          inputs[i + 1] = f32(
            inputs[i + 1] + f32(f32(l * m[2]) + f32(r * m[3])),
          );
        }
        let left = 0,
          right = 0;
        for (let i = 0; i < tracks.length; i++) {
          const t = tracks[i],
            g = t.g,
            m = t.matrix;
          let l = f32(inputs[i * 2] * t.gain),
            r = f32(inputs[i * 2 + 1] * t.gain);
          if (t.active) {
            t.low[0] = (1 - a) * l + a * t.low[0];
            t.upper[0] = (1 - b) * l + b * t.upper[0];
            t.low[1] = (1 - a) * r + a * t.low[1];
            t.upper[1] = (1 - b) * r + b * t.upper[1];
            l = f32(
              f32(f32(l * g[0]) + f32(f32(t.upper[0]) * g[1])) +
                f32(f32(t.low[0]) * g[2]),
            );
            r = f32(
              f32(f32(r * g[0]) + f32(f32(t.upper[1]) * g[1])) +
                f32(f32(t.low[1]) * g[2]),
            );
          }
          left = f32(left + f32(f32(l * m[0]) + f32(r * m[1])));
          right = f32(right + f32(f32(l * m[2]) + f32(r * m[3])));
        }
        left = f32(left * master);
        right = f32(right * master);
        if (channels.length === 4) {
          channels[2][n] = left;
          channels[3][n] = right;
        }
        for (const [c, x] of [
          [0, left],
          [1, right],
        ]) {
          if (!Number.isFinite(x) || Math.abs(x) > 0.95) fail("unsafeOutput");
          if (curve) {
            const p = (x + 1) * 32768,
              i = Math.min(65535, Math.floor(p));
            channels[c][n] = f32(
              curve[i] + (p - i) * (curve[i + 1] - curve[i]),
            );
          } else channels[c][n] = x;
        }
      }
      return Object.freeze({
        from,
        frames: count,
        endFrame: frame,
        complete: frame === program.frames,
      });
    } catch (error) {
      fault = error;
      throw error;
    }
  }
  return Object.freeze({
    renderInto,
    snapshot: () => ({ frame, disposed, fault: fault?.code ?? null }),
    dispose() {
      if (disposed) return;
      disposed = true;
      active =
        events =
        tracks =
        inputs =
        windows =
        views =
        curve =
        mapEvent =
          null;
      held.release();
      held = null;
      program = project = memory = eventSource = null;
    },
  });
}
