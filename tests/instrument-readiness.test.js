import test from "node:test";
import assert from "node:assert/strict";
import {
  instrumentWavHeader,
  wavAttributionChunk,
} from "../src/audio/instrument-renderer.js";
import {
  gamelanWavAttribution,
  sourceQualityPending,
} from "../src/gamelan/attribution.js";
import { readinessCopy } from "../src/gamelan/readiness-copy.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  instrumentDemo,
  INSTRUMENT_DEMOS,
} from "../src/gamelan/instrument-demos.js";
import { instrumentGroups } from "../src/project/instrument-mix.js";
import { takePlan } from "../src/project/instrument-take.js";
import c from "../internal/instrument-focus/registry-48000.json" with { type: "json" };

test("V4 WAV INFO attribution has bounded UTF8, valid RIFF geometry and unchanged DATA payload", () => {
  const chunk = wavAttributionChunk(
      "Sumber — ©\nhttps://creativecommons.org/licenses/by/3.0/",
    ),
    plain = new Uint8Array(instrumentWavHeader(100, 48000).bytes),
    tagged = new Uint8Array(instrumentWavHeader(100, 48000, chunk).bytes);
  const a = new DataView(tagged.buffer);
  assert.equal(a.getUint32(4, true), tagged.length - 8);
  assert.equal(a.getUint32(40, true), 400);
  assert.deepEqual(tagged.slice(8, 444), plain.slice(8));
  assert.deepEqual(tagged.slice(444), chunk);
  assert.equal(new TextDecoder().decode(chunk.slice(0, 4)), "LIST");
  assert.equal(new TextDecoder().decode(chunk.slice(8, 16)), "INFOICMT");
  assert.equal(chunk.length % 2, 0);
  assert.equal(
    chunk[20 + new DataView(chunk.buffer).getUint32(16, true) - 1],
    0,
  );
  for (const text of ["x\0y", "x".repeat(65535), null, 0])
    assert.throws(
      () => wavAttributionChunk(text),
      (e) => e.code === "invalidExportAttribution",
    );
  assert.equal(wavAttributionChunk("x".repeat(65534)).length, 65556);
});
test("V4 all four WAV notices identify actual source works even when muted; live mute plan retains exact event/tail geometry", () => {
  const r = new InstrumentRegistry(c.banks);
  for (const demo of INSTRUMENT_DEMOS) {
    const p = instrumentDemo(demo.id, r),
      prior = takePlan(p, r, 48000),
      ids = new Set(
        p.events.filter((e) => e.action === "strike").map((e) => e.sampleId),
      );
    const notice = gamelanWavAttribution(p);
    assert.ok(wavAttributionChunk(notice).length < 65556);
    for (const id of ids) {
      assert.ok(notice.includes("sounds/" + id.slice(3) + "/"));
      assert.equal(sourceQualityPending(id), false);
    }
    const muted = structuredClone(p);
    muted.instrumentMix = instrumentGroups(p, r).map((g) => ({
      ...g,
      mute: true,
    }));
    const live = takePlan(muted, r, 48000, { includeMuted: true });
    assert.equal(live.voices.length, prior.voices.length);
    assert.deepEqual(
      live.voices.map((v) => [v.key, v.startFrame, v.endFrame, v.dampFrame]),
      prior.voices.map((v) => [v.key, v.startFrame, v.endFrame, v.dampFrame]),
    );
    assert.ok(live.voices.every((v) => v.mix.volume === 0));
    assert.throws(
      () => takePlan(muted, r, 48000),
      (e) => e.code === "emptyMix",
    );
    assert.equal(gamelanWavAttribution(muted), notice);
  }
  assert.match(gamelanWavAttribution({ events: [] }), /CC0/);
});
test("V4 readiness UI has complete ID/EN copy parity", () => {
  assert.deepEqual(
    Object.keys(readinessCopy.id).sort(),
    Object.keys(readinessCopy.en).sort(),
  );
  assert.deepEqual(
    Object.keys(readinessCopy.id.errors).sort(),
    Object.keys(readinessCopy.en.errors).sort(),
  );
  for (const language of ["id", "en"])
    for (const value of Object.values(readinessCopy[language]))
      if (typeof value === "string") assert.ok(value.length);
});
