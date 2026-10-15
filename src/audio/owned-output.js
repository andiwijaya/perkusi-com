import { fail } from "../project/instrument-contract.js";

// One owned Blob and at most one browser URL share the same admission lifetime.
export class OwnedOutput {
  #blob;
  #allocation;
  #url = null;
  #create;
  #revoke;
  #closing = false;
  #consumers = 0;
  #settle;
  #released;
  constructor(
    blob,
    allocation,
    {
      createURL = (value) => URL.createObjectURL(value),
      revokeURL = (value) => URL.revokeObjectURL(value),
    } = {},
  ) {
    this.#blob = blob;
    this.#allocation = allocation;
    this.#create = createURL;
    this.#revoke = revokeURL;
    this.#released = new Promise((resolve) => {
      this.#settle = resolve;
    });
  }
  get blob() {
    if (!this.#allocation || this.#closing) fail("exportReleased");
    return this.#blob;
  }
  downloadURL() {
    if (!this.#allocation || this.#closing) fail("exportReleased");
    this.#url ??= this.#create(this.#blob);
    return this.#url;
  }
  release() {
    if (!this.#allocation) return;
    // Revoke before releasing admission; failed revocation keeps ownership.
    if (this.#url !== null) this.#revoke(this.#url);
    this.#url = null;
    this.#closing = true;
    this.#finish();
  }
  #finish() {
    if (!this.#closing || this.#consumers || !this.#allocation) return;
    this.#blob = null;
    this.#allocation.release();
    this.#allocation = null;
    this.#settle();
  }
  get released() {
    return this.#released;
  }
  get active() {
    return !!this.#allocation && !this.#closing;
  }
  retain() {
    if (!this.#allocation || this.#closing) fail("exportReleased");
    if (this.#consumers >= 64) fail("outputConsumerLimit");
    ++this.#consumers;
    const thisOwner = this;
    let held = true;
    return Object.freeze({
      get blob() {
        if (!held) fail("exportReleased");
        return thisOwner.#blob;
      },
      release: () => {
        if (!held) return;
        held = false;
        --this.#consumers;
        this.#finish();
      },
    });
  }
}
