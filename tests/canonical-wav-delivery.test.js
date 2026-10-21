import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { CanonicalWavDelivery } from "../src/studio/canonical-wav-delivery.js";
import { FileDelivery } from "../src/project/files.js";

test("ready WAV is revision-bound and keeps real native ownership until share settles", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(81, "foreign"),
    calls = [];
  let revision = 1,
    resolve;
  const owner = new CanonicalWavDelivery({
    memory,
    readRevision: () => revision,
    delivery: {
      canShare: () => true,
      share(file) {
        calls.push(file);
        return new Promise((r) => {
          resolve = r;
        });
      },
      dispose() {},
    },
  });
  const blob = new Blob([new Uint8Array(123)]);
  assert(owner.remember(blob, "test.wav", 1));
  assert.equal(memory.snapshot().bytes, 81 + 123 + 4096);
  const task = owner.share();
  assert.equal(
    calls.length,
    1,
    "native share is invoked before share() returns",
  );
  assert.throws(() => owner.share(), { code: "deliveryFailed" });
  revision++;
  assert.equal(owner.snapshot().ready, false);
  assert.equal(memory.snapshot().bytes, 81 + 123 + 4096);
  resolve("shared");
  assert.equal(await task, "shared");
  assert.equal(memory.snapshot().bytes, 81);
  assert.equal(owner.remember(blob, "old.wav", 1), false);
  await owner.dispose();
  foreign.release();
  assert.equal(memory.snapshot().bytes, 0);
});

for (const mode of ["unsupported", "cancelled", "failed", "shared"]) {
  test(`native ${mode} follows the existing cancellation/download contract and retains the ready file`, async () => {
    const memory = new AudioMemory(),
      downloads = [],
      native = [],
      delivery = new FileDelivery({
        navigator: {
          canShare: () => mode !== "unsupported",
          async share(value) {
            native.push(value);
            if (mode === "cancelled")
              throw new DOMException("cancel", "AbortError");
            if (mode === "failed") throw Error("share failure");
          },
        },
      });
    delivery.download = (file, name) => downloads.push({ file, name });
    const owner = new CanonicalWavDelivery({
      memory,
      readRevision: () => 4,
      delivery,
    });
    owner.remember(new Blob(["unchanged WAV fixture"]), "sound.wav", 4);
    assert.equal(
      await owner.share(),
      mode === "shared"
        ? "shared"
        : mode === "cancelled"
          ? "shareCancelled"
          : "shareFallback",
    );
    assert.equal(native.length, mode === "unsupported" ? 0 : 1);
    assert.equal(
      downloads.length,
      ["unsupported", "failed"].includes(mode) ? 1 : 0,
    );
    assert(owner.snapshot().ready);
    await owner.dispose();
    assert.equal(memory.snapshot().bytes, 0);
  });
}

test("download URL keeps its independent byte reservation after the ready file is invalidated", async () => {
  const memory = new AudioMemory(),
    callbacks = new Map(),
    timers = {
      setTimeout(fn) {
        const id = callbacks.size + 1;
        callbacks.set(id, fn);
        return id;
      },
      clearTimeout(id) {
        callbacks.delete(id);
      },
    },
    delivery = new FileDelivery({ navigator: {} });
  delivery.download = () => {};
  const owner = new CanonicalWavDelivery({
    memory,
    readRevision: () => 0,
    delivery,
    timers,
  });
  owner.remember(new Blob([new Uint8Array(123)]), "sound.wav", 0);
  owner.download();
  owner.clear();
  assert.equal(memory.snapshot().bytes, 123 + 4096);
  assert.equal(callbacks.size, 1);
  callbacks.values().next().value();
  assert.equal(memory.snapshot().bytes, 0);
  owner.remember(new Blob([new Uint8Array(123)]), "sound.wav", 0);
  owner.download();
  await owner.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});

test("memory pressure evicts only the disposable ready WAV before admitting another owner", async () => {
  const memory = new AudioMemory(),
    owner = new CanonicalWavDelivery({
      memory,
      readRevision: () => 0,
      delivery: { canShare: () => false, dispose() {} },
    });
  owner.remember(new Blob([new Uint8Array(4096)]), "sound.wav", 0);
  assert.equal(memory.snapshot().bytes, 8192);
  const foreign = memory.reserve(67108864 - 4096, "foreign");
  assert.equal(owner.snapshot().ready, false);
  assert.equal(memory.snapshot().bytes, 67108864 - 4096);
  foreign.release();
  await owner.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});

test("File construction and byte-budget failures publish no ready file and leave foreign memory intact", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(67108864 - 4096, "foreign");
  const owner = new CanonicalWavDelivery({
    memory,
    readRevision: () => 0,
    delivery: { canShare: () => false, dispose() {} },
  });
  assert.throws(() => owner.remember(new Blob(["one"]), "sound.wav", 0));
  assert.equal(owner.snapshot().ready, false);
  foreign.release();
  const broken = new CanonicalWavDelivery({
    memory,
    readRevision: () => 0,
    FileClass: class {
      constructor() {
        throw Error("constructor failed");
      }
    },
    delivery: { canShare: () => false, dispose() {} },
  });
  assert.throws(() => broken.remember(new Blob(["one"]), "sound.wav", 0));
  assert.equal(memory.snapshot().bytes, 0);
  await owner.dispose();
  await broken.dispose();
});
