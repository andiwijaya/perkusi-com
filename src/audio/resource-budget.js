import {
  InstrumentError,
  identifier,
  integer,
  fail,
  record,
  frozenCopy,
} from "../project/instrument-contract.js";

export const MAX_EXTENSION_BYTES = 64 * 1024 * 1024;
const MAX_ALLOCATION_RECORDS = 4096;
const categories = [
  "cache",
  "decode",
  "render",
  "encoder",
  "capture",
  "undo",
  "fx",
];
// Admission accounting only: unused by the existing loader/32MiB engine cache.
export class ResourceBudget {
  #entries = new Map();
  #used = new Set();
  #max;
  #historyPolicy;
  #sequenceFloor = 0;
  constructor({
    maxBytes = MAX_EXTENSION_BYTES,
    historyPolicy = "lifetime",
  } = {}) {
    if (
      !integer(maxBytes, 1, MAX_EXTENSION_BYTES) ||
      !["lifetime", "monotonic"].includes(historyPolicy)
    )
      fail("invalidBudget");
    this.#max = maxBytes;
    this.#historyPolicy = historyPolicy;
  }
  #get(id) {
    const e = this.#entries.get(id);
    if (!e) fail("unknownAllocation");
    return e;
  }
  #totals() {
    let bytes = 0,
      logical = 0,
      native = 0;
    for (const e of this.#entries.values()) {
      bytes += e.bytes;
      logical += Number(e.logical);
      native += Number(e.native);
    }
    return { bytes, logical, native };
  }
  reserve(spec) {
    const optional = ["logical", "native"].filter((k) =>
      Object.hasOwn(spec ?? {}, k),
    );
    record(spec, ["id", "bytes", "category", ...optional], "invalidAllocation");
    const { id, bytes, category, logical = false, native = false } = spec;
    const sequence =
      this.#historyPolicy === "monotonic" &&
      typeof id === "string" &&
      /^allocation-[1-9]\d*$/.test(id)
        ? Number(id.slice(11))
        : null;
    if (
      !identifier(id) ||
      (this.#historyPolicy === "lifetime"
        ? this.#used.has(id) || this.#used.size >= MAX_ALLOCATION_RECORDS
        : !integer(sequence, 1, Number.MAX_SAFE_INTEGER) ||
          sequence <= this.#sequenceFloor ||
          this.#entries.size >= MAX_ALLOCATION_RECORDS) ||
      !integer(bytes, 1, this.#max) ||
      !categories.includes(category) ||
      typeof logical !== "boolean" ||
      typeof native !== "boolean" ||
      ((logical || native) && category !== "decode")
    )
      fail("invalidAllocation");
    const sum = this.#totals();
    if (
      sum.bytes + bytes > this.#max ||
      sum.logical + Number(logical) > 2 ||
      sum.native + Number(native) > 4
    )
      fail("budgetExceeded");
    const e = {
      id,
      bytes,
      category,
      logical,
      native,
      cancelled: false,
      pins: new Set(),
    };
    this.#entries.set(id, e);
    // The opt-in cache issues canonical increasing allocation-N IDs at admission.
    // A single frontier rejects every old ID, including terminal IDs, forever.
    // Live older IDs remain in #entries until their real release/settlement.
    if (this.#historyPolicy === "monotonic") this.#sequenceFloor = sequence;
    else this.#used.add(id);
    return this.revalidate(id, bytes);
  }
  resize(id, bytes) {
    const e = this.#get(id);
    if (
      !integer(bytes, 1, this.#max) ||
      (e.category === "cache" && bytes !== e.bytes)
    )
      fail("invalidAllocation");
    if (this.#totals().bytes - e.bytes + bytes > this.#max)
      fail("budgetExceeded");
    e.bytes = bytes;
    return this.revalidate(id, bytes);
  }
  revalidate(id, actualBytes) {
    const e = this.#get(id);
    if (
      !integer(actualBytes, 1, this.#max) ||
      actualBytes !== e.bytes ||
      this.#totals().bytes > this.#max
    )
      fail("invalidAllocation");
    return frozenCopy({ ...e, pins: [...e.pins] });
  }
  pin(id, owner) {
    const e = this.#get(id);
    if (!identifier(owner) || e.native || e.logical || e.category === "decode")
      fail("invalidPin");
    e.pins.add(owner);
  }
  unpin(id, owner) {
    const e = this.#get(id);
    if (!e.pins.has(owner)) fail("unknownPin");
    e.pins.delete(owner);
  }
  release(id) {
    const e = this.#get(id);
    if (e.native || e.pins.size) fail("allocationHeld");
    this.#entries.delete(id);
  }
  cancel(id) {
    const e = this.#get(id);
    if (e.category !== "decode") fail("invalidAllocation");
    if (e.native) {
      e.logical = false;
      e.cancelled = true;
    } else this.#entries.delete(id);
  }
  activateNative(id) {
    const e = this.#get(id);
    if (e.category !== "decode" || e.native || e.cancelled)
      fail("invalidCompletion");
    if (this.#totals().native >= 4) fail("budgetExceeded");
    // A projected allocation becomes a physical decode reservation only once
    // the shared context queue has granted a native slot. Bytes do not change.
    e.native = true;
  }
  // Completion is terminal. Caller supplies the physical-output discard callback.
  // This function never retains the buffer; the caller publishes only on true.
  settle(id, actualBytes, category, { discard } = {}) {
    const e = this.#get(id);
    if (!e.native) fail("invalidCompletion");
    let error = null;
    if (
      typeof discard !== "function" ||
      category !== "cache" ||
      !integer(actualBytes, 1, this.#max)
    )
      error = new InstrumentError("invalidCompletion");
    else if (
      !e.cancelled &&
      this.#totals().bytes - e.bytes + actualBytes > this.#max
    )
      error = new InstrumentError("budgetExceeded");
    if (error || e.cancelled) {
      this.#entries.delete(id); // Release logical/native/bytes before reentrant cleanup.
      if (typeof discard === "function") {
        try {
          discard();
        } catch (cause) {
          throw new InstrumentError(error?.code ?? "discardFailed", { cause });
        }
      }
      if (error) throw error;
      return false;
    }
    e.bytes = actualBytes;
    e.category = category;
    e.native = false;
    e.logical = false;
    return true;
  }
  reject(id) {
    const e = this.#get(id);
    if (e.category !== "decode") fail("invalidCompletion");
    this.#entries.delete(id);
  }
  snapshot() {
    return frozenCopy({
      maxBytes: this.#max,
      ...this.#totals(),
      history: {
        policy: this.#historyPolicy,
        storedIds: this.#used.size,
        sequenceFloor: this.#sequenceFloor,
        recordLimit: MAX_ALLOCATION_RECORDS,
      },
      allocations: [...this.#entries.values()].map((e) => ({
        ...e,
        pins: [...e.pins],
      })),
    });
  }
}
