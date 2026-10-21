import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { prepareCanonicalScore } from "../src/audio/canonical-score.js";
import { createCanonicalLoopProgram } from "../src/audio/canonical-loop-program.js";
import { createPortableMixState } from "../src/loop-station/portable-mix-state.js";
import { BYPASS_LIMITER } from "../src/loop-station/fx-model.js";
import { startSongChain } from "../src/project/canonical-authoring.js";
import {
  canonicalScoreFixture,
  qaBuffer,
} from "./helpers/canonical-score-fixtures.js";
for (const rate of [44100, 48000])
  for (const profile of ["repeat", "mixed"])
    for (const recurrences of profile === "mixed" ? [false] : [false, true])
      test(
        profile === "mixed"
          ? `concurrent finite mixed reference retains strict64MiB refusal without changing one-cycle ownership @${rate}`
          : `rolling native sources/damp/tails and EQ equal the established finite3-cycle programme @${rate}, recurrences=${recurrences}`,
        async () => {
          const memory = new AudioMemory(),
            foreign = memory.reserve(313, "foreign"),
            f = await canonicalScoreFixture(rate, memory, qaBuffer, {
              profile,
            }),
            prepare = (cycles) =>
              prepareCanonicalScore(f.canonical, {
                ...f,
                rate,
                memory,
                createBuffer: qaBuffer,
                yieldTask: async () => {},
                command: { kind: "repeat", bars: null, cycles },
              });
          if (recurrences || profile === "mixed") {
            startSongChain(f.canonical, 4);
            if (recurrences && profile !== "mixed")
              for (const s of f.canonical.sections)
                for (const p of s.placements) p.loop = true;
          }
          const before = JSON.stringify(f.canonical);
          let one, many, loop, reference, outputLease;
          try {
            one = await prepare(1);
            if (profile === "mixed") {
              const bytes = memory.snapshot().bytes;
              await assert.rejects(prepare(3), { code: "combinedMemoryLimit" });
              assert.equal(memory.snapshot().bytes, bytes);
            } else {
              many = await prepare(3);
              reference = createPortableMixState(
                {
                  ...many.project,
                  master: { ...many.project.master, limiter: BYPASS_LIMITER },
                },
                many.program,
                { memory },
              );
              loop = createCanonicalLoopProgram(one, {
                memory,
                cycles: 3,
                frames: many.program.frames,
              });
              const finishing = createCanonicalLoopProgram(one, { memory });
              try {
                const end = finishing.finish();
                assert.equal(end.bodyFrames, one.program.bodyFrames);
                assert.equal(
                  end.frames,
                  one.program.frames,
                  "finish retains the complete natural/EQ tail, with no invented silence",
                );
              } finally {
                finishing.dispose();
              }
              outputLease = memory.reserve(
                4096 * 8 * 2,
                "qa/paired-output-chunks",
              );
              const expected = [new Float32Array(4096), new Float32Array(4096)],
                actual = expected.map((c) => new Float32Array(c.length));
              for (let at = 0; at < many.program.frames; at += 4096) {
                const n = Math.min(4096, many.program.frames - at),
                  a = actual.map((c) => c.subarray(0, n)),
                  b = expected.map((c) => c.subarray(0, n));
                assert.equal(reference.renderInto(b).frames, n);
                assert.equal(loop.renderInto(a).frames, n);
                for (let c = 0; c < 2; c++)
                  for (let i = 0; i < n; i++)
                    if (!Object.is(a[c][i], b[c][i]))
                      assert.fail(
                        `PCM mismatch at ${at + i}, channel${c}: ${a[c][i]} versus ${b[c][i]}`,
                      );
              }
              assert(loop.snapshot().instances <= 16);
              assert(loop.snapshot().cacheSlots <= 16);
            }
            assert.equal(JSON.stringify(f.canonical), before);
          } finally {
            outputLease?.release();
            loop?.dispose();
            reference?.dispose();
            one?.dispose();
            many?.dispose();
          }
          assert.equal(memory.snapshot().bytes, 313);
          foreign.release();
        },
      );
