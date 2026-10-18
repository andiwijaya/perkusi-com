import { fail } from "../project/instrument-contract.js";
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
// AudioParam.setTargetAtTime's existing4ms law. State is evaluated at each
// absolute boundary before a new target, never inferred from AudioParam.value.
export function canonicalRamp(rows, rate) {
  const schedule = [];
  for (const r of rows) {
    const previous = schedule.at(-1);
    const from = previous
      ? previous.target.map(
          (t, i) =>
            t +
            (previous.from[i] - t) *
              // A new native target starts from the last rendered sample,
              // not one extra step of the superseded exponential.
              Math.exp(
                -Math.max(0, r.frame - 1 - previous.frame) / (0.004 * rate),
              ),
        )
      : r.values;
    schedule.push({
      frame: r.frame,
      target: r.values.map(f32),
      from: from.map(f32),
    });
  }
  return Object.freeze({
    at(frame) {
      let low = 0,
        high = schedule.length;
      while (low + 1 < high) {
        const mid = (low + high) >> 1;
        if (schedule[mid].frame <= frame) low = mid;
        else high = mid;
      }
      const r = schedule[low],
        decay = Math.exp(-Math.max(0, frame - r.frame) / (0.004 * rate));
      return r.target.map((t, i) => f32(t + (r.from[i] - t) * decay));
    },
  });
}

// Internal preparation kernel. Sources are already loaded/checked/accounted by
// canonical-score; output/native-view/curve allowances are reserved beforehand.
// It is isolated from the Q1c.a finite reference kernel and active consumers.
export async function renderCanonicalRun(
  run,
  { rate, entry, createBuffer, check, yieldTask = renderYield },
) {
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
    const states = segments.map((s) => s.phrases.find((x) => x.role === role));
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
            ? (((state.startFrame - current.anchor) % (5 * rate)) + 5 * rate) %
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
  check();
  const output = createBuffer(2, end - begin, rate),
    cs = [output.getChannelData(0), output.getChannelData(1)];
  for (const lane of lanes)
    for (const v of lane.kind === "shot" ? lane.shots : lane.voices) {
      const b = v.entry.buffer,
        data = [b.getChannelData(0), b.getChannelData(b.numberOfChannels - 1)];
      const phrase = lane.kind === "phrase",
        start = phrase ? v.start : v.startFrame;
      const level = f32(v.entry.stem.gainTrim * (phrase ? 1 : v.velocity));
      for (let block = start; block < v.end; block += 32768) {
        check();
        for (
          let frame = block;
          frame < Math.min(v.end, block + 32768);
          frame++
        ) {
          const relative = phrase ? frame - v.anchor : frame - start;
          const at = phrase
            ? ((relative * b.length) / (5 * rate)) % b.length
            : relative;
          const i = Math.floor(at),
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
                );
          const vg = f32(level * envelope),
            left = f32(
              f32(
                f32(data[0][i] + fraction * (data[0][next] - data[0][i])) * vg,
              ) * mix[0],
            );
          const right = f32(
              f32(
                f32(data[1][i] + fraction * (data[1][next] - data[1][i])) * vg,
              ) * mix[0],
            ),
            n = frame - begin;
          cs[0][n] = f32(
            cs[0][n] + f32(f32(left * matrix[0]) + f32(right * matrix[1])),
          );
          cs[1][n] = f32(
            cs[1][n] + f32(f32(left * matrix[2]) + f32(right * matrix[3])),
          );
        }
        await yieldTask();
        check();
      }
    }
  const curve = Float32Array.from({ length: 65537 }, (_, i) => {
    const x = i / 32768 - 1,
      a = Math.abs(x);
    return a <= 0.7
      ? x
      : Math.sign(x) *
          (0.7 + 0.2 * (1 - (1 - Math.min(1, (a - 0.7) / 0.3)) ** 1.5));
  });
  let peak = 0;
  for (let block = 0; block < output.length; block += 32768) {
    check();
    for (let n = block; n < Math.min(output.length, block + 32768); n++)
      for (const channel of cs) {
        const master = f32(
          first.composition.masterVolume *
            (run.continuous ? 1 : Math.min(1, (bodyEnd - begin - n) / release)),
        );
        const x = Math.max(-1, Math.min(1, f32(f32(channel[n] * master) * 3))),
          pos = (x + 1) * 32768,
          i = Math.min(65535, Math.floor(pos));
        channel[n] = f32(curve[i] + (pos - i) * (curve[i + 1] - curve[i]));
        peak = Math.max(peak, Math.abs(channel[n]));
      }
    await yieldTask();
    check();
  }
  return {
    buffer: output,
    peak,
    startFrame: begin,
    endFrame: end,
    maxLogicalVoices,
    phaseStates: Object.freeze(phaseStates),
  };
}
