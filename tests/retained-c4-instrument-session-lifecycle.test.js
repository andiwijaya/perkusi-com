// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";

test("S3 memory trim nested admission uses a fresh monotonic retry ID", () => {
  const memory = new AudioMemory({ maxBytes: 80 }),
    old = memory.reserve(64, "old");
  let nested;
  memory.registerTrimmer({}, () => {
    old.release();
    nested = memory.reserve(8, "nested");
  });
  const outer = memory.reserve(32, "outer");
  assert.equal(memory.snapshot().bytes, 40);
  assert.equal(memory.snapshot().history.sequenceFloor, 4);
  outer.release();
  nested.release();
  assert.equal(memory.snapshot().bytes, 0);
});
