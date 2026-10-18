import { AudioMemory } from "../audio/audio-memory.js";
import { integer, fail, frozenCopy } from "../project/instrument-contract.js";
import { waveformSlice } from "./waveform.js";

// Transient float takes only. Durable IDB/portable bytes belong to S7.
export class TakePool {
  #memory;
  #pending = new WeakMap();
  #takes = new Map();
  #next = 0;
  constructor(memory) {
    if (!(memory instanceof AudioMemory)) fail("invalidLoopMemory");
    this.#memory = memory;
  }
  usesMemory(memory) {
    return this.#memory === memory;
  }
  reserve({ capacity, channels, sampleRate }) {
    if (
      !integer(sampleRate, 8000, 192000) ||
      ![1, 2].includes(channels) ||
      !integer(capacity, 1, sampleRate * 32)
    )
      fail("invalidTakeGeometry");
    const key = Object.freeze({ capacity, channels, sampleRate });
    const lease = this.#memory.reserve(
      capacity * channels * 4,
      "loop-take-float",
    );
    this.#pending.set(key, lease);
    return key;
  }
  cancel(reservation) {
    const lease = this.#pending.get(reservation);
    if (!lease) return;
    this.#pending.delete(reservation);
    lease.release();
  }
  adopt(reservation, metadata, buffers) {
    const lease = this.#pending.get(reservation);
    if (!lease) fail("unknownTakeReservation");
    const { capacity, channels, sampleRate } = reservation;
    if (
      metadata.capacity !== capacity ||
      metadata.channels !== channels ||
      metadata.sampleRate !== sampleRate ||
      !integer(metadata.startFrame, 0, Number.MAX_SAFE_INTEGER) ||
      !integer(metadata.frames, 1, capacity) ||
      typeof metadata.reason !== "string" ||
      (metadata.reason === "complete" && metadata.frames !== capacity) ||
      !Array.isArray(buffers) ||
      buffers.length !== channels ||
      buffers.some(
        (b) => !(b instanceof ArrayBuffer) || b.byteLength !== capacity * 4,
      ) ||
      new Set(buffers).size !== channels
    )
      fail("invalidTakeReceipt");
    let peak = 0;
    for (const b of buffers)
      for (const v of new Float32Array(b, 0, metadata.frames)) {
        if (!Number.isFinite(v)) fail("invalidTakeReceipt");
        peak = Math.max(peak, Math.abs(v));
      }
    // Detach caller aliases: the immutable original is owned privately here.
    const owned = structuredClone(buffers, { transfer: buffers });
    const id = "take-" + ++this.#next;
    const info = frozenCopy({
      id,
      capacity,
      channels,
      sampleRate,
      frames: metadata.frames,
      startFrame: metadata.startFrame,
      reason: metadata.reason,
      partial: metadata.reason !== "complete",
      peak,
      bytes: capacity * channels * 4,
      validBytes: metadata.frames * channels * 4,
      persistence: "memory-only",
    });
    this.#pending.delete(reservation);
    this.#takes.set(id, { info, buffers: owned, lease, pins: new Set() });
    return info;
  }
  #get(id) {
    const take = this.#takes.get(id);
    if (!take) fail("unknownTake");
    return take;
  }
  describe(id) {
    return this.#get(id).info;
  }
  waveform(id, fromFrame = 0) {
    const t = this.#get(id),
      planes = t.buffers.map((b) => new Float32Array(b, 0, t.info.frames));
    return waveformSlice({
      capacity: t.info.capacity,
      frames: t.info.frames,
      channels: t.info.channels,
      fromFrame,
      sample: (c, f) => planes[c][f],
    });
  }
  pin(id, owner) {
    this.#get(id).pins.add(owner);
  }
  unpin(id, owner) {
    this.#get(id).pins.delete(owner);
  }
  release(id) {
    const take = this.#get(id);
    if (take.pins.size) fail("takeHeld");
    this.#takes.delete(id);
    take.buffers = null;
    take.lease.release();
  }
  copyPCM(id) {
    const t = this.#get(id),
      d = t.info,
      lease = this.#memory.reserve(d.validBytes, "take-planar-float32le-copy");
    try {
      const buffer = new ArrayBuffer(d.validBytes),
        view = new DataView(buffer);
      for (let c = 0; c < d.channels; c++) {
        const source = new Float32Array(t.buffers[c], 0, d.frames);
        for (let f = 0; f < d.frames; f++)
          view.setFloat32((c * d.frames + f) * 4, source[f], true);
      }
      return { buffer, take: d, release: () => lease.release() };
    } catch (e) {
      lease.release();
      throw e;
    }
  }
  copyToAudioBuffer(id, context) {
    const t = this.#get(id),
      d = t.info;
    if (context.sampleRate !== d.sampleRate) fail("takeRateMismatch");
    const lease = this.#memory.reserve(
      d.validBytes + 4096,
      "loop-native-playback-copy",
    );
    try {
      const buffer = context.createBuffer(d.channels, d.frames, d.sampleRate);
      for (let c = 0; c < d.channels; c++)
        buffer.copyToChannel(new Float32Array(t.buffers[c], 0, d.frames), c);
      return { buffer, release: () => lease.release() };
    } catch (e) {
      lease.release();
      throw e;
    }
  }
  snapshot() {
    return [...this.#takes.values()].map((t) => ({
      ...t.info,
      pins: t.pins.size,
    }));
  }
}

