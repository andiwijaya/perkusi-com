// Shared by every bank using the same playback/render context. A logical
// timeout frees a request slot, but uncancellable native decodes keep their
// separate reservation until they really settle. Retrying cannot grow them.
const queues = new WeakMap();
export function contextLoadQueue(context) {
  let queue = queues.get(context);
  if (!queue) {
    queue = new LoadQueue();
    queues.set(context, queue);
  }
  return queue;
}
export class LoadQueue {
  constructor(concurrency = 2, decodeLimit = 4) {
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 4 ||
      !Number.isInteger(decodeLimit) ||
      decodeLimit < concurrency ||
      decodeLimit > 8
    )
      throw new RangeError("Invalid loading capacity");
    this.concurrency = concurrency;
    this.decodeLimit = decodeLimit;
    this.active = new Set();
    this.queued = [];
    this.nativeDecodes = 0;
    this.decodeWaiters = [];
  }
  enqueue(run, priority = 0) {
    const job = { run, priority, started: false, done: false };
    this.queued.push(job);
    this.pump();
    return () => {
      if (job.done) return;
      job.done = true;
      this.queued = this.queued.filter((item) => item !== job);
      this.active.delete(job);
      this.pump();
    };
  }
  pump() {
    this.queued.sort((a, b) => b.priority - a.priority);
    while (this.active.size < this.concurrency && this.queued.length) {
      const job = this.queued.shift();
      if (job.done) continue;
      job.started = true;
      this.active.add(job);
      // Start in a microtask so cancellation/release ownership is installed
      // before any worker continuation can finish synchronously.
      void Promise.resolve().then(() => {
        if (!job.done) return job.run();
      });
    }
  }
  acquireDecode(signal) {
    return new Promise((resolve) => {
      const waiter = { signal, resolve, abort: null };
      waiter.abort = () => {
        this.decodeWaiters = this.decodeWaiters.filter((w) => w !== waiter);
        signal.removeEventListener("abort", waiter.abort);
        resolve(null);
      };
      if (signal.aborted) return waiter.abort();
      signal.addEventListener("abort", waiter.abort, { once: true });
      this.decodeWaiters.push(waiter);
      this.pumpDecodes();
    });
  }
  pumpDecodes() {
    while (this.nativeDecodes < this.decodeLimit && this.decodeWaiters.length) {
      const waiter = this.decodeWaiters.shift();
      waiter.signal.removeEventListener("abort", waiter.abort);
      if (waiter.signal.aborted) {
        waiter.resolve(null);
        continue;
      }
      ++this.nativeDecodes;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        --this.nativeDecodes;
        this.pumpDecodes();
      });
    }
  }
  snapshot() {
    return {
      active: this.active.size,
      queued: this.queued.length,
      nativeDecodes: this.nativeDecodes,
      decodeWaiters: this.decodeWaiters.length,
      concurrency: this.concurrency,
      decodeLimit: this.decodeLimit,
    };
  }
}
