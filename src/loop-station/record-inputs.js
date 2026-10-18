// Each physical input releases the exact producer/pad it acquired, even after
// a locale rerender, focus change or selected-track/source change.
export class RecordInputs {
  constructor() {
    this.held = new Map();
  }
  press(token, source, id) {
    if (this.held.has(token)) return false;
    if (!source.press(token, id)) return false;
    this.held.set(token, { source, id });
    return true;
  }
  release(token) {
    const x = this.held.get(token);
    if (!x) return false;
    this.held.delete(token);
    try {
      return x.source.release(token);
    } catch (error) {
      void x.source.silence?.().catch(() => {});
      throw error;
    }
  }
  clear() {
    let error;
    for (const token of [...this.held.keys()]) {
      try {
        this.release(token);
      } catch (e) {
        error ??= e;
      }
    }
    if (error) throw error;
  }
}
