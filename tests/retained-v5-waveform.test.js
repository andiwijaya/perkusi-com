// Retained shared/data assertions extracted before failed-feature retirement.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  waveformSlice,
  mergeWaveform,
  waveformPath,
  WAVEFORM_BINS,
} from "../src/loop-station/waveform.js";
import { AudioDocument } from "../src/loop-station/audio-document.js";
import { AudioMemory } from "../src/audio/audio-memory.js";

const hash = (b) => createHash("sha256").update(b).digest("hex");

const planes = (n) => [
  Float32Array.from({ length: n }, (_, i) => (i % 31 === 0 ? 0.75 : -0.125)),
  Float32Array.from({ length: n }, (_, i) => (i % 47 === 0 ? -1.25 : 0.0625)),
];

test("128-bin stereo envelope matches independent bin windows and irregular incremental receipt partitions", () => {
  const data = planes(1001),
    original = data.map((p) => hash(Buffer.from(p.buffer)));
  let view = null,
    start = 0;
  for (const end of [3, 17, 256, 513, 997, 1001]) {
    view = mergeWaveform(
      view,
      waveformSlice({
        capacity: 1001,
        frames: end,
        channels: 2,
        fromFrame: start,
        sample: (c, f) => data[c][f],
      }),
    );
    start = end;
  }
  for (let b = 0; b < WAVEFORM_BINS; b++) {
    const first = Math.ceil((b * 1001) / WAVEFORM_BINS),
      last = Math.ceil(((b + 1) * 1001) / WAVEFORM_BINS),
      values = data.flatMap((p) => [...p.slice(first, last)]);
    assert.equal(view.min[b], Math.min(...values));
    assert.equal(view.max[b], Math.max(...values));
    assert.equal(view.seen[b], 1);
  }
  assert.equal(view.peak, 1.25);
  assert.deepEqual(
    data.map((p) => hash(Buffer.from(p.buffer))),
    original,
  );
  const path = waveformPath(view);
  assert.equal((path.match(/M/g) ?? []).length, 128);
  assert.doesNotMatch(path, /NaN|Infinity/);
  assert.equal(view.peak, 1.25, "drawing bounds cannot clamp raw extrema");
});

test("partial empty bins are unreceived rather than invented silence; bad ranges/nonfinite PCM refuse", () => {
  const w = waveformSlice({
    capacity: 1024,
    frames: 17,
    channels: 1,
    sample: () => 0.25,
  });
  assert.equal([...w.seen].filter(Boolean).length, 3);
  assert.equal(w.seen[3], 0);
  assert.equal(w.frames, 17);
  for (const args of [
    { capacity: 0, frames: 0 },
    { capacity: 10, frames: 11 },
    { capacity: 10, frames: 5, fromFrame: 6 },
    { capacity: Number.MAX_SAFE_INTEGER, frames: 0 },
    { capacity: 10, frames: 1, sample: () => NaN },
  ])
    assert.throws(
      () => waveformSlice({ channels: 1, sample: () => 0, ...args }),
      { code: "invalidWaveform" },
    );
  assert.throws(
    () =>
      mergeWaveform(
        w,
        waveformSlice({
          capacity: 1024,
          frames: 20,
          fromFrame: 18,
          channels: 1,
          sample: () => 0,
        }),
      ),
    { code: "invalidWaveform" },
  );
});

test("stored waveforms validate full raw hash/finite data without AudioContext and refund read budgets on errors", async () => {
  const memory = new AudioMemory(),
    raw = new Float32Array([0.25, -0.5, 0.75, -1.25]),
    blob = new Blob([raw]),
    ref = {
      kind: "recording",
      encoding: "float32le",
      channels: 1,
      frames: 4,
      bytes: 16,
      sha256: hash(Buffer.from(raw.buffer)),
    },
    doc = new AudioDocument({
      memory,
      backend: {
        entry: async () => ({
          blob,
          provenance: "Original simulated QA input",
        }),
      },
    });
  const wave = await doc.waveform(ref);
  assert.equal(wave.peak, 1.25);
  assert.equal(wave.frames, 4);
  assert.equal(memory.snapshot().bytes, 0);
  await assert.rejects(doc.waveform({ ...ref, sha256: "0".repeat(64) }), {
    code: "recordingHashMismatch",
  });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(doc.waveform(ref, { signal: abort.signal }));
  assert.equal(memory.snapshot().bytes, 0);
  assert.deepEqual([...raw], [0.25, -0.5, 0.75, -1.25]);
});
