import { fail } from "../project/instrument-contract.js";
import { canonicalRamp } from "./canonical-dynamic-render.js";
import {
  f32,
  shotEnvelope,
  panMatrix,
  releaseFrames,
  renderYield,
} from "./frame-dsp.js";
const sameIdentity = (a, b) =>
  JSON.stringify(a.identity) === JSON.stringify(b.identity);
const clipMatrix = (pan) => [
  pan === 0 ? 1 : Math.SQRT2 * Math.cos(((pan + 1) * Math.PI) / 4),
  pan === 0 ? 1 : Math.SQRT2 * Math.sin(((pan + 1) * Math.PI) / 4),
];
// Experimental, not connected to public playback. The immutable finite plan
// uses the established renderer's control/phase/choke preparation verbatim.
// Samples are generated in bounded windows, never a whole run AudioBuffer.
// Preparation provenance: 1274cc7bfbb3a79162d010fe515bbabbdbf3a69dbbd905b29310083004c3b581
export async function prepareCanonicalRunWindows(
  run,
  { rate, entry, memory, check = () => {}, yieldTask = renderYield } = {},
) {
  const itemCount = run.pieces.reduce(
      (n, p) =>
        n + p.composition.shots.length + p.composition.segments.length * 32,
      0,
    ),
    bytes = 65537 * 4 + 2048 * 8 + itemCount * 512 + 65536;
  if (bytes > 67108864) fail("combinedMemoryLimit");
  let held = memory.reserve(
      bytes,
      "canonical/lazy-run-curve-window-and-controls",
    ),
    disposed = false,
    fault = null,
    curve = null,
    cache = null;
  let dropPlan = () => {};
  try {
    check();
    const first = run.pieces[0],
      last = run.pieces.at(-1),
      p = run.source.programme;
    const begin = first.composition.startFrame,
      bodyEnd = last.composition.endFrame,
      release = releaseFrames(rate);
    const segments = run.pieces.flatMap((x) => x.composition.segments);
    const shots = run.pieces
      .flatMap((x) => x.composition.shots)
      .map((s) => ({ ...s }));
    const lanes = [],
      phaseStates = [];
    for (const [i, row] of p.percussion.entries())
      lanes.push({
        kind: "shot",
        role: row.role,
        mix: canonicalRamp(
          segments.map((s) => ({
            frame: s.startFrame,
            values: [s.percussionGains[i]],
          })),
          rate,
        ),
        matrix: panMatrix(row.pan),
        shots: shots.filter(
          (s) => s.kind === "percussion" && s.role === row.role,
        ),
      });
    const present =
      run.timeline.project.compatibility.rolePresence.find(
        (r) => r.sourceId === run.source.id,
      )?.roles ?? [];
    const clipOrder = [
      ...present,
      ...segments[0].phrases
        .map((s) => s.role)
        .filter((r) => !present.includes(r)),
    ];
    for (const role of clipOrder) {
      const states = segments.map((s) =>
        s.phrases.find((x) => x.role === role),
      );
      const mix = canonicalRamp(
        states.map((s) => ({
          frame: s.startFrame,
          values: [s.gain, ...clipMatrix(s.control.pan)],
        })),
        rate,
      );
      const voices = [];
      let current = null,
        previous = null;
      for (const state of states) {
        const continuing =
          current &&
          state.control.enabled &&
          sameIdentity(previous.control, state.control) &&
          state.control.phasePolicy === "continue-source";
        const action = state.control.enabled
          ? continuing
            ? "continue"
            : "restart"
          : current
            ? "exit"
            : "silent";
        if (current && !continuing) {
          current.end = state.startFrame + release;
          current.releaseAt = state.startFrame;
          current = null;
        }
        if (state.control.enabled && !current) {
          const phase = previous === null ? (state.phaseFrame ?? 0) : 0;
          current = {
            kind: "phrase",
            state,
            anchor: state.startFrame - phase,
            start: state.startFrame,
            end: bodyEnd + (run.continuous ? release : 0),
            releaseAt: run.continuous ? bodyEnd : null,
          };
          voices.push(current);
        }
        phaseStates.push(
          Object.freeze({
            ...state,
            trackId: run.trackId,
            action,
            anchorFrame: current?.anchor ?? null,
            sourceMaster: first.composition.masterVolume,
            phaseFrame: current
              ? (((state.startFrame - current.anchor) % (5 * rate)) +
                  5 * rate) %
                (5 * rate)
              : null,
          }),
        );
        previous = state;
      }
      lanes.push({ kind: "phrase", role, mix, voices });
    }
    lanes.push({
      kind: "shot",
      role: "bilah",
      mix: canonicalRamp(
        segments.map((s) => ({ frame: s.startFrame, values: [s.bilahGain] })),
        rate,
      ),
      matrix: panMatrix(p.bilah.pan),
      shots: shots.filter((s) => s.kind === "bilah"),
    });
    let end = bodyEnd;
    const points = [];
    for (const lane of lanes) {
      if (lane.kind === "shot")
        for (const [i, s] of lane.shots.entries()) {
          s.entry = entry(run.source, s);
          s.choke = lane.shots[i + 1]?.startFrame ?? null;
          s.end = Math.min(
            s.startFrame + s.entry.buffer.length,
            s.choke === null ? Infinity : s.choke + release,
            run.continuous ? Infinity : bodyEnd,
          );
          end = Math.max(end, s.end);
          points.push([s.startFrame, 1], [s.end, -1]);
        }
      else
        for (const v of lane.voices) {
          v.entry = entry(run.source, v.state);
          v.end = Math.min(v.end, run.continuous ? Infinity : bodyEnd);
          end = Math.max(end, v.end);
          points.push([v.start, 1], [v.end, -1]);
        }
    }
    // Internal preparation contributions retain the established16-voice bound,
    // including old/new phrase overlap. Pre-rendering cannot bypass this gate.
    let count = 0,
      maxLogicalVoices = 0;
    for (const [, delta] of points
      .filter(([frame]) => frame >= begin)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
      count += delta;
      maxLogicalVoices = Math.max(maxLogicalVoices, count);
    }
    if (maxLogicalVoices > 16) fail("voiceLimit");

    const frames = end - begin,
      cacheFrames = 2048;
    cache = [new Float32Array(cacheFrames), new Float32Array(cacheFrames)];
    curve = Float32Array.from({ length: 65537 }, (_, i) => {
      const x = i / 32768 - 1,
        a = Math.abs(x);
      return a <= 0.7
        ? x
        : Math.sign(x) *
            (0.7 + 0.2 * (1 - (1 - Math.min(1, (a - 0.7) / 0.3)) ** 1.5));
    });
    const views = new Map();
    for (const lane of lanes)
      for (const v of lane.kind === "shot" ? lane.shots : lane.voices) {
        const b = v.entry.buffer;
        if (!views.has(b))
          views.set(b, [
            b.getChannelData(0),
            b.getChannelData(b.numberOfChannels - 1),
          ]);
        v.data = views.get(b);
      }
    let cachedBlock = -1;
    const renderBlock = (block) => {
      if (disposed) fail("memoryReleased");
      if (fault) throw fault;
      try {
        check();
        if (cachedBlock === block) return;
        const from = block * cacheFrames,
          count = Math.min(cacheFrames, frames - from);
        for (const c of cache) c.fill(0);
        for (const lane of lanes)
          for (const v of lane.kind === "shot" ? lane.shots : lane.voices) {
            const b = v.entry.buffer,
              data = v.data,
              phrase = lane.kind === "phrase",
              start = phrase ? v.start : v.startFrame,
              level = f32(v.entry.stem.gainTrim * (phrase ? 1 : v.velocity));
            for (
              let frame = Math.max(start, begin + from);
              frame < Math.min(v.end, begin + from + count);
              frame++
            ) {
              const relative = phrase ? frame - v.anchor : frame - start,
                at = phrase
                  ? ((relative * b.length) / (5 * rate)) % b.length
                  : relative,
                i = Math.floor(at),
                next = (i + 1) % b.length,
                fraction = at - i;
              const envelope = phrase
                ? f32(
                    Math.min(1, relative / release) *
                      (v.releaseAt === null || frame < v.releaseAt
                        ? 1
                        : Math.max(0, 1 - (frame - v.releaseAt) / release)),
                  )
                : shotEnvelope(
                    relative,
                    b.length,
                    rate,
                    v.choke === null ? null : v.choke - start,
                  );
              const mix = lane.mix.at(frame),
                matrix = phrase
                  ? [mix[1], 0, 0, mix[2]]
                  : panMatrix(
                      lane.role === "bilah"
                        ? p.bilah.pan
                        : p.percussion.find((r) => r.role === lane.role).pan,
                      b.numberOfChannels === 1,
                    ),
                vg = f32(level * envelope);
              const left = f32(
                  f32(
                    f32(data[0][i] + fraction * (data[0][next] - data[0][i])) *
                      vg,
                  ) * mix[0],
                ),
                right = f32(
                  f32(
                    f32(data[1][i] + fraction * (data[1][next] - data[1][i])) *
                      vg,
                  ) * mix[0],
                ),
                n = frame - begin - from;
              cache[0][n] = f32(
                cache[0][n] +
                  f32(f32(left * matrix[0]) + f32(right * matrix[1])),
              );
              cache[1][n] = f32(
                cache[1][n] +
                  f32(f32(left * matrix[2]) + f32(right * matrix[3])),
              );
            }
          }
        for (let n = 0; n < count; n++)
          for (const channel of cache) {
            const master = f32(
                first.composition.masterVolume *
                  (run.continuous
                    ? 1
                    : Math.min(1, (bodyEnd - begin - from - n) / release)),
              ),
              x = Math.max(-1, Math.min(1, f32(f32(channel[n] * master) * 3))),
              pos = (x + 1) * 32768,
              i = Math.min(65535, Math.floor(pos));
            channel[n] = f32(curve[i] + (pos - i) * (curve[i + 1] - curve[i]));
            if (!Number.isFinite(channel[n])) fail("unsafeOutput");
          }
        check();
        cachedBlock = block;
      } catch (error) {
        fault = error;
        throw error;
      }
    };
    let peak = 0;
    for (let from = 0; from < frames; from += cacheFrames) {
      renderBlock(Math.floor(from / cacheFrames));
      for (const c of cache)
        for (let i = 0; i < Math.min(cacheFrames, frames - from); i++)
          peak = Math.max(peak, Math.abs(c[i]));
      await yieldTask();
      check();
    }
    dropPlan = () => {
      for (const lane of lanes) {
        lane.shots?.splice(0);
        lane.voices?.splice(0);
      }
      lanes.length = 0;
      points.length = 0;
      views.clear();
    };
    const buffer = Object.freeze({
      numberOfChannels: 2,
      length: frames,
      sampleRate: rate,
      duration: frames / rate,
      getChannelData() {
        fail("boundedRunViewRequired");
      },
      copyFromChannel(target, channel, sourceOffset = 0) {
        if (disposed) fail("memoryReleased");
        if (fault) throw fault;
        if (
          !(target instanceof Float32Array) ||
          target.length > cacheFrames ||
          ![0, 1].includes(channel) ||
          !Number.isInteger(sourceOffset) ||
          sourceOffset < 0 ||
          sourceOffset >= frames
        )
          fail("invalidRunWindow");
        target.fill(0);
        let copied = 0,
          at = sourceOffset;
        while (copied < target.length && at < frames) {
          const block = Math.floor(at / cacheFrames);
          renderBlock(block);
          const local = at - block * cacheFrames,
            n = Math.min(
              target.length - copied,
              cacheFrames - local,
              frames - at,
            );
          target.set(cache[channel].subarray(local, local + n), copied);
          copied += n;
          at += n;
        }
      },
    });
    entry = null;
    return Object.freeze({
      buffer,
      peak,
      startFrame: begin,
      endFrame: end,
      maxLogicalVoices,
      phaseStates: Object.freeze(phaseStates),
      release() {
        if (disposed) return;
        disposed = true;
        dropPlan();
        dropPlan = null;
        cache = curve = null;
        held.release();
        held = null;
        run = memory = check = yieldTask = null;
      },
    });
  } catch (error) {
    disposed = true;
    dropPlan();
    cache = curve = null;
    held.release();
    held = null;
    throw error;
  }
}
