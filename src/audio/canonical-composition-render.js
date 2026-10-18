import { assertCanonicalTimeline } from "../project/canonical-timeline.js";
import { sameData } from "../project/canonical-data.js";
import { fail } from "../project/instrument-contract.js";
import {
  f32,
  panMatrix,
  releaseFrames,
  shotEnvelope,
  renderYield,
} from "./frame-dsp.js";

// Bounded Q1c differential kernel, not an export/UI entry point. Deliberately
// refuses dynamic controls, loop/repeat buses and inherited nonzero phase
// anchors until their parity gates qualify. It reads the new compiled
// timeline directly; it never projects metadata or invokes the old planner.
export async function renderCanonicalComposition(
  timeline,
  placementId,
  { samples, memory, signal, yieldTask = renderYield } = {},
) {
  assertCanonicalTimeline(timeline);
  const placement = timeline.placements.find((p) => p.id === placementId);
  const plan = placement?.composition;
  if (
    !plan ||
    timeline.command.kind === "repeat" ||
    placement.loop ||
    typeof memory?.reserve !== "function"
  )
    fail("canonicalRenderNotQualified");
  const source = timeline.project.sourceDefs.find(
    (d) => d.id === plan.sourceId,
  );
  const p = source.programme;
  const controls = p.patterns[0].beatbox;
  if (
    p.patterns.some((a) => !sameData(a.beatbox, controls)) ||
    controls.some((b) => b.phasePolicy !== "continue-source")
  )
    fail("canonicalDynamicRenderNotQualified");
  if (
    plan.segments[0].phrases.some(
      (s) => s.phaseFrame !== null && s.phaseFrame !== 0,
    )
  )
    fail("canonicalContinuousRenderNotQualified");
  const rate = timeline.rate,
    frames = plan.endFrame - plan.startFrame;
  const check = () => {
    assertCanonicalTimeline(timeline);
    if (signal?.aborted) fail("cancelled");
  };
  check();
  // Output + exact legacy curve. Borrowed sample/cache storage must already
  // be charged by its provider to this SAME AudioMemory; no decode occurs here.
  const lease = memory.reserve(
    frames * 8 + 65537 * 4,
    "canonical/composition-proof",
  );
  let released = false;
  const dispose = () => {
    if (!released) {
      released = true;
      lease.release();
    }
  };
  try {
    const channels = [new Float32Array(frames), new Float32Array(frames)];
    const rows = [...p.percussion, ...controls, p.bilah];
    const gain = (r) =>
      r.mute || (rows.some((x) => x.solo) && !r.solo) ? 0 : r.volume;
    const present =
      timeline.project.compatibility.rolePresence.find(
        (r) => r.sourceId === source.id,
      )?.roles ?? [];
    const clipOrder = [
      ...present,
      ...controls.filter((b) => !present.includes(b.role)).map((b) => b.role),
    ];
    const lanes = p.percussion.map((t) => ({
      kind: "shot",
      row: t,
      shots: plan.shots.filter(
        (s) => s.kind === "percussion" && s.role === t.role,
      ),
    }));
    for (const role of clipOrder) {
      const control = controls.find((b) => b.role === role);
      if (control.enabled) lanes.push({ kind: "phrase", row: control });
    }
    lanes.push({
      kind: "shot",
      row: p.bilah,
      shots: plan.shots.filter((s) => s.kind === "bilah"),
    });
    const checked = new Set();
    const entryFor = (lane, shot) => {
      const e =
        lane.kind === "phrase"
          ? samples.phrase(lane.row)
          : shot.kind === "bilah"
            ? samples.bilah.get(shot.pitch)
            : samples.percussion.get(shot.role);
      const b = e?.buffer;
      if (
        !b ||
        b.sampleRate !== rate ||
        ![1, 2].includes(b.numberOfChannels) ||
        !Number.isSafeInteger(b.length) ||
        b.length < 1 ||
        !Number.isFinite(e.stem?.gainTrim) ||
        e.stem.gainTrim < 0 ||
        e.stem.gainTrim > 1
      )
        fail("invalidCanonicalSample");
      if (!checked.has(b)) {
        for (let c = 0; c < b.numberOfChannels; c++) {
          const data = b.getChannelData(c);
          if (
            !(data instanceof Float32Array) ||
            data.length !== b.length ||
            data.some((v) => !Number.isFinite(v))
          )
            fail("invalidCanonicalSample");
        }
        checked.add(b);
      }
      return e;
    };
    for (const lane of lanes) {
      const roleGain = f32(gain(lane.row));
      if (!roleGain) continue;
      const shots =
        lane.kind === "phrase"
          ? [{ velocity: 1, startFrame: plan.startFrame }]
          : lane.shots;
      for (const shot of shots) {
        check();
        const entry = entryFor(lane, shot),
          b = entry.buffer;
        const data = [
          b.getChannelData(0),
          b.getChannelData(b.numberOfChannels - 1),
        ];
        const phrase = lane.kind === "phrase";
        const start = shot.startFrame - plan.startFrame;
        const choke =
          shot.chokeFrame === null || phrase
            ? null
            : shot.chokeFrame - shot.startFrame;
        const stop = phrase
          ? frames
          : Math.min(
              frames,
              start + b.length,
              choke === null ? Infinity : start + choke + releaseFrames(rate),
            );
        const pan = lane.row.pan;
        const matrix = phrase
          ? [
              pan === 0
                ? 1
                : f32(Math.SQRT2 * Math.cos(((pan + 1) * Math.PI) / 4)),
              0,
              0,
              pan === 0
                ? 1
                : f32(Math.SQRT2 * Math.sin(((pan + 1) * Math.PI) / 4)),
            ]
          : panMatrix(pan, b.numberOfChannels === 1);
        const level = f32(entry.stem.gainTrim * shot.velocity);
        for (let block = start; block < stop; block += 65536) {
          check();
          for (
            let frame = block;
            frame < Math.min(stop, block + 65536);
            frame++
          ) {
            const relative = frame - start;
            const at = phrase
              ? ((relative * b.length) / (5 * rate)) % b.length
              : relative;
            const i = Math.floor(at),
              next = (i + 1) % b.length,
              fraction = at - i;
            const envelope = phrase
              ? f32(Math.min(1, relative / releaseFrames(rate)))
              : shotEnvelope(relative, b.length, rate, choke);
            const voiceGain = f32(level * envelope);
            const l = f32(
              f32(
                f32(data[0][i] + fraction * (data[0][next] - data[0][i])) *
                  voiceGain,
              ) * roleGain,
            );
            const r = f32(
              f32(
                f32(data[1][i] + fraction * (data[1][next] - data[1][i])) *
                  voiceGain,
              ) * roleGain,
            );
            channels[0][frame] = f32(
              channels[0][frame] + f32(f32(l * matrix[0]) + f32(r * matrix[1])),
            );
            channels[1][frame] = f32(
              channels[1][frame] + f32(f32(l * matrix[2]) + f32(r * matrix[3])),
            );
          }
          await yieldTask();
          check();
        }
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
    for (let block = 0; block < frames; block += 65536) {
      check();
      for (let n = block; n < Math.min(frames, block + 65536); n++) {
        const master = f32(
          plan.masterVolume * Math.min(1, (frames - n) / releaseFrames(rate)),
        );
        for (const channel of channels) {
          const x = Math.max(
            -1,
            Math.min(1, f32(f32(channel[n] * master) * 3)),
          );
          const position = (x + 1) * 32768,
            i = Math.min(65535, Math.floor(position));
          channel[n] = f32(
            curve[i] + (position - i) * (curve[i + 1] - curve[i]),
          );
        }
      }
      await yieldTask();
      check();
    }
    return Object.freeze({
      buffer: Object.freeze({
        length: frames,
        sampleRate: rate,
        numberOfChannels: 2,
        duration: frames / rate,
        getChannelData: (c) => channels[c],
      }),
      tap: "finite-composition-after-legacy-curve-before-outer-mix",
      dispose,
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
