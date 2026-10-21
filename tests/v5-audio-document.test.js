import test from "node:test";
import assert from "node:assert/strict";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { audioDocumentFixture } from "./helpers/retirement-data-fixtures.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import {
  adoptRecording,
  digest,
  validateRecording,
  checkAbort,
} from "../src/loop-station/recording-data.js";
import {
  exportAudioBundle,
  importAudioBundle,
} from "../src/loop-station/audio-bundle.js";
import { AudioDocument } from "../src/loop-station/audio-document.js";

const registry = new InstrumentRegistry(catalog.banks);
async function fixture() {
  const memory = new AudioMemory();
  const { empty, take, project, ref, pcmSHA256, pcmBytes } =
    audioDocumentFixture();
  // Directly owned synthetic planar PCM: no TakePool or history substitute.
  // The source and each exported copy have separate real AudioMemory leases.
  const planar = new Float32Array(take.frames * 2);
  for (const c of [0, 1])
    planar.set(
      Float32Array.from({ length: take.frames }, (_, f) =>
        f === 0 ? -0 : Math.sin(f / 37) * (c ? -0.04 : 0.05),
      ),
      c * take.frames,
    );
  let source = planar.buffer;
  assert.equal(source.byteLength, pcmBytes);
  assert.equal(await digest(source), pcmSHA256);
  const sourceLease = memory.reserve(pcmBytes, "QA immutable planar source");
  function clonePCM() {
    const lease = memory.reserve(pcmBytes, "QA independent planar copy");
    return { buffer: source.slice(0), release: () => lease.release() };
  }
  const original = clonePCM(),
    hash = pcmSHA256;
  const entry = {
    blob: new Blob([original.buffer]),
    provenance: "CC-BY-4.0; fixture origin and exact source SHA256 " + hash,
  };
  return {
    memory,
    take,
    original,
    hash,
    empty,
    project,
    ref,
    entry,
    clonePCM,
    entries: new Map([[ref.id, entry]]),
    close() {
      original.buffer = null;
      original.release();
      assert.equal(memory.snapshot().bytes, pcmBytes);
      source = null;
      sourceLease.release();
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
}
class MemoryBackend {
  doc = null;
  assets = new Map();
  failure = null;
  async read() {
    return this.doc;
  }
  async entry(ref) {
    return this.assets.get(ref.id) ?? {};
  }
  async commit(raw, refs, entries, expected, { signal } = {}) {
    checkAbort(signal);
    if (this.failure)
      throw Object.assign(Error(this.failure), { code: this.failure });
    if ((this.doc?.revision ?? null) !== expected)
      throw Object.assign(Error("conflict"), { code: "draftConflict" });
    const revision = (expected ?? 0) + 1;
    for (const ref of refs) this.assets.set(ref.id, entries.get(ref.id));
    this.doc = { raw, revision };
    return revision;
  }
}
test("canonical planar PCM and complete portable roundtrip preserve every byte, negative zero and credits", async () => {
  const f = await fixture(),
    baseline = f.memory.snapshot().bytes;
  assert.equal(new DataView(f.original.buffer).getFloat32(0, true), -0);
  const bundle = await exportAudioBundle(f.project, f.entries, {
    registry,
    memory: f.memory,
  });
  const parsed = await importAudioBundle(bundle.blob, {
    registry,
    memory: f.memory,
  });
  assert.deepEqual(parsed.project, f.project);
  assert.equal(parsed.entries.get(f.ref.id).provenance, f.entry.provenance);
  assert.equal(
    await digest(await parsed.entries.get(f.ref.id).blob.arrayBuffer()),
    f.hash,
  );
  assert.deepEqual(
    new Uint8Array(await parsed.entries.get(f.ref.id).blob.arrayBuffer()),
    new Uint8Array(f.original.buffer),
  );
  parsed.release();
  bundle.release();
  assert.equal(f.memory.snapshot().bytes, baseline);
  f.close();
});
test("portable import rejects missing, corrupt, nonfinite, overlapping, trailing and truncated payloads without publishing data", async () => {
  const f = await fixture(),
    baseline = f.memory.snapshot().bytes;
  const bundle = await exportAudioBundle(f.project, f.entries, {
      registry,
      memory: f.memory,
    }),
    bytes = new Uint8Array(await bundle.blob.arrayBuffer());
  for (const blob of [
    new Blob([bytes.slice(0, -4)]),
    new Blob([bytes, new Uint8Array([0])]),
    new Blob([bytes.slice(0, 47)]),
  ])
    await assert.rejects(
      importAudioBundle(blob, { registry, memory: f.memory }),
    );
  for (const index of [20, 48, bytes.length - 20]) {
    const changed = bytes.slice();
    changed[index] ^= 1;
    await assert.rejects(
      importAudioBundle(new Blob([changed]), { registry, memory: f.memory }),
      { code: "recordingHashMismatch" },
    );
  }
  const view = new DataView(bytes.buffer),
    size = view.getUint32(12, true),
    manifest = JSON.parse(new TextDecoder().decode(bytes.slice(48, 48 + size)));
  manifest.payloads[0].offset = 4;
  const m = new TextEncoder().encode(JSON.stringify(manifest)),
    header = bytes.slice(0, 48);
  new DataView(header.buffer).setUint32(12, m.length, true);
  header.set(
    Uint8Array.from((await digest(m)).match(/../g).map((v) => parseInt(v, 16))),
    16,
  );
  await assert.rejects(
    importAudioBundle(new Blob([header, m, bytes.slice(48 + size)]), {
      registry,
      memory: f.memory,
    }),
    { code: "invalidAudioBundle" },
  );
  const nonfinite = f.original.buffer.slice(0);
  new DataView(nonfinite).setFloat32(0, NaN, true);
  await assert.rejects(
    validateRecording(
      { ...f.ref, sha256: await digest(nonfinite) },
      { ...f.entry, blob: new Blob([nonfinite]) },
      { memory: f.memory },
    ),
    { code: "invalidRecordingPCM" },
  );
  await assert.rejects(
    exportAudioBundle(f.project, new Map(), { registry, memory: f.memory }),
  );
  bundle.release();
  assert.equal(f.memory.snapshot().bytes, baseline);
  f.close();
});
test("document save/reload and explicit previous/current snapshots retain real audio; cancellation, quota, CAS and invalid JSON preserve original document and PCM", async () => {
  const f = await fixture(),
    backend = new MemoryBackend(),
    store = new AudioDocument({ registry, memory: f.memory, backend });
  await store.save(f.empty);
  await store.save(f.project, { entries: f.entries });
  const saved = structuredClone(backend.doc),
    reload = new AudioDocument({ registry, memory: f.memory, backend });
  assert.deepEqual(await reload.read(), f.project);
  // AudioDocument snapshot persistence, independently of retired LoopHistory.
  await store.save(structuredClone(f.empty));
  await store.save(structuredClone(f.project));
  assert.equal(
    await digest(await backend.assets.get(f.ref.id).blob.arrayBuffer()),
    f.hash,
  );
  const current = structuredClone(backend.doc),
    abort = new AbortController();
  abort.abort();
  await assert.rejects(store.save(f.empty, { signal: abort.signal }), {
    code: "cancelled",
  });
  backend.failure = "audioStorageFull";
  await assert.rejects(store.save(f.empty), { code: "audioStorageFull" });
  backend.failure = null;
  await assert.rejects(reload.save(f.empty), { code: "draftConflict" });
  const missing = structuredClone(f.project);
  missing.assetRefs[0].id = "unknown-audio";
  missing.tracks[0].clips[0].sourceId = "unknown-audio";
  await assert.rejects(store.save(missing), { code: "missingRecording" });
  assert.deepEqual(backend.doc, current);
  assert.equal(JSON.parse(saved.raw).assetRefs[0].sha256, f.hash);
  // The old title mentioned invalid JSON without exercising that read path.
  // Keep the malformed original unchanged while refusing to publish a project.
  const malformed = { raw: "{not-json", revision: current.revision };
  backend.doc = structuredClone(malformed);
  const recovery = new AudioDocument({ registry, memory: f.memory, backend });
  await assert.rejects(recovery.read(), { code: "draftRecoveryRequired" });
  assert.deepEqual(backend.doc, malformed);
  assert.equal(
    await digest(await backend.assets.get(f.ref.id).blob.arrayBuffer()),
    f.hash,
  );
  backend.doc = current;
  const verification = f.clonePCM();
  try {
    assert.equal(await digest(verification.buffer), f.hash);
  } finally {
    verification.buffer = null;
    verification.release();
  }
  f.close();
});
test("recording adoption refuses occupied, partial and non-bar takes while retaining the source", async () => {
  const f = await fixture();
  assert.throws(
    () => adoptRecording(f.project, registry, "track-1", f.take, f.hash),
    { code: "recorderEmptyTarget" },
  );
  assert.throws(
    () =>
      adoptRecording(
        f.empty,
        registry,
        "track-2",
        { ...f.take, partial: true },
        f.hash,
      ),
    { code: "partialTakeNeedsReview" },
  );
  assert.throws(
    () =>
      adoptRecording(
        f.empty,
        registry,
        "track-2",
        { ...f.take, frames: f.take.frames - 1 },
        f.hash,
      ),
    { code: "overdubGeometryMismatch" },
  );
  assert.equal(await digest(f.original.buffer), f.hash);
  f.close();
});
test("recording resolver validates actual PCM and keeps the native lease until explicit idempotent release", async () => {
  const f = await fixture(),
    backend = new MemoryBackend(),
    store = new AudioDocument({ registry, memory: f.memory, backend });
  await store.save(f.project, { entries: f.entries });
  const before = f.memory.snapshot().bytes;
  const context = {
    sampleRate: 48000,
    createBuffer(channels, frames, sampleRate) {
      const a = Array.from(
        { length: channels },
        () => new Float32Array(frames),
      );
      return {
        length: frames,
        numberOfChannels: channels,
        sampleRate,
        getChannelData: (c) => a[c],
      };
    },
  };
  const resolved = await store.resolve(f.ref, context);
  assert.ok(f.memory.snapshot().bytes > before);
  assert.equal(resolved.sha256, f.hash);
  assert.ok(resolved.peak > 0.04);
  const planar = new Uint8Array(f.ref.bytes);
  for (const c of [0, 1])
    planar.set(
      new Uint8Array(resolved.buffer.getChannelData(c).buffer),
      c * f.ref.frames * 4,
    );
  assert.equal(await digest(planar), f.hash);
  resolved.release();
  resolved.release();
  assert.equal(f.memory.snapshot().bytes, before);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    store.resolve(f.ref, context, { signal: abort.signal }),
    { code: "cancelled" },
  );
  assert.equal(f.memory.snapshot().bytes, before);
  f.close();
});
