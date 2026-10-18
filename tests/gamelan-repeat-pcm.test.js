import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { emptyInstrumentTake } from "../src/project/instrument-take.js";
import { physicalFocus } from "../src/gamelan/instrument-focus.js";
import {
  gamelanRepeatPlan,
  repeatAdmission,
} from "../src/project/gamelan-repeat.js";
import { decodeCanonicalWav } from "../src/audio/frame-dsp.js";
import { gamelanPlaybackScale } from "../src/audio/gamelan-level.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { PPQ } from "../src/project/instrument-project.js";
const sha = (b) => createHash("sha256").update(b).digest("hex");

for (const rate of [44100, 48000])
  for (const instrument of ["peking", "slenthem"])
    test(`canonical ${instrument} ${rate} full PCM preserves every hit/tail and stays within its repeat certificate over24cycles`, async (t) => {
      const catalog = JSON.parse(
          await readFile(
            new URL(
              `../internal/instrument-focus/registry-${rate}.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
        registry = new InstrumentRegistry(catalog.banks),
        note = physicalFocus(registry, instrument, "pelog")[0],
        p = structuredClone(emptyInstrumentTake(registry)),
        steps = instrument === "peking" ? [0, 4, 8, 12] : [0];
      p.banks = [{ id: note.bank.id, version: note.bank.version }];
      p.clock.lengthTicks = 4 * PPQ;
      p.events = steps.map((s, i) => ({
        id: "strike-" + i,
        tick: (s * PPQ) / 4,
        action: "strike",
        velocity: 0.65,
        bankId: note.bank.id,
        sampleId: note.descriptor.id,
      }));
      const original = JSON.stringify(p),
        plan = gamelanRepeatPlan(p, registry, rate),
        map = JSON.parse(
          await readFile(
            new URL(
              "../internal/gamelan-delivery/asset-map.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
        file = map.files.find((f) => f.assetPath === note.descriptor.assetPath),
        raw = await readFile(new URL("../" + file.sourcePath, import.meta.url));
      assert.equal(sha(raw), file.sha256);
      const ctx = {
          sampleRate: rate,
          createBuffer(channels, frames, sampleRate) {
            const data = Array.from(
              { length: channels },
              () => new Float32Array(frames),
            );
            return {
              sampleRate,
              length: frames,
              numberOfChannels: channels,
              getChannelData: (c) => data[c],
            };
          },
        },
        buffer = await decodeCanonicalWav(
          ctx,
          raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
        ),
        data = [
          buffer.getChannelData(0),
          buffer.getChannelData(buffer.numberOfChannels - 1),
        ];
      let peak = 0;
      for (const a of data)
        for (const x of a) peak = Math.max(peak, Math.abs(x));
      const memory = new AudioMemory(),
        cache = memory.reserve(
          buffer.length * buffer.numberOfChannels * 4,
          "test decoded original",
        ),
        scale = gamelanPlaybackScale(note.bank, peak),
        metrics = new Map([[plan.voices[0].key, { peak: peak * scale }]]),
        items = [
          {
            key: plan.voices[0].key,
            bank: note.bank,
            lease: { buffer, metrics: { peak } },
          },
        ],
        pcmHash = sha(Buffer.from(data[0].buffer));
      assert.throws(() => repeatAdmission(plan, metrics, 0.65), {
        code: "voiceHeadroom",
      });
      const r = repeatAdmission(plan, metrics, 0.65, { items, memory });
      assert(r.maxOwned <= 16);
      assert(r.maxPeak < 0.95);
      assert.equal(
        memory.snapshot().bytes,
        buffer.length * buffer.numberOfChannels * 4,
      );
      assert.equal(sha(Buffer.from(data[0].buffer)), pcmHash);
      const starts = [];
      for (let cycle = 0; cycle < 24; cycle++)
        for (const s of steps)
          starts.push(
            cycle * plan.periodFrames + Math.round((s * rate * 60) / (96 * 4)),
          );
      starts.sort((a, b) => a - b);
      assert.equal(starts.length, 24 * steps.length);
      for (const v of plan.voices) {
        assert.equal(v.endFrame - v.startFrame, buffer.length);
        assert.equal(v.dampFrame, null);
      }
      const active = [];
      let next = 0,
        actualPeak = 0,
        maxAudible = 0,
        nonzero = 0;
      const gain = Math.fround(0.65 * 0.25 * 0.65 * scale),
        cycleEnergy = new Float64Array(24);
      for (let frame = 0; frame < 24 * plan.periodFrames; frame++) {
        while (next < starts.length && starts[next] <= frame)
          active.push(starts[next++]);
        for (let i = active.length - 1; i >= 0; i--)
          if (frame - active[i] >= buffer.length) active.splice(i, 1);
        maxAudible = Math.max(maxAudible, active.length);
        let left = 0,
          right = 0;
        for (const start of active) {
          left = Math.fround(left + Math.fround(data[0][frame - start] * gain));
          right = Math.fround(
            right + Math.fround(data[1][frame - start] * gain),
          );
        }
        actualPeak = Math.max(actualPeak, Math.abs(left), Math.abs(right));
        if (left || right) nonzero++;
        cycleEnergy[Math.floor(frame / plan.periodFrames)] +=
          left * left + right * right;
      }
      assert.equal(next, starts.length);
      assert(maxAudible <= r.maxOwned);
      assert(actualPeak > 0 && actualPeak <= r.maxPeak);
      assert(nonzero > 0);
      assert([...cycleEnergy].every((e) => e > 0));
      assert.equal(JSON.stringify(p), original);
      cache.release();
      assert.equal(memory.snapshot().bytes, 0);
      t.diagnostic(
        JSON.stringify({
          rate,
          instrument,
          cycles: 24,
          hits: starts.length,
          originalFrames: buffer.length,
          sourceSHA256: file.sha256,
          actualPeak,
          certifiedPeak: r.maxPeak,
          maxAudible,
          maxOwned: r.maxOwned,
          scratchBytes: r.scratchBytes,
          retainedPCMBytes: 0,
        }),
      );
    });
