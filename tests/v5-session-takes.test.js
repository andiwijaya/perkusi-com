import test from "node:test";
import assert from "node:assert/strict";
import { SessionTakes } from "../src/loop-station/session-takes.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { RootCaptureCoordinator } from "../src/loop-station/capture-coordinator.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";

function fixture() {
  const memory = new AudioMemory(),
    pool = new TakePool(memory),
    capture = Object.create(RootCaptureCoordinator.prototype);
  capture.pool = pool;
  capture.retained = new Map();
  const context = {
    sampleRate: 48000,
    createBuffer(channels, frames, rate) {
      const a = Array.from(
        { length: channels },
        () => new Float32Array(frames),
      );
      return {
        length: frames,
        numberOfChannels: channels,
        sampleRate: rate,
        getChannelData: (ch) => a[ch],
        copyToChannel: (v, ch) => a[ch].set(v),
      };
    },
  };
  const owner = new WorkspaceAudioOwner({ memory, getProject: () => null });
  Object.assign(owner, {
    memory,
    pool,
    capture,
    engine: { context },
    stopSaved: async () => {},
  });
  const store = new SessionTakes(owner);
  const make = (v, partial = false) => {
    const a = Array.from({ length: 2 }, (_, ch) =>
        new Float32Array(512).fill(v + ch * 0.01),
      ),
      reservation = pool.reserve({
        capacity: 512,
        channels: 2,
        sampleRate: 48000,
      });
    const take = pool.adopt(
      reservation,
      {
        capacity: 512,
        channels: 2,
        sampleRate: 48000,
        startFrame: 1000,
        frames: 512,
        reason: partial ? "userStop" : "complete",
      },
      a.map((x) => x.buffer),
    );
    const token = {};
    pool.pin(take.id, token);
    capture.retained.set(take.id, {
      take,
      owner: token,
      record: { cleaned: true },
    });
    return take;
  };
  return { memory, pool, capture, store, make };
}
test("adoption transfers coordinator pin into session/history without freeing PCM; undo/redo retains originals", async () => {
  const f = fixture(),
    a = f.make(0.2),
    b = f.make(0.3);
  f.store.save(a.id, "track-1");
  f.store.save(b.id, "track-1");
  assert.equal(f.capture.retained.size, 0);
  assert.deepEqual(f.store.layers("track-1"), [b.id]);
  assert.ok(f.pool.snapshot().every((t) => t.pins === 2));
  assert.throws(() => f.pool.release(a.id), { code: "takeHeld" });
  await f.store.undo("track-1");
  assert.deepEqual(f.store.layers("track-1"), [a.id]);
  await f.store.redo("track-1");
  assert.deepEqual(f.store.layers("track-1"), [b.id]);
  assert.equal(f.store.saved.size, 2);
  await f.store.discard();
  assert.equal(f.memory.snapshot().bytes, 0);
  assert.equal(f.store.hasWork(), false);
});
test("WAV backup contains exact float32 stereo valid PCM and explicit geometry, charged until released", async () => {
  const f = fixture(),
    t = f.make(0.25);
  f.store.save(t.id, "track-1");
  const baseline = f.memory.snapshot().bytes,
    wav = f.store.wav(t.id),
    d = new DataView(wav.buffer);
  assert.equal(d.getUint16(20, true), 3);
  assert.equal(d.getUint16(22, true), 2);
  assert.equal(d.getUint32(46, true), 512);
  assert.equal(d.getUint32(54, true), 4096);
  const tail = new TextDecoder().decode(new Uint8Array(wav.buffer, 58 + 4096));
  assert.ok(tail.startsWith("LIST"));
  assert.ok(tail.includes("INFOICMT"));
  assert.equal(d.getUint32(4, true) + 8, wav.buffer.byteLength);
  for (let frame = 0; frame < 512; frame++) {
    assert.equal(d.getFloat32(58 + frame * 8, true), Math.fround(0.25));
    assert.equal(d.getFloat32(62 + frame * 8, true), Math.fround(0.26));
  }
  assert.ok(f.memory.snapshot().bytes > baseline);
  wav.release();
  assert.equal(f.memory.snapshot().bytes, baseline);
  await f.store.discard();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("WAV carries immutable source identity and existing attribution alongside exact PCM", async () => {
  const f = fixture(),
    t = f.make(0.2);
  f.store.owner.controller = {
    registry: {
      sample: (_b, _v, id) => ({
        id,
        sourceWorkId: "freesound-261724",
        licenseId: "cc-by-3-0",
        sha256: "a".repeat(64),
      }),
    },
  };
  const assignment = {
    trackId: "track-1",
    bankId: "cdm-slendro",
    bankVersion: "candidate-1.0.0",
    sampleIds: ["fs-261724"],
  };
  f.store.save(t.id, "track-1", assignment);
  assignment.sampleIds[0] = "invalid";
  const wav = f.store.wav(t.id),
    text = new TextDecoder().decode(
      new Uint8Array(wav.buffer, 58 + t.validBytes),
    );
  for (const value of [
    "Digitopia_CdM",
    "Pedro Augusto",
    "https://creativecommons.org/licenses/by/3.0/",
    "https://freesound.org/people/Digitopia_CdM/sounds/261724/",
    "freesound-261724",
    "a".repeat(64),
  ])
    assert.ok(text.includes(value), value);
  wav.release();
  await f.store.discard();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("partial/held take is not silently adopted; original and pin survive refusal", async () => {
  const f = fixture(),
    p = f.make(0.2, true);
  assert.throws(() => f.store.save(p.id, "track-1"), {
    code: "partialTakeNeedsReview",
  });
  assert.equal(f.capture.retained.size, 1);
  assert.equal(f.store.saved.size, 0);
  const x = f.capture.retained.get(p.id);
  f.pool.unpin(p.id, x.owner);
  f.pool.release(p.id);
  assert.equal(f.memory.snapshot().bytes, 0);
});
