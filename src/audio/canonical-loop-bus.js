import { fail } from "../project/instrument-contract.js";
import { shotEnvelope, panMatrix, releaseFrames } from "./frame-dsp.js";
import { quiescentCanonicalLoopSource } from "./canonical-loop-bounds.js";

const f32 = Math.fround;
const identity = (a, b) =>
  JSON.stringify(a.identity) === JSON.stringify(b.identity);
const clipPan = (pan) => [
  pan === 0 ? 1 : Math.SQRT2 * Math.cos(((pan + 1) * Math.PI) / 4),
  pan === 0 ? 1 : Math.SQRT2 * Math.sin(((pan + 1) * Math.PI) / 4),
];
function ramp() {
  let previous = null;
  const out = [];
  return {
    set(frame, values, rate) {
      const from = previous
        ? previous.target.map(
            (t, i) =>
              t +
              (previous.from[i] - t) *
                Math.exp(
                  -Math.max(0, frame - 1 - previous.frame) / (0.004 * rate),
                ),
          )
        : values;
      previous = { frame, target: values.map(f32), from: from.map(f32) };
    },
    at(frame, rate) {
      const decay = Math.exp(
        -Math.max(0, frame - previous.frame) / (0.004 * rate),
      );
      for (let i = 0; i < previous.target.length; i++)
        out[i] = f32(
          previous.target[i] + (previous.from[i] - previous.target[i]) * decay,
        );
      return out;
    },
  };
}