export class LayerHistory {
  #pool;
  #tracks = new Map();
  #pins = new Set();
  #closed = false;
  constructor(pool) {
    this.#pool = pool;
  }
  addTrack(id) {
    if (
      this.#closed ||
      !/^[a-z0-9-]{1,64}$/.test(id) ||
      this.#tracks.has(id) ||
      this.#tracks.size >= 8
    )
      fail("invalidLoopTrack");
    this.#tracks.set(id, { layers: [], undo: [], redo: [] });
  }
  #track(id) {
    if (this.#closed || !this.#tracks.has(id)) fail("invalidLoopTrack");
    return this.#tracks.get(id);
  }
  #sync() {
    const used = new Set();
    for (const t of this.#tracks.values())
      for (const layers of [t.layers, ...t.undo, ...t.redo])
        for (const id of layers) used.add(id);
    for (const id of used) if (!this.#pins.has(id)) this.#pool.pin(id, this);
    for (const id of this.#pins) if (!used.has(id)) this.#pool.unpin(id, this);
    this.#pins = used;
  }
  commit(trackId, takeId, { overdub = false } = {}) {
    const t = this.#track(trackId),
      incoming = this.#pool.describe(takeId);
    if (typeof overdub !== "boolean") fail("invalidLoopTrack");
    if (incoming.partial) fail("partialTakeNeedsReview");
    if (overdub && t.layers.length) {
      const first = this.#pool.describe(t.layers[0]);
      if (
        incoming.frames !== first.frames ||
        incoming.sampleRate !== first.sampleRate
      )
        fail("overdubGeometryMismatch");
    }
    if (t.undo.length >= 32 || t.layers.includes(takeId))
      fail("loopHistoryLimit");
    t.undo.push([...t.layers]);
    t.layers = overdub ? [...t.layers, takeId] : [takeId];
    t.redo = [];
    this.#sync();
    return this.layers(trackId);
  }
  undo(id) {
    const t = this.#track(id);
    if (!t.undo.length) return false;
    t.redo.push(t.layers);
    t.layers = t.undo.pop();
    this.#sync();
    return true;
  }
  redo(id) {
    const t = this.#track(id);
    if (!t.redo.length) return false;
    t.undo.push(t.layers);
    t.layers = t.redo.pop();
    this.#sync();
    return true;
  }
  layers(id) {
    return Object.freeze([...this.#track(id).layers]);
  }
  availability(id) {
    const t = this.#track(id);
    return Object.freeze({ undo: t.undo.length > 0, redo: t.redo.length > 0 });
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const id of this.#pins) this.#pool.unpin(id, this);
    this.#pins.clear();
    this.#tracks.clear();
  }
}
