// Physical input tokens retain the pad selected at press time, not current focus.
export class HeldPadInputs {
  #tokens = new Map();
  #pads = new Map();
  #activate;
  #deactivate;
  constructor({ activate, deactivate }) {
    this.#activate = activate;
    this.#deactivate = deactivate;
  }
  owns(token) {
    return this.#tokens.has(token);
  }
  press(token, pad) {
    if (!pad || this.#tokens.has(token)) return false;
    const owners = this.#pads.get(pad) ?? new Set();
    this.#tokens.set(token, pad);
    this.#pads.set(pad, owners);
    owners.add(token);
    if (owners.size === 1) this.#activate(pad);
    return true;
  }
  release(token) {
    const pad = this.#tokens.get(token);
    if (!pad) return false;
    this.#tokens.delete(token);
    const owners = this.#pads.get(pad);
    owners.delete(token);
    if (!owners.size) {
      this.#pads.delete(pad);
      this.#deactivate(pad, true);
    }
    return true;
  }
  clear({ damp = true } = {}) {
    const pads = [...this.#pads.keys()];
    this.#tokens.clear();
    this.#pads.clear();
    pads.forEach((pad) => this.#deactivate(pad, damp));
  }
}
