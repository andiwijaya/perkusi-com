import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { OwnedOutput } from "../src/audio/owned-output.js";
import { shareInstrumentOutput } from "../src/project/instrument-share.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function outputFixture() {
  const memory = new AudioMemory(),
    blob = new Blob([new Uint8Array(128)]),
    revoked = [],
    calls = [];
  const output = new OwnedOutput(
    blob,
    memory.reserve(256, "WAV staging/Blob"),
    { createURL: () => "blob:one", revokeURL: (url) => revoked.push(url) },
  );
  const download = (out, name) => calls.push({ url: out.downloadURL(), name });
  return { memory, output, revoked, calls, download };
}
test("V4 unavailable/rejected share retains one owned reusable download URL and reports actual fallback", async () => {
  const f = outputFixture();
  assert.equal(
    await shareInstrumentOutput(f.output, {
      memory: f.memory,
      download: f.download,
      navigator: {},
    }),
    "download",
  );
  assert.equal(
    await shareInstrumentOutput(f.output, {
      memory: f.memory,
      download: f.download,
      navigator: { canShare: () => false, share: () => assert.fail() },
    }),
    "download",
  );
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((x) => x.url === "blob:one"));
  assert.equal(f.memory.snapshot().bytes, 256);
  f.output.release();
  await f.output.released;
  assert.equal(f.memory.snapshot().bytes, 0);
  assert.deepEqual(f.revoked, ["blob:one"]);
});
test("V4 pending actual share holds output/File admission through owner release until settlement", async () => {
  const f = outputFixture(),
    gate = deferred(),
    entered = deferred();
  const sharing = shareInstrumentOutput(f.output, {
    memory: f.memory,
    download: f.download,
    navigator: {
      canShare: ({ files }) => files[0].size === 128,
      share: async ({ files }) => {
        assert.equal(files[0].size, 128);
        entered.resolve();
        await gate.promise;
      },
    },
  });
  await entered.promise;
  assert.equal(f.memory.snapshot().bytes, 384);
  let closed = false;
  f.output.released.then(() => {
    closed = true;
  });
  f.output.release();
  await Promise.resolve();
  assert.equal(closed, false);
  assert.equal(f.memory.snapshot().bytes, 384);
  assert.throws(() => f.output.blob);
  gate.resolve();
  assert.equal(await sharing, "shared");
  await f.output.released;
  assert.equal(f.memory.snapshot().bytes, 0);
  assert.equal(f.calls.length, 0);
});
test("V4 cancel/failure and failed admission preserve the WAV, safely release File copies, and never falsely claim share", async () => {
  for (const code of ["AbortError", "OtherError"]) {
    const f = outputFixture(),
      navigator = {
        canShare: () => true,
        share: async () => {
          throw Object.assign(Error("failed"), { name: code });
        },
      };
    assert.equal(
      await shareInstrumentOutput(f.output, {
        memory: f.memory,
        download: f.download,
        navigator,
      }),
      code === "AbortError" ? "cancelled" : "download",
    );
    assert.equal(f.memory.snapshot().bytes, 256);
    assert.equal(f.calls.length, code === "AbortError" ? 0 : 1);
    f.output.release();
    assert.equal(f.memory.snapshot().bytes, 0);
  }
  const f = outputFixture(),
    foreign = f.memory.reserve(64 * 1024 * 1024 - 256, "foreign pin");
  await assert.rejects(
    shareInstrumentOutput(f.output, {
      memory: f.memory,
      download: f.download,
      navigator: { canShare: () => true, share: () => assert.fail() },
    }),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.equal(f.output.blob.size, 128);
  foreign.release();
  f.output.release();
  assert.equal(f.memory.snapshot().bytes, 0);
});
