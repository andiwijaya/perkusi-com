import { finalCopy } from "./final-copy.js";
import { fail } from "../project/instrument-contract.js";
export class FinalPanel {
  constructor({
    exporter,
    owner,
    project,
    locale,
    busy,
    act,
    preview,
    refresh,
  }) {
    Object.assign(this, {
      exporter,
      owner,
      project,
      locale,
      busy,
      act,
      preview,
      refresh,
    });
    this.pending = false;
    this.ready = null;
    this.progress = null;
    this.bars = 4;
    this.urls = new Map();
    this.pins = new Map();
    this.shares = new Set();
    this.generation = 0;
    this.message = "";
  }
  text() {
    return finalCopy[this.locale()];
  }
  $(id) {
    return this.element?.querySelector("#ls-final-" + id);
  }
  guard() {
    this.owner.requireDisposition();
    for (const p of this.owner.producers.values()) {
      const s = p.source.snapshot();
      if (s.tokens.length || s.voices.length) fail("recordBusy");
    }
  }
  mount(parent) {
    const t = this.text(),
      s = document.createElement("section");
    s.className = "ls-recorder";
    s.setAttribute("aria-labelledby", "ls-final-title");
    this.element = s;
    parent.append(s);
    const node = (tag, text, id) => {
      const n = document.createElement(tag);
      if (text) n.textContent = text;
      if (id) n.id = "ls-final-" + id;
      s.append(n);
      return n;
    };
    node("h2", t.title, "title");
    node("p", t.intro);
    const l = node("label", t.bars),
      select = document.createElement("select");
    select.id = "ls-final-bars";
    for (const n of [4, 8]) {
      const o = document.createElement("option");
      o.value = String(n);
      o.textContent = n + " bar";
      select.append(o);
    }
    select.value = String(this.bars);
    select.onchange = () => {
      this.bars = Number(select.value);
    };
    l.append(select);
    const tools = node("div");
    tools.className = "ls-toolbar";
    const button = (id, label, fn) => {
      const b = document.createElement("button");
      b.id = "ls-final-" + id;
      b.type = "button";
      b.textContent = label;
      b.onclick = () => void this.act(fn);
      tools.append(b);
    };
    button("preview", t.preview, () => {
      this.guard();
      return this.preview(this.bars);
    });
    button("render", t.render, () => this.render());
    button("cancel", t.cancel, () => this.exporter.cancel());
    button("download", t.download, () => this.download());
    button("share", t.share, () => this.share());
    button("clear", t.clear, () => this.release());
    node("output", "", "state").setAttribute("role", "status");
    this.update();
  }
  async render() {
    if (this.pending || this.busy()) fail("finalMixBusy");
    this.guard();
    this.release();
    const generation = this.generation;
    this.pending = true;
    this.progress = { phase: "preparing", value: 0 };
    this.refresh();
    try {
      const result = await this.exporter.render(this.project(), {
        bars: this.bars,
        onProgress: (p) => {
          this.progress = p;
          this.refresh();
        },
      });
      if (generation === this.generation) this.ready = result;
      else result.release();
    } finally {
      this.pending = false;
      this.progress = null;
      this.refresh();
    }
  }
  pin(result) {
    this.pins.set(result, (this.pins.get(result) ?? 0) + 1);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const count = this.pins.get(result) - 1;
      if (count) this.pins.set(result, count);
      else {
        this.pins.delete(result);
        if (this.ready !== result) result.release();
      }
    };
  }
  releaseURL(url) {
    const record = this.urls.get(url);
    if (!record) return;
    this.urls.delete(url);
    clearTimeout(record.timer);
    try {
      URL.revokeObjectURL(url);
    } finally {
      record.unpin();
    }
  }
  download(result = this.ready) {
    if (!result?.blob) fail("finalMixBusy");
    const unpin = this.pin(result);
    let url;
    try {
      url = URL.createObjectURL(result.blob);
      const record = { unpin, timer: null };
      this.urls.set(url, record);
      const a = document.createElement("a");
      a.href = url;
      a.download = "perkusi-final-" + result.stats.bars + "bar.wav";
      a.click();
      record.timer = setTimeout(() => this.releaseURL(url), 1500);
    } catch (e) {
      if (url) this.releaseURL(url);
      else unpin();
      throw e;
    }
  }
  async share() {
    if (!this.ready) fail("finalMixBusy");
    if (this.shares.size) fail("finalShareBusy");
    const result = this.ready,
      operation = {
        generation: this.generation,
        result,
        file: null,
        lease: null,
        unpin: this.pin(result),
      },
      current = () =>
        this.generation === operation.generation && this.ready === result;
    this.shares.add(operation);
    this.message = "";
    try {
      // Account for a possible independent File backing copy plus its wrapper.
      // Native Share is not abortable: keep this and the original WAV pin until
      // its promise actually settles, even after Clear/close/navigation.
      operation.lease = this.owner.memory.reserve(
        result.blob.size + 8192,
        "final-share-file",
      );
      operation.file = new File(
        [result.blob],
        "perkusi-final-" + result.stats.bars + "bar.wav",
        { type: "audio/wav" },
      );
      this.update();
      try {
        if (
          navigator.canShare?.({ files: [operation.file] }) &&
          navigator.share
        ) {
          await navigator.share({
            files: [operation.file],
            title: "Perkusi.com",
          });
          return;
        }
      } catch (e) {
        if (e?.name === "AbortError") return;
      }
      // A replacement result never receives an older operation's fallback or
      // message. Clear/close invalidate fallback but do not release its File.
      if (current()) {
        this.download(result);
        this.message = this.text().fallback;
      }
    } finally {
      operation.file = null;
      operation.lease?.release();
      operation.unpin();
      this.shares.delete(operation);
      this.update();
    }
  }
  release() {
    ++this.generation;
    const result = this.ready;
    this.ready = null;
    if (result && !this.pins.has(result)) result.release();
    for (const url of this.urls.keys()) this.releaseURL(url);
    this.message = "";
    this.update();
  }
  async close() {
    // Invalidate synchronously, before an outstanding render cancel can yield.
    this.release();
    await this.exporter.cancel();
  }
  update() {
    if (!this.element?.isConnected) return;
    const t = this.text(),
      busy = this.pending || this.busy(),
      set = (id, disabled) => {
        const n = this.$(id);
        if (n) n.disabled = !!disabled;
      };
    set("bars", busy);
    set("render", busy);
    set("preview", busy || this.owner.hasTakeWork());
    set("cancel", !this.pending);
    for (const id of ["download", "share", "clear"])
      set(id, this.pending || !this.ready);
    set("share", this.pending || !this.ready || this.shares.size > 0);
    const n = this.$("state");
    if (n) {
      const state = this.progress
        ? (t.phase[this.progress.phase] ?? this.progress.phase) +
          " " +
          Math.round(this.progress.value * 100) +
          "%"
        : this.ready
          ? `${t.ready} · ${this.ready.stats.bars} bar · ${(this.ready.stats.frames / this.ready.stats.rate).toFixed(2)} s · ${this.ready.stats.rate / 1000} kHz · ${t.peak}: ${this.ready.stats.prePeak.toFixed(4)} / ${this.ready.stats.postPeak.toFixed(4)} · ${this.ready.stats.limitedSamples} ${t.limited}` +
            (this.message ? " · " + this.message : "")
          : this.message;
      n.textContent = [state, this.shares.size ? t.sharing : ""]
        .filter(Boolean)
        .join(" · ");
    }
  }
}
