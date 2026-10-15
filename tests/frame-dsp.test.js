import test from "node:test";
import assert from "node:assert/strict";
import {
  attackFrames,
  releaseFrames,
  dampFrames,
  shotEnvelope,
  decodeCanonicalWav,
  addInstrumentFrames,
  panMatrix,
} from "../src/audio/frame-dsp.js";
const buffer = (channels, frames, rate) => {
  const data = Array.from({ length: channels }, () => new Float32Array(frames));
  return {
    sampleRate: rate,
    length: frames,
    numberOfChannels: channels,
    duration: frames / rate,
    getChannelData: (c) => data[c],
  };
};
test("Canonical frame endpoints and interrupted release are explicit at both rates", () => {
  for (const [rate, attack, release, damp] of [
    [48000, 29, 192, 960],
    [44100, 26, 176, 882],
  ]) {
    assert.equal(attackFrames(rate), attack);
    assert.equal(releaseFrames(rate), release);
    assert.equal(dampFrames(rate), damp);
    assert.equal(shotEnvelope(0, 2000, rate), 0);
    assert.equal(shotEnvelope(1, 2000, rate), Math.fround(1 / attack));
    assert.equal(shotEnvelope(attack, 2000, rate), 1);
    assert.equal(shotEnvelope(2000, 2000, rate), 0);
    assert.equal(shotEnvelope(attack + release, 2000, rate, attack), 0);
    assert.equal(shotEnvelope(attack + release / 2, 2000, rate, attack), 0.5);
  }
});
test("Canonical PCM decoding reads exact signed16/24 values and rejects truncated/duplicate bodies", async () => {
  for (const bits of [16, 24]) {
    const integers =
        bits === 16 ? [-32768, -1, 0, 1, 32767] : [-8388608, -1, 0, 1, 8388607],
      size = (integers.length * bits) / 8;
    const bytes = new ArrayBuffer(44 + size),
      d = new DataView(bytes),
      tag = (at, s) =>
        [...s].forEach((c, i) => d.setUint8(at + i, c.charCodeAt(0)));
    tag(0, "RIFF");
    d.setUint32(4, 36 + size, true);
    tag(8, "WAVE");
    tag(12, "fmt ");
    d.setUint32(16, 16, true);
    d.setUint16(20, 1, true);
    d.setUint16(22, 1, true);
    d.setUint32(24, 48000, true);
    d.setUint16(32, bits / 8, true);
    d.setUint16(34, bits, true);
    tag(36, "data");
    d.setUint32(40, size, true);
    for (let i = 0; i < integers.length; i++)
      for (let k = 0; k < bits / 8; k++)
        d.setUint8(44 + (i * bits) / 8 + k, (integers[i] >> (8 * k)) & 255);
    let native = 0;
    const ctx = {
      sampleRate: 48000,
      createBuffer: buffer,
      decodeAudioData: () => {
        native++;
        throw Error("unexpected native same-rate decode");
      },
    };
    const decoded = await decodeCanonicalWav(ctx, bytes);
    assert.deepEqual(
      [...decoded.getChannelData(0)],
      integers.map((v) => Math.fround(v / 2 ** (bits - 1))),
    );
    assert.equal(native, 0);
    await assert.rejects(
      decodeCanonicalWav(ctx, bytes.slice(0, bytes.byteLength - 1)),
      /Truncated/,
    );
    const duplicate = new Uint8Array(bytes.byteLength + (size % 2) + 8 + size);
    duplicate.set(new Uint8Array(bytes));
    duplicate.set(new Uint8Array(bytes, 36), bytes.byteLength + (size % 2));
    new DataView(duplicate.buffer).setUint32(4, duplicate.length - 8, true);
    await assert.rejects(
      decodeCanonicalWav(ctx, duplicate.buffer),
      /Duplicate/,
    );
  }
});
test("Ordered instrument accumulation retains full source, explicit damp, chunk continuity and pan identity", () => {
  const source = buffer(2, 2000, 48000);
  source.getChannelData(0).fill(0.5);
  source.getChannelData(1).fill(-0.25);
  const voice = {
      startFrame: 17,
      endFrame: 2017,
      dampFrame: null,
      velocity: 1,
      mix: { volume: 1, pan: 0 },
    },
    whole = [new Float32Array(2200), new Float32Array(2200)];
  addInstrumentFrames(whole, source, voice, 0, 48000, 1);
  assert.equal(whole[0][16], 0);
  assert.equal(whole[0][17], 0.125);
  assert.equal(whole[0][2016], 0.125);
  assert.equal(whole[0][2017], 0);
  assert.equal(whole[1][17], -0.0625);
  const a = [new Float32Array(1000), new Float32Array(1000)],
    b = [new Float32Array(1200), new Float32Array(1200)];
  addInstrumentFrames(a, source, voice, 0, 48000, 1);
  addInstrumentFrames(b, source, voice, 1000, 48000, 1);
  for (let c = 0; c < 2; c++)
    assert.deepEqual([...a[c], ...b[c]], [...whole[c]]);
  const damped = { ...voice, dampFrame: 1000, endFrame: 1960 };
  const out = [new Float32Array(2200), new Float32Array(2200)];
  addInstrumentFrames(out, source, damped, 0, 48000, 1);
  assert.equal(out[0][1000], 0.125);
  assert.equal(out[0][1480], 0.0625);
  assert.equal(out[0][1960], 0);
  assert.deepEqual(panMatrix(0, false), [1, 0, 0, 1]);
  const mono = buffer(1, 2000, 48000);
  mono.getChannelData(0).fill(0.5);
  const duplicated = [new Float32Array(2200), new Float32Array(2200)];
  addInstrumentFrames(duplicated, mono, voice, 0, 48000, 1);
  assert.equal(duplicated[0][17], 0.125);
  assert.equal(duplicated[1][17], 0.125);
});
