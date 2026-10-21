import {
  renderPortableMix,
  portableMixBytes,
} from "../loop-station/portable-mix.js";
import { FLAT_EQ, BYPASS_LIMITER } from "../loop-station/fx-model.js";
import { fail } from "../project/instrument-contract.js";
import { renderYield } from "./frame-dsp.js";
const prints = new WeakMap();
export function canonicalPrintData(token) {
  const data = prints.get(token);
  if (!data) fail("invalidCanonicalPrint");
  return data;
}

// A finite immutable programme print preserves already-evaluated EQ/limiter
// history for seek and avoids changing native graph topology in long chains.
// The original programme still passes its concurrent16-owner/.95 admission;
// this is not permission to flatten a refused programme or change its gain.
export async function bakeCanonicalPlayback(
  score,
  { memory, createBuffer, check, yieldTask, sharedMaster = false } = {},
) {
  const { program } = score,
    project = sharedMaster
      ? {
          ...score.project,
          master: { ...score.project.master, limiter: BYPASS_LIMITER },
        }
      : score.project,
    frames = program.frames,
    rate = program.rate;
  check();
  const held = memory.reserve(
    frames * 8 + 4096,
    "canonical/immutable-programme-Float32-print",
  );
  let working = null,
    complete = false;
  try {
    working = memory.reserve(
      portableMixBytes(project, program, { boundedSourceViews: true }) + 65536,
      "canonical/programme-print-window-and-FX-state",
    );
    const cs = [new Float32Array(frames), new Float32Array(frames)];
    let at = 0,
      peak = 0;
    await renderPortableMix({ createBuffer }, project, program, {
      analysisOnly: true,
      boundedSourceViews: true,
      yieldTask: async () => {
        await (yieldTask ?? renderYield)();
        check();
      },
      onChunk(chunk) {
        check();
        for (let c = 0; c < 2; c++) {
          cs[c].set(chunk[c], at);
          for (const x of chunk[c]) peak = Math.max(peak, Math.abs(x));
        }
        at += chunk[0].length;
      },
    });
    check();
    if (at !== frames) fail("unsafeOutput");
    const token = Object.freeze({
      kind: "canonical-float-print",
      frames,
      rate,
    });
    prints.set(token, { channels: cs, createBuffer, frames, rate });
    const trackId = "canonical-programme-print",
      view = Object.freeze({
        project: Object.freeze({
          master: Object.freeze({ volume: 1, limiter: BYPASS_LIMITER }),
          tracks: Object.freeze([
            Object.freeze({
              id: trackId,
              gain: 1,
              pan: 0,
              mute: false,
              solo: false,
              eq: FLAT_EQ,
            }),
          ]),
        }),
        program: Object.freeze({
          ...program,
          events: Object.freeze([
            Object.freeze({
              id: trackId,
              trackId,
              spec: Object.freeze({
                buffer: Object.freeze({
                  numberOfChannels: 2,
                  length: frames,
                  sampleRate: rate,
                }),
                print: token,
                frames,
                startFrame: 0,
                naturalEndFrame: frames,
                endFrame: frames,
                dampFrame: null,
                velocity: 1,
                scale: 4,
                pan: 0,
                peak: Math.max(peak, score.admission.maxPeak),
              }),
            }),
          ]),
        }),
        backend: "immutable-programme-print",
        originalEventCount: program.events.length,
      });
    complete = true;
    return Object.freeze({
      view,
      dispose() {
        prints.delete(token);
        held.release();
      },
    });
  } finally {
    working?.release();
    if (!complete) held.release();
  }
}
