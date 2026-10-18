import { LayerHistory } from "./take-pool.js";
import { fail, frozenCopy } from "../project/instrument-contract.js";
import { gamelanWavAttribution } from "../gamelan/attribution.js";
import { isDrumAssignment, drumAttribution, drumBank } from "./drum-sources.js";
import {
  isMelodicAssignment,
  melodicBanks,
  melodicAssignmentAttribution,
} from "./melodic-sources.js";

// Runtime audio history belongs to the same workspace tracks. It is explicitly
// memory-only; neither native capabilities nor PCM are put in V4 sources/JSON.
export class SessionTakes {
  constructor(owner) {
    this.owner = owner;
    this.pool = owner.pool;
    this.history = new LayerHistory(this.pool);
    this.tracks = new Set();
    this.saved = new Map();
  }
  hasWork() {
    return this.saved.size > 0;
  }
  layers(id) {
    return this.tracks.has(id) ? this.history.layers(id) : [];
  }
  save(id, trackId, assignment = null) {
    const barrier = this.owner.beginTakeOperation(trackId);
    try {
      if (this.saved.size >= 32) fail("loopHistoryLimit");
      const x = this.owner.capture?.retained.get(id);
      if (!x?.record.cleaned) fail("captureTakeHeld");
      if (!this.tracks.has(trackId)) {
        this.history.addTrack(trackId);
        this.tracks.add(trackId);
      }
      const take = this.pool.describe(id);
      if (take.partial) fail("partialTakeNeedsReview");
      const provenance = assignment ? frozenCopy(assignment) : null;
      this.history.commit(trackId, id);
      this.owner.capture.handoffTake(id, this);
      this.saved.set(id, { trackId, take, provenance });
      return take;
    } finally {
      barrier.finish();
    }
  }
  async undo(trackId) {
    const barrier = this.owner.beginTakeOperation(trackId);
    try {
      await this.owner.stopSaved(trackId);
      return this.history.undo(trackId);
    } finally {
      barrier.finish();
    }
  }
  async redo(trackId) {
    const barrier = this.owner.beginTakeOperation(trackId);
    try {
      await this.owner.stopSaved(trackId);
      return this.history.redo(trackId);
    } finally {
      barrier.finish();
    }
  }
  async discard() {
    const barrier = this.owner.beginTakeOperation();
    try {
      await this.owner.stopSaved();
      this.history.close();
      for (const id of this.saved.keys()) {
        this.pool.unpin(id, this);
        this.pool.release(id);
      }
      this.saved.clear();
      this.tracks.clear();
      this.history = new LayerHistory(this.pool);
    } finally {
      barrier.finish();
    }
  }
  snapshot() {
    return [...this.saved.values()].map((x) => ({
      trackId: x.trackId,
      ...x.take,
      active: this.layers(x.trackId).includes(x.take.id),
    }));
  }
  attribution(id) {
    let assignment = this.saved.get(id)?.provenance;
    // Pending/partial takes have not entered session history. Their retained
    // capture record owns the exact source; current selection may be different.
    const record = this.owner.capture?.retained?.get(id)?.record;
    if (
      assignment?.format === "perkusi-mic-assignment" ||
      record?.source?.kind === "original-microphone-input"
    )
      return (
        "Perkusi.com original local microphone input. No supplied sample asset or third-party license is asserted. " +
        "Recorded at the audio context rate; browser-native input conversion may apply. " +
        "Hardware latency and listening quality UNVERIFIED. No device identifiers retained.\n" +
        JSON.stringify({
          format: "perkusi-mic-provenance",
          schemaVersion: 1,
          channels: this.pool.describe(id).channels,
          sampleRate: this.pool.describe(id).sampleRate,
        })
      );
    const descriptors = assignment
      ? assignment.sampleIds.map((sampleId) =>
          this.owner.controller.registry.sample(
            assignment.bankId,
            assignment.bankVersion,
            sampleId,
          ),
        )
      : (record?.source?.descriptors ??
        this.owner.producers?.get(this.owner.captureTrack)?.source
          .descriptors ??
        []);
    const drum = drumBank(descriptors[0]?.instrumentId);
    if (!assignment && drum)
      assignment = liveAssignment(
        record?.trackId ?? this.owner.captureTrack,
        this.owner.controller.registry,
        drum.id,
        drum.version,
        descriptors.map((d) => d.id),
      );
    if (!assignment) {
      const bank = melodicBanks(descriptors[0]?.sampleRate).find(
        (b) => b.samples[0].instrumentId === descriptors[0]?.instrumentId,
      );
      if (bank)
        assignment = liveAssignment(
          record?.trackId ?? this.owner.captureTrack,
          this.owner.controller.registry,
          bank.id,
          bank.version,
          descriptors.map((d) => d.id),
        );
    }
    const bankId = assignment?.bankId ?? "cdm-slendro";
    return (
      (bankId.startsWith("freepats-") && assignment
        ? melodicAssignmentAttribution(assignment)
        : bankId.startsWith("studio-") && assignment
          ? drumAttribution(assignment)
          : gamelanWavAttribution({
              events: descriptors.map((n) => ({
                action: "strike",
                bankId,
                sampleId: n.id,
              })),
            })) +
      "\nPerkusi.com session take: Float32 stereo capture window; may contain partial natural tails. Playback, input timing and damping are arrangement changes.\n" +
      JSON.stringify({
        assignment,
        sources: descriptors.map(({ id, sourceWorkId, licenseId, sha256 }) => ({
          id,
          sourceWorkId,
          licenseId,
          sha256,
        })),
      })
    );
  }
  wav(id) {
    const take = this.pool.describe(id),
      copy = this.pool.copyToAudioBuffer(id, this.owner.engine.context);
    let lease;
    try {
      const text =
        this.attribution(id) +
        "\n" +
        JSON.stringify({
          format: "perkusi-capture-window",
          schemaVersion: 1,
          frames: take.frames,
          capacity: take.capacity,
          startFrame: take.startFrame,
          channels: take.channels,
          sampleRate: take.sampleRate,
          reason: take.reason,
          partial: take.partial,
          deliveryProof:
            this.owner.capture?.retained?.get(id)?.record?.session?.outcome
              ?.deliveryProof ?? null,
        });
      const comment = new TextEncoder().encode(text + "\0");
      const padded = comment.length + (comment.length % 2);
      const bytes = 58 + take.validBytes + 20 + padded;
      lease = this.owner.memory.reserve(
        bytes * 2 + 8192,
        "take-WAV/export-and-blob",
      );
      const buffer = new ArrayBuffer(bytes),
        d = new DataView(buffer),
        tag = (at, text) => {
          for (let i = 0; i < text.length; i++)
            d.setUint8(at + i, text.charCodeAt(i));
        };
      tag(0, "RIFF");
      d.setUint32(4, bytes - 8, true);
      tag(8, "WAVE");
      tag(12, "fmt ");
      d.setUint32(16, 18, true);
      d.setUint16(20, 3, true);
      d.setUint16(22, take.channels, true);
      d.setUint32(24, take.sampleRate, true);
      d.setUint32(28, take.sampleRate * take.channels * 4, true);
      d.setUint16(32, take.channels * 4, true);
      d.setUint16(34, 32, true);
      d.setUint16(36, 0, true);
      tag(38, "fact");
      d.setUint32(42, 4, true);
      d.setUint32(46, take.frames, true);
      tag(50, "data");
      d.setUint32(54, take.validBytes, true);
      const channels = Array.from({ length: take.channels }, (_, ch) =>
        copy.buffer.getChannelData(ch),
      );
      for (let f = 0; f < take.frames; f++)
        for (let ch = 0; ch < take.channels; ch++)
          d.setFloat32(
            58 + (f * take.channels + ch) * 4,
            channels[ch][f],
            true,
          );
      const at = 58 + take.validBytes;
      tag(at, "LIST");
      d.setUint32(at + 4, 12 + padded, true);
      tag(at + 8, "INFO");
      tag(at + 12, "ICMT");
      d.setUint32(at + 16, comment.length, true);
      new Uint8Array(buffer, at + 20, comment.length).set(comment);
      return { buffer, take, release: () => lease.release() };
    } catch (e) {
      lease?.release();
      throw e;
    } finally {
      copy.buffer = null;
      copy.release();
    }
  }
}

export function liveAssignment(
  trackId,
  registry,
  bankId,
  bankVersion,
  sampleIds,
) {
  if (
    !/^[a-z][a-z0-9-]{0,63}$/.test(trackId) ||
    !Array.isArray(sampleIds) ||
    ![2, 3, 8].includes(sampleIds.length) ||
    new Set(sampleIds).size !== sampleIds.length
  )
    fail("invalidCaptureSource");
  const notes = sampleIds.map((id) => registry.sample(bankId, bankVersion, id));
  if (
    !isDrumAssignment(bankId, bankVersion, sampleIds, notes) &&
    !isMelodicAssignment(bankId, bankVersion, sampleIds, notes) &&
    (sampleIds.length !== 2 ||
      notes.some(
        (n) =>
          !["saron-barung", "slenthem"].includes(n.instrumentId) ||
          n.channels !== 2,
      ) ||
      notes[0].instrumentId !== notes[1].instrumentId)
  )
    fail("invalidCaptureSource");
  return frozenCopy({
    format: "perkusi-live-assignment",
    schemaVersion: 1,
    trackId,
    bankId,
    bankVersion,
    sampleIds,
  });
}