// A single composition run owns its nonlinear inner mix, control ramps and
// continuing phrase anchors. Full-span continuous runs keep this SAME state
// across song boundaries; gaps/restarts get independently released runs.
// Cache/source-window/curve bytes are reserved by the bounded producer pool.
export function createCanonicalLoopBus(
  template,
  {
    clock,
    rate,
    cycleTick,
    periodTicks,
    stopTick,
    sourceWindows,
    curve,
    acquireCache,
  },
) {
  const firstTick = cycleTick + template.startTick,
    startFrame = clock.frame(firstTick),
    release = releaseFrames(rate),
    p = template.programme,
    quiescent = quiescentCanonicalLoopSource(template);
  const lanes = [];
  for (const [i, row] of p.percussion.entries())
    lanes.push({
      kind: "shot",
      role: row.role,
      index: i,
      mix: ramp(),
      voices: [],
      pan: row.pan,
    });
  for (const role of template.roles)
    lanes.push({
      kind: "phrase",
      role,
      mix: ramp(),
      voices: [],
      current: null,
      previous: null,
    });
  lanes.push({
    kind: "shot",
    role: "bilah",
    mix: ramp(),
    voices: [],
    pan: p.bilah.pan,
  });
  const byRole = new Map(
    lanes.filter((l) => l.kind === "shot").map((l) => [l.role, l]),
  );
  let segmentIndex = 0,
    shotIndex = 0,
    segmentCycle = cycleTick,
    shotCycle = cycleTick,
    cursor = startFrame,
    cache = null,
    cachedBlock = -1,
    disposed = false,
    fault = null,
    exitApplied = false,
    cachedTerminal = null,
    cachedEnd = null;
  const segmentAt = () => template.segments[segmentIndex],
    shotAt = () => template.shots[shotIndex];
  const endTick = () =>
    Math.min(
      stopTick(),
      template.continuous ? Infinity : cycleTick + template.endTick,
    );
  function tailEnd() {
    const end = endTick();
    if (end === cachedTerminal) return cachedEnd;
    cachedTerminal = end;
    if (!Number.isFinite(end)) return (cachedEnd = 2 ** 42);
    let finish = clock.frame(end);
    // A previous identical period's natural end cannot exceed the last one's.
    const offset = template.continuous
      ? Math.max(cycleTick, Math.floor((end - 1) / periodTicks) * periodTicks)
      : cycleTick;
    const shots = template.shots.filter((s) => s.tick + offset < end);
    for (const [i, s] of shots.entries()) {
      const next = shots.slice(i + 1).find((t) => t.role === s.role),
        from = clock.frame(s.tick + offset);
      finish = Math.max(
        finish,
        Math.min(
          from + s.entry.buffer.length,
          next ? clock.frame(next.tick + offset) + release : Infinity,
        ),
      );
    }
    const last = template.segments.findLast((s) => s.tick + offset < end);
    if (last?.phrases.some((s) => s.control.enabled))
      finish = Math.max(finish, clock.frame(end) + release);
    return (cachedEnd = finish);
  }
  function advanceSegment() {
    segmentIndex++;
    if (segmentIndex === template.segments.length && template.continuous) {
      segmentIndex = 0;
      segmentCycle += periodTicks;
    }
  }
  function advanceShot() {
    shotIndex++;
    if (
      shotIndex === template.shots.length &&
      template.continuous &&
      template.shots.length
    ) {
      shotIndex = 0;
      shotCycle += periodTicks;
    }
  }
  function exit(frame) {
    if (exitApplied) return;
    exitApplied = true;
    for (const lane of lanes)
      if (lane.current) {
        lane.current.releaseAt = frame;
        lane.current.end = frame + release;
        lane.current = null;
      }
  }
  function controls(frame, segment) {
    for (const lane of lanes) {
      if (lane.kind === "shot")
        lane.mix.set(
          frame,
          [
            lane.role === "bilah"
              ? segment.bilahGain
              : segment.percussionGains[lane.index],
          ],
          rate,
        );
      else {
        const state = segment.phrases.find((s) => s.role === lane.role),
          control = state.control,
          continuing =
            lane.current &&
            control.enabled &&
            identity(lane.previous, control) &&
            control.phasePolicy === "continue-source";
        lane.mix.set(frame, [state.gain, ...clipPan(control.pan)], rate);
        if (lane.current && !continuing) {
          lane.current.end = frame + release;
          lane.current.releaseAt = frame;
          lane.current = null;
        }
        if (control.enabled && !lane.current) {
          const phase = lane.previous === null ? (state.phaseFrame ?? 0) : 0;
          lane.current = {
            start: frame,
            anchor: frame - phase,
            end: Infinity,
            releaseAt: null,
            entry: state.entry,
          };
          lane.voices.push(lane.current);
        }
        lane.previous = control;
      }
    }
  }
  function sample(frame, out, n) {
    const terminal = endTick();
    while (
      segmentAt() &&
      segmentAt().tick + segmentCycle < terminal &&
      clock.frame(segmentAt().tick + segmentCycle) <= frame
    ) {
      const s = segmentAt();
      controls(clock.frame(s.tick + segmentCycle), s);
      advanceSegment();
    }
    while (
      shotAt() &&
      shotAt().tick + shotCycle < terminal &&
      clock.frame(shotAt().tick + shotCycle) <= frame
    ) {
      const s = shotAt(),
        at = clock.frame(s.tick + shotCycle),
        lane = byRole.get(s.role);
      for (const v of lane.voices)
        if (v.choke === null) {
          v.choke = at;
          v.end = Math.min(v.end, at + release);
        }
      lane.voices.push({
        start: at,
        end: at + s.entry.buffer.length,
        choke: null,
        entry: s.entry,
        velocity: s.velocity,
        matrix: panMatrix(lane.pan, s.entry.buffer.numberOfChannels === 1),
      });
      advanceShot();
    }
    if (Number.isFinite(terminal) && frame >= clock.frame(terminal))
      exit(clock.frame(terminal));
    let count = 0,
      left = 0,
      right = 0;
    for (const lane of lanes) {
      for (let i = lane.voices.length - 1; i >= 0; i--)
        if (lane.voices[i].end <= frame) lane.voices.splice(i, 1);
      count += lane.voices.length;
      if (count > 16) fail("voiceLimit");
      if (!lane.voices.length) continue;
      const mix = lane.mix.at(frame, rate);
      for (const v of lane.voices) {
        const b = v.entry.buffer,
          phrase = lane.kind === "phrase",
          relative = phrase ? frame - v.anchor : frame - v.start,
          at = phrase
            ? ((relative * b.length) / (5 * rate)) % b.length
            : relative,
          i = Math.floor(at),
          next = (i + 1) % b.length,
          fraction = at - i,
          envelope = phrase
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
                v.choke === null ? null : v.choke - v.start,
              ),
          level = f32(v.entry.stem.gainTrim * (phrase ? 1 : v.velocity)),
          vg = f32(level * envelope),
          a = sourceWindows.read(b, 0, i),
          aa = sourceWindows.read(b, 0, next),
          z = sourceWindows.read(b, b.numberOfChannels - 1, i),
          zz = sourceWindows.read(b, b.numberOfChannels - 1, next),
          l = f32(f32(f32(a + fraction * (aa - a)) * vg) * mix[0]),
          r = f32(f32(f32(z + fraction * (zz - z)) * vg) * mix[0]),
          matrix = phrase ? [mix[1], 0, 0, mix[2]] : v.matrix;
        left = f32(left + f32(f32(l * matrix[0]) + f32(r * matrix[1])));
        right = f32(right + f32(f32(l * matrix[2]) + f32(r * matrix[3])));
      }
    }
    const master = f32(template.master);
    for (const [c, value] of [
      [0, left],
      [1, right],
    ]) {
      const x = Math.max(-1, Math.min(1, f32(f32(value * master) * 3))),
        pos = (x + 1) * 32768,
        index = Math.min(65535, Math.floor(pos));
      out[c][n] = f32(
        curve[index] + (pos - index) * (curve[index + 1] - curve[index]),
      );
    }
  }
  function render(block) {
    if (disposed) fail("memoryReleased");
    if (fault) throw fault;
    if (block === cachedBlock) return;
    const from = startFrame + block * 2048;
    if (from !== cursor) fail("canonicalLoopSourceOrder");
    cache ??= acquireCache();
    try {
      for (const c of cache.channels) c.fill(0);
      const end = Math.min(from + 2048, tailEnd());
      for (let frame = from; frame < end; frame++)
        sample(frame, cache.channels, frame - from);
      cursor = from + 2048;
      cachedBlock = block;
    } catch (e) {
      fault = e;
      throw e;
    }
  }
  const buffer = Object.freeze({
    numberOfChannels: 2,
    sampleRate: rate,
    get length() {
      return Math.max(1, tailEnd() - startFrame);
    },
    getChannelData() {
      fail("boundedRunViewRequired");
    },
    copyFromChannel(target, channel, from = 0) {
      if (disposed) fail("memoryReleased");
      if (
        !(target instanceof Float32Array) ||
        target.length > 2048 ||
        ![0, 1].includes(channel) ||
        !Number.isInteger(from) ||
        from < 0
      )
        fail("invalidRunWindow");
      target.fill(0);
      if (quiescent) {
        cursor = Math.max(cursor, startFrame + from + target.length);
        return;
      }
      let copied = 0;
      while (copied < target.length && from + copied < buffer.length) {
        const at = from + copied,
          block = Math.floor(at / 2048),
          local = at % 2048;
        render(block);
        const n = Math.min(
          target.length - copied,
          2048 - local,
          buffer.length - at,
        );
        target.set(cache.channels[channel].subarray(local, local + n), copied);
        copied += n;
      }
    },
  });
  return {
    buffer,
    startFrame,
    get endFrame() {
      return tailEnd();
    },
    get renderedThrough() {
      return cursor;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cache?.release();
      cache = null;
      for (const l of lanes) {
        l.voices.length = 0;
        l.current = null;
        l.previous = null;
      }
      lanes.length = 0;
      byRole.clear();
      template = sourceWindows = curve = null;
    },
  };
}
