import { AudioDocumentBackend } from "./audio-document-backend.js";
import {
  recordingProject,
  validateRecording,
  checkAbort,
  digest,
} from "./recording-data.js";
import { exportAudioBundle } from "./audio-bundle.js";
import { fail } from "../project/instrument-contract.js";
import { waveformSlice } from "./waveform.js";

export class AudioDocument {
  constructor({ registry, memory, backend = new AudioDocumentBackend() }) {
    Object.assign(this, { registry, memory, backend });
    this.revision = null;
    this.current = null;
  }
  async entries(project, supplied = new Map(), signal) {
    const entries = new Map();
    for (const ref of project.assetRefs) {
      const entry = supplied.get(ref.id) ?? (await this.backend.entry(ref));
      await validateRecording(ref, entry, { memory: this.memory, signal });
      entries.set(ref.id, entry);
    }
    checkAbort(signal);
    return entries;
  }
  async read({ signal } = {}) {
    const doc = await this.backend.read("documents", "current");
    this.revision = doc?.revision ?? null;
    this.current = doc;
    if (!doc) return null;
    let p;
    try {
      p = JSON.parse(doc.raw);
    } catch {
      fail("draftRecoveryRequired");
    }
    const project = recordingProject(p, this.registry);
    const lease = this.entryLease(project);
    try {
      await this.entries(project, new Map(), signal);
    } finally {
      lease?.release();
    }
    return project;
  }
  entryLease(project) {
    const bytes = project.assetRefs.reduce((n, a) => n + a.bytes, 0);
    return bytes
      ? this.memory?.reserve(bytes, "recording-blob-references")
      : null;
  }
  async save(value, { entries: supplied, signal, backup } = {}) {
    const project = recordingProject(value, this.registry);
    const lease = this.entryLease(project);
    try {
      const entries = await this.entries(project, supplied, signal);
      const raw = JSON.stringify(project);
      const revision = await this.backend.commit(
        raw,
        project.assetRefs,
        entries,
        this.revision,
        { signal, backup },
      );
      // oncomplete is the commit point. A later cancellation cannot undo it.
      this.revision = revision;
      this.current = { raw, revision };
      return project;
    } finally {
      lease?.release();
    }
  }
  async portable(project, { signal } = {}) {
    const lease = this.entryLease(project);
    try {
      return await exportAudioBundle(
        project,
        await this.entries(project, new Map(), signal),
        { registry: this.registry, memory: this.memory, signal },
      );
    } finally {
      lease?.release();
    }
  }
  async resolve(
    ref,
    context,
    { memory = this.memory, signal, entry: supplied } = {},
  ) {
    checkAbort(signal);
    if (context.sampleRate !== ref.sampleRate) fail("takeRateMismatch");
    const read = memory.reserve(ref.bytes * 2, "recording-read-copy");
    let native;
    try {
      const entry = supplied ?? (await this.backend.entry(ref));
      if (
        !(entry?.blob instanceof Blob) ||
        entry.blob.size !== ref.bytes ||
        !entry.provenance
      )
        fail("missingRecording");
      const bytes = await entry.blob.arrayBuffer();
      if ((await digest(bytes)) !== ref.sha256) fail("recordingHashMismatch");
      checkAbort(signal);
      native = memory.reserve(
        ref.bytes * 2 + 8192,
        "recording-native-and-view",
      );
      const buffer = context.createBuffer(
          ref.channels,
          ref.frames,
          ref.sampleRate,
        ),
        data = new DataView(bytes);
      let peak = 0;
      for (let c = 0; c < ref.channels; c++) {
        const channel = buffer.getChannelData(c);
        for (let f = 0; f < ref.frames; f++) {
          const v = data.getFloat32((c * ref.frames + f) * 4, true);
          if (!Number.isFinite(v)) fail("invalidRecordingPCM");
          channel[f] = v;
          peak = Math.max(peak, Math.abs(v));
        }
      }
      checkAbort(signal);
      return {
        buffer,
        sha256: ref.sha256,
        peak,
        release: () => native.release(),
      };
    } catch (e) {
      native?.release();
      throw e;
    } finally {
      read.release();
    }
  }
  async waveform(ref, { signal } = {}) {
    checkAbort(signal);
    if (
      !ref ||
      ref.kind !== "recording" ||
      ref.encoding !== "float32le" ||
      ![1, 2].includes(ref.channels) ||
      !Number.isSafeInteger(ref.frames) ||
      ref.frames < 1 ||
      ref.bytes !== ref.frames * ref.channels * 4 ||
      ref.bytes > 16 * 1024 * 1024
    )
      fail("invalidWaveform");
    const lease = this.memory.reserve(
      ref.bytes * 2 + 8192,
      "waveform-read-and-summary",
    );
    try {
      const entry = await this.backend.entry(ref);
      if (
        !(entry?.blob instanceof Blob) ||
        entry.blob.size !== ref.bytes ||
        !entry.provenance
      )
        fail("missingRecording");
      const bytes = await entry.blob.arrayBuffer();
      if ((await digest(bytes)) !== ref.sha256) fail("recordingHashMismatch");
      checkAbort(signal);
      const data = new DataView(bytes);
      return waveformSlice({
        capacity: ref.frames,
        frames: ref.frames,
        channels: ref.channels,
        sample: (c, f) => data.getFloat32((c * ref.frames + f) * 4, true),
      });
    } finally {
      lease.release();
    }
  }
}
