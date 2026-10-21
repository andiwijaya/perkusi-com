import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { MasterClock } from "../src/loop-station/master-clock.js";
import {
  SourceWindows,
  SOURCE_WINDOW_BYTES,
} from "../src/loop-station/source-windows.js";
import { PPQ } from "../src/project/instrument-project.js";
import { createCanonicalLoopBus } from "../src/audio/canonical-loop-bus.js";
import { canonicalLoopSourcePeak } from "../src/audio/canonical-loop-bounds.js";
import { renderCanonicalRun } from "../src/audio/canonical-dynamic-render.js";
import { qaBuffer } from "./helpers/canonical-score-fixtures.js";

for (const rate of [44100, 48000])
  for (const mode of [
    "phrase-ramp-release",
    "shot-ramp",
    "continuous-phase-stereo-pan",
    "quiescent",
  ])
    for (const bpm of mode === "continuous-phase-stereo-pan" ? [88, 96] : [96])
      test(`rolling composition ${mode} retains the existing full PCM/control law @${rate}, bpm=${bpm}`, async () => {
        const memory = new AudioMemory(),
          foreign = memory.reserve(313, "foreign"),
          clock = new MasterClock({ timing: { bpm } }, rate),
          bar = 4 * PPQ,
          periodTicks = 2 * bar,
          body = clock.frame(periodTicks * 3),
          release = Math.round(0.004 * rate),
          lease = memory.reserve(
            (body + release) * 16 +
              2 * 65537 * 4 +
              SOURCE_WINDOW_BYTES +
              65536 +
              4096 * 8,
            "qa/complete-source-reference-cache-and-controls",
          ),
          source = qaBuffer(
            mode === "continuous-phase-stereo-pan" ? 2 : 1,
            4096,
            rate,
          );
        for (let c = 0; c < source.numberOfChannels; c++)
          for (let i = 0; i < source.length; i++)
            source.getChannelData(c)[i] = Math.fround(
              0.04 * Math.sin(i / (c ? 31 : 47)),
            );
        const entry = { buffer: source, stem: { gainTrim: 0.4 } },
          programme = {
            percussion: [{ role: "kick", pan: 0 }],
            bilah: { pan: 0 },
          },
          makeSegment = (cycle, index) => {
            const tick = (cycle * 2 + index) * bar,
              enabled =
                mode === "continuous-phase-stereo-pan" ||
                (mode === "phrase-ramp-release" && index === 0),
              gain = mode === "phrase-ramp-release" ? (index ? 1 : 0) : 0.3;
            return {
              tick,
              startFrame: clock.frame(tick),
              endFrame: clock.frame(tick + bar),
              percussionGains: [mode === "shot-ramp" ? (index ? 0 : 1) : 0],
              bilahGain: 0,
              phrases: [
                {
                  sourceId: "source",
                  placementId: "placement",
                  role: "kick",
                  startFrame: clock.frame(tick),
                  endFrame: clock.frame(tick + bar),
                  phaseFrame: 0,
                  gain,
                  control: {
                    identity: {
                      packId: "qa",
                      packVersion: "1",
                      processing: "none",
                      role: "kick",
                      variant: 1,
                    },
                    enabled,
                    phasePolicy: "continue-source",
                    pan: index ? 0.27 : -0.31,
                  },
                  entry: enabled ? entry : null,
                },
              ],
            };
          },
          segments = Array.from({ length: 6 }, (_, i) =>
            makeSegment(Math.floor(i / 2), i % 2),
          ),
          shots =
            mode === "shot-ramp"
              ? Array.from({ length: 3 }, (_, cycle) => ({
                  kind: "percussion",
                  role: "kick",
                  tick: (2 * cycle + 1) * bar,
                  startFrame: clock.frame((2 * cycle + 1) * bar),
                  velocity: 0.5,
                  gain: 0,
                  entry,
                }))
              : [],
          run = {
            source: { id: "source", programme },
            timeline: {
              project: {
                compatibility: {
                  rolePresence: [{ sourceId: "source", roles: ["kick"] }],
                },
              },
            },
            trackId: "track",
            continuous: true,
            pieces: [
              {
                composition: {
                  startFrame: 0,
                  endFrame: body,
                  masterVolume: 0.3,
                  segments,
                  shots,
                },
              },
            ],
          };
        let bus;
        try {
          const reference = await renderCanonicalRun(run, {
              rate,
              entry: () => entry,
              createBuffer: qaBuffer,
              check: () => {},
              yieldTask: async () => {},
            }),
            template = {
              programme,
              roles: ["kick"],
              startTick: 0,
              endTick: periodTicks,
              master: 0.3,
              continuous: true,
              segments: segments.slice(0, 2),
              shots: shots.filter((s) => s.tick < periodTicks),
            },
            curve = Float32Array.from({ length: 65537 }, (_, i) => {
              const x = i / 32768 - 1,
                a = Math.abs(x);
              return a <= 0.7
                ? x
                : Math.sign(x) *
                    (0.7 +
                      0.2 * (1 - (1 - Math.min(1, (a - 0.7) / 0.3)) ** 1.5));
            });
          if (mode === "quiescent")
            assert.equal(canonicalLoopSourcePeak(template), 0);
          else {
            assert(
              reference.peak > 0,
              "control ramps can make sound even if every enabled state/hit has zero target gain",
            );
            assert.equal(canonicalLoopSourcePeak(template), 0.9);
          }
          bus = createCanonicalLoopBus(template, {
            clock,
            rate,
            cycleTick: 0,
            periodTicks,
            stopTick: () => 3 * periodTicks,
            sourceWindows: new SourceWindows(),
            curve,
            acquireCache: () => ({
              channels: [new Float32Array(2048), new Float32Array(2048)],
              release() {},
            }),
          });
          assert.equal(bus.buffer.length, reference.buffer.length);
          const out = [new Float32Array(2048), new Float32Array(2048)];
          for (let from = 0; from < reference.buffer.length; from += 2048) {
            const n = Math.min(2048, reference.buffer.length - from);
            for (let c = 0; c < 2; c++) {
              bus.buffer.copyFromChannel(out[c], c, from);
              const expected = reference.buffer.getChannelData(c);
              for (let i = 0; i < n; i++)
                if (!Object.is(out[c][i], expected[from + i]))
                  assert.fail(
                    `PCM mismatch ${from + i}, channel${c}: ${out[c][i]} versus ${expected[from + i]}`,
                  );
            }
          }
          bus.dispose();
          assert.throws(() => bus.buffer.copyFromChannel(out[0], 0, 0), {
            code: "memoryReleased",
          });
        } finally {
          bus?.dispose();
          lease.release();
        }
        assert.equal(memory.snapshot().bytes, 313);
        foreign.release();
      });
