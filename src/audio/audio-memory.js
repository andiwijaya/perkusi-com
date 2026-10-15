import { ResourceBudget, MAX_EXTENSION_BYTES } from "./resource-budget.js";
import { LoadQueue } from "./load-queue.js";
import { fail, integer, frozenCopy } from "../project/instrument-contract.js";

// One admission pool for every owned context/cache/render/encoded output.
// Declared buffers and context/node allowances; not a browser/OS RSS limit.
export class AudioMemory {
  #budget;
  #counter = 0;
  #records = new Map();
  #trimmers = new Map();
  #policies = new WeakMap();
  #decodes = new LoadQueue(2, 4);
  #highWater = 0;
  constructor({ maxBytes = MAX_EXTENSION_BYTES } = {}) {
    this.#budget = new ResourceBudget({ maxBytes, historyPolicy: "monotonic" });
  }
  registerTrimmer(key, fn) {
    if (!key || typeof fn !== "function" || this.#trimmers.has(key))
      fail("invalidMemoryOwner");
    this.#trimmers.set(key, fn);
    return () => this.#trimmers.delete(key);
  }
  trim() {
    for (const fn of [...this.#trimmers.values()]) fn();
  }
  reserve(bytes, label) {
    if (
      !integer(bytes, 1, MAX_EXTENSION_BYTES) ||
      typeof label !== "string" ||
      !label
    )
      fail("invalidMemoryOwner");
    const issue = () => {
      if (this.#counter >= Number.MAX_SAFE_INTEGER) fail("memorySequenceLimit");
      return { id: "allocation-" + ++this.#counter, bytes, category: "render" };
    };
    let spec = issue();
    try {
      this.#budget.reserve(spec);
    } catch (error) {
      if (error.code !== "budgetExceeded") throw error;
      this.trim();
      // A trusted trimmer may admit nested work and advance the frontier.
      spec = issue();
      try {
        this.#budget.reserve(spec);
      } catch (cause) {
        if (cause.code === "budgetExceeded") fail("combinedMemoryLimit");
        throw cause;
      }
    }
    const id = spec.id;
    const record = { id, bytes, label, active: true };
    this.#records.set(id, record);
    this.#highWater = Math.max(this.#highWater, this.#budget.snapshot().bytes);
    return Object.freeze({
      resize: (next) => {
        if (!record.active) fail("memoryReleased");
        try {
          this.#budget.resize(id, next);
        } catch (cause) {
          if (cause.code === "budgetExceeded") fail("combinedMemoryLimit");
          throw cause;
        }
        record.bytes = next;
        this.#highWater = Math.max(
          this.#highWater,
          this.#budget.snapshot().bytes,
        );
      },
      release: () => {
        if (!record.active) return;
        record.active = false;
        this.#budget.release(id);
        this.#records.delete(id);
      },
    });
  }
  cachePolicy(context) {
    let policy = this.#policies.get(context);
    if (!policy) {
      policy = Object.freeze({
        begin: (descriptor) =>
          this.reserve(
            descriptor.encodedBytes +
              Math.max(
                descriptor.encodedBytes,
                descriptor.frames * descriptor.channels * 4,
              ),
            "sample-load/cache",
          ),
        acquireDecode: (signal) => this.#decodes.acquireDecode(signal),
      });
      this.#policies.set(context, policy);
    }
    return policy;
  }
  snapshot() {
    return frozenCopy({
      ...this.#budget.snapshot(),
      highWaterBytes: this.#highWater,
      owners: [...this.#records.values()].map(({ id, bytes, label }) => ({
        id,
        bytes,
        label,
      })),
      globalDecodes: this.#decodes.snapshot(),
    });
  }
}
