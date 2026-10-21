import { FileDelivery } from "../project/files.js";
import { fail } from "../project/instrument-contract.js";

// The ready File owns an independent conservative byte reservation. A native
// share keeps that reservation until its promise settles, even after an edit.
export class CanonicalWavDelivery {
  constructor({
    memory,
    readRevision,
    delivery = new FileDelivery(),
    FileClass = globalThis.File,
    timers = globalThis,
  }) {
    Object.assign(this, { memory, readRevision, delivery, FileClass, timers });
    this.ready = null;
    this.active = new Set();
    this.disposed = false;
    this.epoch = 0;
    this.untrim = memory.registerTrimmer(this, () => this.clear());
    this.downloads = new Map();
    if (delivery instanceof FileDelivery) {
      const download = delivery.download.bind(delivery);
      delivery.download = (file, name) => {
        const lease = memory.reserve(
          file.size + 4096,
          "canonical/share-download-URL",
        );
        try {
          download(file, name);
          // FileDelivery revokes its actual URL after1000ms. Keep the byte
          // reservation conservatively through1100ms, or explicit dispose.
          const timer = timers.setTimeout(() => {
            this.downloads.delete(timer);
            lease.release();
          }, 1100);
          this.downloads.set(timer, lease);
        } catch (e) {
          lease.release();
          throw e;
        }
      };
    }
  }
  clear() {
    this.epoch++;
    const old = this.ready;
    this.ready = null;
    if (old && !old.active) old.lease.release();
  }
  remember(blob, name, revision) {
    this.clear();
    if (this.disposed || revision !== this.readRevision()) return false;
    const epoch = this.epoch;
    const lease = this.memory.reserve(
      blob.size + 4096,
      "canonical/share-ready-WAV",
    );
    try {
      const file = new this.FileClass([blob], name, { type: "audio/wav" });
      if (
        this.disposed ||
        epoch !== this.epoch ||
        revision !== this.readRevision()
      ) {
        lease.release();
        return false;
      }
      this.ready = { file, revision, lease, active: false };
      return true;
    } catch (e) {
      lease.release();
      throw e;
    }
  }
  snapshot() {
    if (this.ready && this.ready.revision !== this.readRevision()) this.clear();
    return {
      ready: !!this.ready && !this.disposed,
      sharing: this.active.size > 0,
      native: !!this.ready && this.delivery.canShare(this.ready.file),
      name: this.ready?.file.name ?? "",
    };
  }
  download() {
    if (!this.snapshot().ready) fail("deliveryFailed");
    this.delivery.download(this.ready.file, this.ready.file.name);
  }
  share() {
    if (!this.snapshot().ready || this.active.size) fail("deliveryFailed");
    const row = this.ready;
    row.active = true;
    // Call synchronously in the click activation, before any await/microtask.
    let task;
    try {
      task = this.delivery.share(row.file);
    } catch (e) {
      row.active = false;
      throw e;
    }
    const settled = Promise.resolve(task).finally(() => {
      this.active.delete(settled);
      row.active = false;
      if (this.ready !== row) row.lease.release();
    });
    this.active.add(settled);
    return settled;
  }
  async dispose() {
    this.disposed = true;
    this.untrim();
    this.clear();
    await Promise.allSettled([...this.active]);
    this.delivery.dispose();
    for (const [timer, lease] of this.downloads) {
      this.timers.clearTimeout(timer);
      lease.release();
    }
    this.downloads.clear();
  }
}
