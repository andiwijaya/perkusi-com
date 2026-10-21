import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import {
  retainCanonicalInputBlob,
  createCanonicalBlobAssembler,
} from "../src/project/canonical-blob-owner.js";

test("complete output assembly is preflighted twice then actual output and download share one immutable payload", async () => {
  const memory = new AudioMemory(),
    bytes = new Uint8Array(32000).fill(71),
    assembler = createCanonicalBlobAssembler(memory, bytes.length);
  assert.equal(memory.snapshot().bytes, 2 * bytes.length + 4096);
  const output = assembler.assemble([bytes]),
    blob = output.blob;
  assert.equal(memory.snapshot().bytes, bytes.length + 4096);
  const download = retainCanonicalInputBlob(blob, memory);
  assert.equal(memory.snapshot().bytes, bytes.length + 2 * 4096);
  assembler.dispose();
  output.release();
  assert.equal(output.blob, null);
  assert.equal(memory.snapshot().bytes, bytes.length + 4096);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  download.release();
  assert.equal(memory.snapshot().bytes, 0);
});

test("failed/incomplete output assembly rolls back only its own reservations and cannot publish again", () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    assembler = createCanonicalBlobAssembler(memory, 32000);
  assert.throws(
    () => assembler.assemble([new Uint8Array(31999)]),
    (e) => e.code === "invalidCanonicalPackage",
  );
  assert.equal(memory.snapshot().bytes, 313);
  assert.throws(
    () => assembler.assemble([new Uint8Array(32000)]),
    (e) => e.code === "canonicalBundleReleased",
  );
  assembler.dispose();
  foreign.release();
});

test("output preflight refuses before constructing a Blob and retains unrelated accepted owners", () => {
  const memory = new AudioMemory({ maxBytes: 55000 }),
    foreign = memory.reserve(313, "foreign");
  assert.throws(
    () => createCanonicalBlobAssembler(memory, 32000),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});

test("identical immutable Blob is charged once while every consumer remains independently live", () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    blob = new Blob([new Uint8Array(32000)]),
    a = retainCanonicalInputBlob(blob, memory),
    b = retainCanonicalInputBlob(blob, memory);
  assert.equal(memory.snapshot().bytes, 313 + 32000 + 2 * 4096);
  a.release();
  a.release();
  assert.equal(memory.snapshot().bytes, 313 + 32000 + 4096);
  b.release();
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});

test("different Blob with identical contents and a different memory pool cannot borrow input ownership", () => {
  const memory = new AudioMemory(),
    other = new AudioMemory(),
    blob = new Blob([new Uint8Array(32000)]),
    a = retainCanonicalInputBlob(blob, memory),
    b = retainCanonicalInputBlob(new Blob([blob]), memory),
    c = retainCanonicalInputBlob(blob, other);
  assert.equal(memory.snapshot().bytes, 2 * (32000 + 4096));
  assert.equal(other.snapshot().bytes, 32000 + 4096);
  a.release();
  b.release();
  c.release();
  assert.equal(memory.snapshot().bytes, 0);
  assert.equal(other.snapshot().bytes, 0);
});

test("failed payload reservation retires only its own control and preserves previously accepted input", () => {
  const memory = new AudioMemory({ maxBytes: 45000 }),
    a = retainCanonicalInputBlob(new Blob([new Uint8Array(32000)]), memory),
    before = memory.snapshot().bytes;
  assert.throws(
    () => retainCanonicalInputBlob(new Blob([new Uint8Array(16000)]), memory),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.equal(memory.snapshot().bytes, before);
  a.release();
  assert.equal(memory.snapshot().bytes, 0);
});

test("reentrant admission shares the actual nested payload without orphaning or retiring either consumer", () => {
  const pool = new AudioMemory(),
    blob = new Blob([new Uint8Array(32000)]);
  let nested,
    entered = false;
  const memory = {
    reserve(n, label) {
      if (!entered && label === "canonical/immutable-input-blob") {
        entered = true;
        nested = retainCanonicalInputBlob(blob, memory);
      }
      return pool.reserve(n, label);
    },
  };
  const outer = retainCanonicalInputBlob(blob, memory);
  assert.equal(pool.snapshot().bytes, 32000 + 2 * 4096);
  nested.release();
  assert.equal(pool.snapshot().bytes, 32000 + 4096);
  outer.release();
  assert.equal(pool.snapshot().bytes, 0);
});
