// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  emptyInstrumentTake,
  appendInstrumentEvent,
  takePlan,
  assertEmptyLegacyLayer,
} from "../src/project/instrument-take.js";
import {
  PPQ,
  parseInstrumentProject,
} from "../src/project/instrument-project.js";
import { instrumentVoice } from "../src/audio/instrument-voice.js";
import { instrumentWavHeader } from "../src/audio/wav-metadata.js";
const body = (i) => new Uint8Array(32).fill(i);
const sha = (i) => createHash("sha256").update(body(i)).digest("hex");
const bank = (rate) => ({
  id: "qa",
  version: "1",
  kind: "instrument-bank",
  setId: "qa",
  tradition: "qa",
  laras: "none",
  samples: [1, 2, 3].map((i) => ({
    id: "s" + i,
    instrumentId: "qa",
    pitchId: "p" + i,
    articulation: "strike",
    assetPath: "/sounds/s" + i + ".wav",
    sha256: sha(i),
    sourceWorkId: "qa" + i,
    licenseId: "qa",
    encodedBytes: 32,
    sampleRate: rate,
    channels: 1,
    frames: 8,
    gainTrim: 1,
    voicePolicy: "polyphonic",
  })),
});
function contextFake(rate = 48000) {
  const operations = [];
  const param = {
    setValueAtTime: (...a) => operations.push(["set", ...a]),
    cancelScheduledValues: (...a) => operations.push(["cancel", ...a]),
    linearRampToValueAtTime: (...a) => operations.push(["ramp", ...a]),
  };
  const source = {
    playbackRate: { value: 0 },
    connect() {},
    disconnect() {},
    start: (...a) => operations.push(["start", ...a]),
    stop: (...a) => operations.push(["stop", ...a]),
  };
  return {
    sampleRate: rate,
    currentTime: 0,
    state: "running",
    operations,
    source,
    createBufferSource: () => source,
    createGain: () => ({ gain: param, connect() {}, disconnect() {} }),
  };
}
test("S3 complete event project preserves original and full tail, explicit damp and sample-frame clock", () => {
  const r = new InstrumentRegistry([bank(48000)]);
  let p = emptyInstrumentTake(r);
  const original = p.origin.text;
  for (const e of [
    { id: "a", tick: 0, sampleId: "s1", action: "strike", velocity: 0.7 },
    { id: "b", tick: PPQ / 4, sampleId: "s1", action: "damp", velocity: 0 },
    { id: "c", tick: PPQ / 2, sampleId: "s2", action: "strike", velocity: 1 },
  ])
    p = appendInstrumentEvent(p, r, { ...e, bankId: "qa", version: "1" });
  const plan = takePlan(p, r, 48000);
  assert.equal(plan.voices[0].startFrame, 0);
  assert.equal(plan.voices[0].naturalEndFrame, 8);
  assert.equal(plan.voices[1].startFrame, 15000);
  assert.equal(plan.voices[1].endFrame, 15008);
  assert.equal(plan.frames, 120000);
  assert.equal(p.origin.text, original);
  assert.deepEqual(parseInstrumentProject(JSON.stringify(p), r), p);
  const nonempty = structuredClone(p);
  nonempty.composition.patterns[0].steps.kick[0] = true;
  assert.throws(
    () => assertEmptyLegacyLayer(nonempty),
    (e) => e.code === "legacyLayerUnsupported",
  );
  assert.equal(p.origin.text, original);
});
test("S3 close recording tick collisions are preserved as distinct events instead of silently discarded", () => {
  const r = new InstrumentRegistry([bank(48000)]);
  let p = emptyInstrumentTake(r);
  for (const id of ["one", "two"])
    p = appendInstrumentEvent(p, r, {
      id,
      tick: 0,
      bankId: "qa",
      version: "1",
      sampleId: "s1",
      action: "strike",
      velocity: 1,
    });
  assert.deepEqual(
    p.events.map((e) => e.tick),
    [0, 1],
  );
  assert.equal(p.events.length, 2);
});
test("S3 live source keeps natural full duration and release ownership until actual onended", () => {
  const ctx = contextFake(),
    buffer = { duration: 45 },
    released = { n: 0 },
    voice = instrumentVoice(ctx, {}, buffer, 0.1, 0.5, {
      release: () => released.n++,
    });
  assert.equal(voice.source.buffer, buffer);
  assert.equal(voice.source.loop, false);
  assert.equal(voice.source.playbackRate.value, 1);
  assert.equal(voice.gain.gain.value, 0.125);
  assert.deepEqual(
    ctx.operations.find((o) => o[0] === "start"),
    ["start", 0.1, 0],
  );
  ctx.currentTime = 0.2;
  voice.stop();
  assert.equal(released.n, 0);
  voice.source.onended();
  assert.equal(released.n, 1);
  voice.stop();
  voice.disconnect();
  assert.equal(released.n, 1);
});
test("Retained archived WAV duration/stereo bounds", () => {
  const wav = instrumentWavHeader(48000, 48000);
  assert.equal(wav.bytes.byteLength, 192044);
  assert.equal(wav.view.getUint16(22, true), 2);
  assert.throws(
    () => instrumentWavHeader(48000 * 91, 48000),
    (e) => e.code === "exportDurationLimit",
  );
});
