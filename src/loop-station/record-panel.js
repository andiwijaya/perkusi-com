import { audioCopy } from "./audio-copy.js";
import { overdubBase } from "./overdub.js";
import { overdubCopy } from "./overdub-copy.js";
import { recordCopy, partialTakeStatus } from "./record-copy.js";
import { RecordInputs } from "./record-inputs.js";
import { fail } from "../project/instrument-contract.js";
import { RECORD_INSTRUMENTS } from "./record-sources.js";
import { drumBank, DRUM_KEYS } from "./drum-sources.js";
import { melodicBank } from "./melodic-sources.js";
import { micCopy } from "./mic-copy.js";

export class RecordPanel {
  constructor({
    host,
    locale,
    selected,
    project,
    recorder,
    owner,
    busy,
    act,
    prepare,
    record,
    play,
    refresh,
    adopt,
    preview = () => fail("recordBusy"),
    canPreview = () => false,
    recover = () => fail("recordBusy"),
    waveforms = () => {},
  }) {
    Object.assign(this, {
      host,
      locale,
      selected,
      project,
      recorder,
      owner,
      busy,
      act,
      prepare,
      record,
      play,
      refresh,
      adopt,
      preview,
      canPreview,
      recover,
      waveforms,
    });
    this.inputs = new RecordInputs();
    this.pending = false;
    this.bars = 2;
    this.instrumentId = "saron-barung";
    this.confirming = null;
    this.export = null;
    this.keydown = (e) => {
      if (
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.target.closest?.("input,select,textarea,[contenteditable=true]")
      )
        return;
      const button = e.target.closest?.("[data-rec-pad]");
      const index =
        button && ["Space", "Enter"].includes(e.code)
          ? Number(button.dataset.recPad)
          : this.padKeys().findIndex((key) => e.code === "Key" + key);
      if (index < 0 || !this.playable()) return;
      e.preventDefault();
      this.press("key:" + e.code, index);
    };
    this.keyup = (e) => {
      if (
        this.inputs.held.has("key:" + e.code) &&
        ["Space", "Enter"].includes(e.code)
      )
        e.preventDefault();
      this.release("key:" + e.code);
    };
    this.pointerEnd = (e) => this.release("pointer:" + e.pointerId);
    this.blur = () => {
      try {
        this.inputs.clear();
      } catch (e) {
        void this.act(() => {
          throw e;
        });
      }
      void this.recorder()
        ?.source?.silence()
        .catch(() => {});
      this.update();
    };
    this.visibility = () => {
      if (document.hidden) this.blur();
    };
    document.addEventListener("keydown", this.keydown);
    document.addEventListener("keyup", this.keyup);
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      document.addEventListener(event, this.pointerEnd);
    window.addEventListener("blur", this.blur);
    document.addEventListener("visibilitychange", this.visibility);
    this.timer = setInterval(() => {
      this.update();
      this.waveforms();
    }, 50);
  }
  text() {
    return recordCopy[this.locale()];
  }
  $(id) {
    return this.element?.querySelector("#ls-rec-" + id);
  }
  elementFor(tag, text, parent, id) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (id) n.id = "ls-rec-" + id;
    parent?.append(n);
    return n;
  }
  button(parent, label, id, fn) {
    const b = this.elementFor("button", label, parent, id);
    b.type = "button";
    b.onclick = () => void this.run(fn);
    return b;
  }
  async run(fn) {
    if (this.pending) return;
    const confirming = this.confirming;
    this.pending = true;
    this.refresh();
    try {
      await this.act(fn);
    } finally {
      this.pending = false;
      this.refresh();
      if (!confirming && this.confirming) this.$("discard-confirm")?.focus();
      else if (confirming && !this.confirming) {
        const b = this.$(
          "discard-" + (confirming === "all" ? "all" : "current"),
        );
        (b && !b.disabled ? b : this.$("record"))?.focus();
      }
    }
  }
  playable() {
    const r = this.recorder(),
      s = r?.source?.snapshot();
    return !!(
      this.element?.isConnected &&
      !this.pending &&
      !this.busy() &&
      !r?.busy &&
      !this.confirming &&
      !this.owner.boundaries.size &&
      !this.owner.assigning &&
      !this.owner.savedBlocked(this.selected()) &&
      r?.assignment?.trackId === this.selected() &&
      r.source?.descriptors?.[0]?.instrumentId === this.instrumentId &&
      s?.accepting &&
      !s.closing &&
      !s.disposed &&
      this.owner.producers.has(this.selected()) &&
      this.owner.engine?.context.state === "running"
    );
  }
  press(token, index) {
    if (!this.playable()) return;
    const r = this.recorder();
    try {
      this.inputs.press(token, r.source, r.assignment.sampleIds[index]);
    } catch (e) {
      void this.act(() => {
        throw e;
      });
    }
    this.update();
  }
  release(token) {
    try {
      this.inputs.release(token);
    } catch (e) {
      void this.act(() => {
        throw e;
      });
    }
    this.update();
  }
  padKeys() {
    return drumBank(this.instrumentId)
      ? DRUM_KEYS
      : DRUM_KEYS.slice(0, melodicBank(this.instrumentId) ? 3 : 2);
  }
  renderPads() {
    const t = this.text(),
      bank = drumBank(this.instrumentId),
      melodic = melodicBank(this.instrumentId),
      pads = this.$("pads");
    pads.dataset.drums = String(!!bank);
    pads.replaceChildren();
    if (this.instrumentId === "microphone") return;
    for (const [index, key] of this.padKeys().entries()) {
      const label = bank
        ? t.drums[bank.samples[index].pitchId]
        : melodic
          ? t.notes[melodic.samples[index].id]
          : t.pad + " " + (index + 1);
      const b = this.elementFor(
        "button",
        key + " · " + label,
        pads,
        "pad-" + index,
      );
      b.type = "button";
      b.dataset.recPad = String(index);
      b.setAttribute("aria-describedby", "ls-rec-keys");
      b.onpointerdown = (e) => {
        if (e.button !== 0 || !this.playable()) return;
        e.preventDefault();
        this.press("pointer:" + e.pointerId, index);
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          /* Document owns release. */
        }
      };
      b.onclick = (e) => {
        if (e.detail === 0 && this.playable()) {
          try {
            const r = this.recorder();
            r.source.strike(r.assignment.sampleIds[index]);
          } catch (error) {
            void this.act(() => {
              throw error;
            });
          }
        }
      };
    }
  }
  mount(parent) {
    const t = this.text();
    this.element = this.elementFor("section", undefined, parent);
    this.element.className = "ls-recorder";
    this.element.setAttribute("aria-labelledby", "ls-rec-title");
    this.elementFor("h2", t.title, this.element, "title");
    this.elementFor("p", t.intro, this.element);
    this.elementFor("p", t.sulingPending, this.element).className = "ls-note";
    const setup = this.elementFor("div", undefined, this.element);
    setup.className = "ls-toolbar";
    const sourceLabel = this.elementFor("label", t.instrument, setup),
      sourceSelect = this.elementFor(
        "select",
        undefined,
        sourceLabel,
        "instrument",
      );
    for (const id of RECORD_INSTRUMENTS) {
      const option = this.elementFor("option", t.instruments[id], sourceSelect);
      option.value = id;
    }
    this.elementFor("option", micCopy[this.locale()].name, sourceSelect).value =
      "microphone";
    sourceSelect.value = this.instrumentId;
    sourceSelect.onchange = () => {
      this.recordError = null;
      void this.owner.stopMic?.().catch(() => {});
      this.instrumentId = sourceSelect.value;
      this.inputs.clear();
      this.renderPads();
      this.update();
    };
    this.button(setup, t.prepare, "prepare", async () => {
      this.recordError = null;
      if (
        this.project().tracks.find((x) => x.id === this.selected())?.clips
          .length
      )
        fail("recorderEmptyTarget");
      this.inputs.clear();
      await this.prepare(this.selected(), { instrumentId: this.instrumentId });
    });
    this.button(
      setup,
      overdubCopy[this.locale()].prepare,
      "overdub-prepare",
      async () => {
        this.inputs.clear();
        await this.prepare(this.selected(), {
          overdub: true,
          instrumentId: this.instrumentId,
        });
        this.bars = this.recorder().base.bars;
        this.$("bars").value = String(this.bars);
      },
    );
    this.elementFor(
      "p",
      overdubCopy[this.locale()].hint,
      this.element,
      "overdub-hint",
    ).className = "ls-rec-hint";
    this.elementFor("output", "", setup, "source");
    this.renderMicControls();
    this.elementFor(
      "p",
      t.monitor,
      this.element,
      "instrument-monitor",
    ).className = "ls-rec-hint";
    this.elementFor("p", t.keys, this.element, "keys").className =
      "ls-rec-hint";
    const pads = this.elementFor("div", undefined, this.element, "pads");
    pads.className = "ls-rec-pads";
    this.renderPads();
    const controls = this.elementFor("div", undefined, this.element);
    controls.className = "ls-toolbar";
    const label = this.elementFor("label", t.bars, controls),
      bars = this.elementFor("select", undefined, label, "bars");
    for (const n of [1, 2, 4, 8]) {
      const o = this.elementFor(
        "option",
        n + " " + (n === 1 ? t.bar : t.barsPlural),
        bars,
      );
      o.value = String(n);
    }
    bars.value = String(this.bars);
    bars.onchange = () => {
      this.bars = Number(bars.value);
    };
    this.elementFor("span", t.countIn, controls).className = "ls-rec-hint";
    this.button(controls, t.record, "record", () => this.recordAttempt());
    this.elementFor("p", t.levelHint, this.element, "level-hint").className =
      "ls-rec-hint";
    this.elementFor("p", "", this.element, "record-error").setAttribute(
      "role",
      "alert",
    );
    this.button(controls, t.preview, "preview", () => this.preview());
    this.elementFor(
      "p",
      t.previewHint,
      this.element,
      "preview-hint",
    ).className = "ls-rec-hint";
    this.elementFor("output", "", this.element, "source-state").setAttribute(
      "role",
      "status",
    );
    this.button(controls, t.stop, "stop", async () => {
      this.inputs.clear();
      await this.recorder().stop();
    });
    this.button(controls, t.cancel, "cancel", async () => {
      this.inputs.clear();
      await this.recorder().cancel();
    });
    this.elementFor("output", "", this.element, "state").setAttribute(
      "role",
      "status",
    );
    this.elementFor("p", t.pending, this.element, "pending").className =
      "ls-rec-hint";
    this.elementFor("p", "", this.element, "partial-info").setAttribute(
      "role",
      "status",
    );
    this.button(this.element, t.recover, "recover", () => this.recover());
    const review = this.elementFor("div", undefined, this.element);
    review.className = "ls-toolbar";
    this.button(review, t.save, "save", () => this.recorder().save());
    this.button(review, audioCopy[this.locale()].adopt, "adopt", () =>
      this.adopt(),
    );
    this.button(review, t.play, "play", async () => {
      if (!this.owner.engine.transport.running) await this.play();
      await this.recorder().playSaved();
    });
    this.button(review, t.undo, "undo", () =>
      this.recorder().takes.undo(this.selected()),
    );
    this.button(review, t.redo, "redo", () =>
      this.recorder().takes.redo(this.selected()),
    );
    this.button(review, t.wav, "wav", () =>
      this.download(this.recorder().current.take.id),
    );
    this.button(review, t.discardCurrent, "discard-current", () => {
      this.confirming = "current";
      this.update();
    });
    this.elementFor("p", t.warning, this.element, "warning").className =
      "ls-note";
    this.elementFor("h3", t.library, this.element);
    this.elementFor("div", undefined, this.element, "library");
    this.listSignature = "";
    this.button(this.element, t.discardAll, "discard-all", () => {
      this.confirming = "all";
      this.update();
    });
    const confirmation = this.elementFor(
      "div",
      undefined,
      this.element,
      "confirm",
    );
    confirmation.className = "ls-rec-confirm";
    confirmation.setAttribute("role", "alertdialog");
    confirmation.setAttribute("aria-labelledby", "ls-rec-discard-warning");
    this.elementFor("p", t.discardWarning, confirmation, "discard-warning");
    this.button(confirmation, t.confirm, "discard-confirm", async () => {
      this.inputs.clear();
      if (this.confirming === "all") await this.recorder().discardAll();
      else await this.recorder().discardCurrent();
      this.confirming = null;
    });
    this.button(confirmation, t.keep, "discard-keep", () => {
      this.confirming = null;
    });
    this.update();
  }
  async recordAttempt() {
    this.recordError = null;
    try {
      return await this.record({ bars: this.bars, countInBars: 1 });
    } catch (error) {
      if (error.code === "voiceHeadroom") this.recordError = "recordHeadroom";
      throw error;
    }
  }
  download(id) {
    if (this.export) fail("recordBusy");
    const wav = this.recorder().takes.wav(id);
    try {
      const url = URL.createObjectURL(
        new Blob([wav.buffer], { type: "audio/wav" }),
      );
      this.export = {
        url,
        wav,
        timer: setTimeout(() => {
          this.releaseExport();
          this.update();
        }, 1500),
      };
      const a = document.createElement("a");
      a.href = url;
      a.download = "perkusi-" + id + ".wav";
      a.click();
    } catch (e) {
      wav.release();
      throw e;
    }
  }
  releaseExport() {
    if (!this.export) return;
    const { url, wav, timer } = this.export;
    this.export = null;
    clearTimeout(timer);
    URL.revokeObjectURL(url);
    wav.buffer = null;
    wav.release();
  }
  renderMicControls() {
    const mt = micCopy[this.locale()],
      micBox = this.elementFor("section", undefined, this.element, "mic");
    micBox.className = "ls-mic";
    micBox.setAttribute("aria-labelledby", "ls-rec-mic-title");
    this.elementFor("h3", mt.title, micBox, "mic-title");
    this.elementFor("p", mt.hint, micBox, "mic-hint");
    const actions = this.elementFor("div", undefined, micBox);
    actions.className = "ls-mic-actions";
    this.button(actions, mt.enable, "mic-enable", () =>
      this.recorder().enableMic(),
    ).setAttribute("aria-describedby", "ls-rec-mic-hint");
    const micStop = this.elementFor("button", mt.stop, actions, "mic-stop");
    micStop.type = "button";
    // Cancellation must remain reachable while permission/preparation is pending.
    micStop.onclick = () => void this.act(() => this.owner.stopMic());
    const headphones = this.elementFor("label", undefined, micBox);
    headphones.className = "ls-mic-headphones";
    const headphoneConfirmation = this.elementFor(
      "input",
      undefined,
      headphones,
      "mic-headphones",
    );
    headphoneConfirmation.type = "checkbox";
    headphones.htmlFor = headphoneConfirmation.id;
    this.elementFor("span", mt.headphones, headphones);
    const monitorRow = this.elementFor("div", undefined, micBox);
    monitorRow.className = "ls-mic-actions";
    const monitor = this.elementFor(
      "button",
      mt.monitorOn,
      monitorRow,
      "mic-monitor",
    );
    monitor.type = "button";
    monitor.setAttribute("aria-describedby", "ls-rec-mic-limitation");
    monitor.onclick = () => {
      const confirmed = this.$("mic-headphones").checked;
      const enabled = this.recorder()?.source?.monitoring !== "enabled";
      void this.run(() =>
        this.owner.setMicMonitoring(this.selected(), enabled, {
          headphonesConfirmed: confirmed,
        }),
      );
    };
    const statusRow = this.elementFor("div", undefined, micBox);
    statusRow.className = "ls-mic-status-row";
    this.elementFor(
      "span",
      mt.status,
      statusRow,
      "mic-status-label",
    ).className = "ls-mic-label";
    const status = this.elementFor("output", "", statusRow, "mic-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-labelledby", "ls-rec-mic-status-label");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    const meterRow = this.elementFor("div", undefined, micBox);
    meterRow.className = "ls-mic-readout";
    const meterLabel = this.elementFor(
      "label",
      mt.meter,
      meterRow,
      "mic-meter-label",
    );
    const meter = this.elementFor("meter", undefined, meterRow, "mic-meter");
    meterLabel.htmlFor = meter.id;
    meter.min = 0;
    meter.max = 1;
    meter.value = 0;
    meter.setAttribute("aria-labelledby", meterLabel.id);
    const details = this.elementFor("div", undefined, micBox, "mic-details");
    details.className = "ls-mic-readout";
    this.elementFor(
      "span",
      mt.details,
      details,
      "mic-settings-label",
    ).className = "ls-mic-label";
    const settings = this.elementFor("output", "", details, "mic-settings");
    settings.setAttribute("aria-labelledby", "ls-rec-mic-settings-label");
    settings.setAttribute("aria-live", "off");
    this.elementFor("p", mt.limitation, micBox, "mic-limitation").className =
      "ls-rec-hint";
  }
  updateMicControls({
    r,
    s,
    selected,
    matched,
    blocked,
    active,
    pending,
    outcome,
    write,
    disable,
  }) {
    const isMic = this.instrumentId === "microphone",
      mt = micCopy[this.locale()],
      mic = this.owner.micInput,
      producer = s?.producer,
      micReady =
        matched &&
        s?.assignment?.format === "perkusi-mic-assignment" &&
        this.owner.producers.has(selected) &&
        r?.source?.isCurrent();
    this.$("mic").hidden = !isMic;
    this.$("pads").hidden = isMic;
    this.$("keys").hidden = isMic;
    this.$("instrument-monitor").hidden = isMic;
    const micState = mic?.muted ? "muted" : (this.owner.micStatus ?? "off");
    write("mic-status", mt.states[micState] ?? mt.states.error);
    this.$("mic-status").dataset.state = micState;
    this.$("mic-meter").value = micReady
      ? Math.min(1, producer?.meter?.peak ?? 0)
      : 0;
    this.$("mic-details").hidden = !micReady;
    const settings = producer?.settings;
    write(
      "mic-settings",
      micReady
        ? `${mt.converted}: ${r.source.channels} / ${r.source.sampleRate} Hz. ${mt.hardware}: ${settings?.sampleRate ?? "?"} Hz. peak ${(producer?.meter?.peak ?? 0).toFixed(3)} · RMS interval ${(producer?.meter?.rms ?? 0).toFixed(3)} · ${mt.clipTotal} ${producer?.meter?.clips ?? 0}`
        : "",
    );
    disable(
      "mic-enable",
      !isMic ||
        blocked ||
        active ||
        pending ||
        !matched ||
        s?.assignment?.format !== "perkusi-mic-assignment" ||
        micReady ||
        mic?.state === "requesting",
    );
    disable("mic-stop", !mic || !["requesting", "ready"].includes(mic.state));
    const monitoring = producer?.monitoring === "enabled";
    write("mic-monitor", monitoring ? mt.monitorOff : mt.monitorOn);
    this.$("mic-monitor").setAttribute("aria-pressed", String(monitoring));
    disable("mic-monitor", blocked || !micReady || producer?.monitorPending);
    if (!micReady) this.$("mic-headphones").checked = false;
    disable("mic-headphones", monitoring || !micReady);
    if (micReady && !mic?.muted)
      write(
        "mic-status",
        monitoring
          ? producer?.meter?.monitorGated
            ? mt.monitorGated
            : mt.monitorActive
          : mt.states.ready,
      );
    if (outcome?.reason === "unsafeReplay") write("partial-info", mt.unsafe);
    return micReady;
  }
  update() {
    if (!this.element?.isConnected) return;
    const t = this.text(),
      r = this.recorder(),
      s = r?.snapshot(),
      selected = this.selected(),
      matched = s?.assignment?.trackId === selected,
      active = !!r?.current && r.current.state !== "closed",
      pending = s?.pendingTake,
      blocked =
        this.pending ||
        this.busy() ||
        r?.busy ||
        this.owner.boundaries.size > 0 ||
        this.owner.savedBlocked(),
      saved = s?.saved ?? [],
      layers = r?.takes.layers(selected) ?? [],
      availability = r?.takes.tracks.has(selected)
        ? r.takes.history.availability(selected)
        : { undo: false, redo: false };
    const ot = overdubCopy[this.locale()];
    let eligible = false;
    try {
      const base = overdubBase(this.project(), selected);
      eligible =
        this.instrumentId === "microphone" ||
        (base.channels === 2 && base.sampleRate === 48000);
    } catch {
      /* Only the explicit supported base can enter overdub. */
    }
    const write = (id, value) => {
      const n = this.$(id);
      if (n && n.textContent !== value) n.textContent = value;
    };
    const disable = (id, value) => {
      const n = this.$(id);
      if (n) n.disabled = !!value;
    };
    const trackNo = (id) =>
      this.project().tracks.findIndex((x) => x.id === id) + 1;
    write(
      "source",
      s?.assignment?.format === "perkusi-mic-assignment"
        ? `${t.track} ${trackNo(s.assignment.trackId)} · ${micCopy[this.locale()].name}`
        : s?.assignment
          ? `${t.track} ${trackNo(s.assignment.trackId)} · ${t.instruments[r.source?.descriptors?.[0]?.instrumentId] ?? ""} · ${s.assignment.sampleIds.length === 8 ? t.drumSource : s.assignment.sampleIds.length === 3 ? t.melodicSource : t.source}`
          : t.noSource,
    );
    const state =
      s?.assignment && !matched && !active
        ? "other-track"
        : (s?.state ?? "idle");
    this.element.dataset.state = state;
    write(
      "state",
      (!active &&
      !pending &&
      !s?.take &&
      state === "idle" &&
      this.project().tracks.find((x) => x.id === selected)?.layering
        ? ot.layeredReady
        : !active && !pending && !s?.take && state === "idle" && eligible
          ? ot.baseReady
          : (matched && s?.overdub ? ot.ready : "") +
            (t.states[state] ?? t.states.error)) +
        (state === "counting" ? " · " + s.count : ""),
    );
    const completion = this.owner.controller?.snapshot().finiteCompletion,
      sourceFinished =
        !!this.owner.controller?.finite && completion?.state === "verified";
    write(
      "source-state",
      sourceFinished
        ? t.sourceFinished
        : completion?.state === "pending"
          ? t.sourcePlaying
          : "",
    );
    const outcome = s?.outcome;
    this.updatePartialStatus(s);
    const recoverable =
      !!this.owner.engine &&
      this.owner.engine.context.state !== "closed" &&
      (this.owner.engine.context.state !== "running" ||
        this.owner.lastFault ||
        this.owner.controller?.error ||
        s?.outcome?.reason === "protocolError" ||
        s?.handleState === "closing-error");
    this.$("recover").hidden = !recoverable;
    disable("recover", blocked || !recoverable);
    disable(
      "preview",
      blocked || active || pending || this.confirming || !this.canPreview(),
    );
    this.$("preview-hint").hidden =
      !this.canPreview() &&
      !this.owner.controller?.snapshot().finiteCaptureBridge;
    const playable = this.playable();
    if (!r?.source) this.recordError = null;
    write("record-error", t.errors[this.recordError] ?? "");
    this.$("record-error").hidden = !this.recordError;
    const isMic = this.instrumentId === "microphone";
    const micReady = this.updateMicControls({
      r,
      s,
      selected,
      matched,
      blocked,
      active,
      pending,
      outcome,
      write,
      disable,
    });
    write(
      "keys",
      drumBank(this.instrumentId)
        ? t.drumKeys
        : melodicBank(this.instrumentId)
          ? t.melodicKeys
          : t.keys,
    );
    for (const i of this.padKeys().keys()) {
      if (isMic) break;
      disable("pad-" + i, !playable);
      const held =
        s?.producer?.tokens.some((x) => x[1] === s.assignment.sampleIds[i]) ??
        false;
      this.$("pad-" + i).setAttribute("aria-pressed", String(held));
    }
    disable("prepare", blocked || active || pending || this.confirming);
    disable(
      "instrument",
      blocked ||
        active ||
        pending ||
        this.confirming ||
        !!s?.producer?.voices.length,
    );
    disable(
      "overdub-prepare",
      blocked || active || pending || !eligible || this.confirming,
    );
    disable(
      "bars",
      blocked || active || (matched && s?.overdub) || this.confirming,
    );
    write("record", matched && s?.overdub ? ot.record : t.record);
    write(
      "adopt",
      matched && s?.overdub ? ot.adopt : audioCopy[this.locale()].adopt,
    );
    disable(
      "record",
      blocked ||
        !matched ||
        !(isMic ? micReady : playable) ||
        active ||
        pending ||
        s?.playingSaved ||
        this.confirming,
    );
    disable(
      "stop",
      blocked ||
        !r ||
        (!active && !s?.playingSaved && !s?.producer?.voices.length),
    );
    disable("cancel", blocked || !active);
    disable("save", blocked || !pending || s.take.partial || this.confirming);
    const occupied = !!this.project().tracks.find((x) => x.id === selected)
      ?.clips.length;
    disable(
      "adopt",
      blocked ||
        active ||
        !matched ||
        !s?.take ||
        s.take.partial ||
        (s?.overdub ? !eligible : occupied) ||
        this.confirming,
    );

    disable(
      "play",
      blocked ||
        !matched ||
        occupied ||
        !layers.length ||
        active ||
        pending ||
        s?.playingSaved ||
        this.confirming,
    );
    disable(
      "undo",
      blocked ||
        occupied ||
        !availability.undo ||
        active ||
        pending ||
        this.confirming,
    );
    disable(
      "redo",
      blocked ||
        occupied ||
        !availability.redo ||
        active ||
        pending ||
        this.confirming,
    );
    disable("wav", blocked || !s?.take || active || this.export);
    disable("discard-current", blocked || !pending || active);
    disable(
      "discard-all",
      blocked || !r || (!saved.length && !pending && !active),
    );
    this.$("pending").hidden = !active && !pending;
    this.$("confirm").hidden = !this.confirming;
    disable("discard-confirm", blocked);
    disable("discard-keep", blocked);
    const signature = JSON.stringify(saved.map((x) => [x.id, x.active]));
    if (signature !== this.listSignature) {
      this.listSignature = signature;
      const list = this.$("library");
      list.replaceChildren();
      if (!saved.length)
        this.elementFor("p", t.empty, list).className = "ls-rec-hint";
      for (const [i, take] of saved.entries()) {
        const row = this.elementFor("div", undefined, list);
        row.className = "ls-rec-take";
        row.dataset.takeId = take.id;
        this.elementFor(
          "span",
          `${t.take} ${i + 1} · ${t.track} ${trackNo(take.trackId)} · ${(take.frames / take.sampleRate).toFixed(2)} ${t.seconds} · ${take.active ? t.active : t.archive}`,
          row,
        );
        this.button(row, t.wav, "download-" + take.id, () =>
          this.download(take.id),
        );
      }
    }
    for (const b of this.$("library").querySelectorAll("button"))
      b.disabled = !!(blocked || this.export);
  }
  updatePartialStatus(snapshot) {
    const element = this.$("partial-info"),
      status = partialTakeStatus(snapshot, this.locale()),
      text = status?.text ?? "";
    element.hidden = !status;
    if (element.textContent !== text) element.textContent = text;
    for (const key of [
      "retainedFrames",
      "receivedFrames",
      "intendedFrames",
      "recoveredFrames",
      "retainedEndFrame",
      "acknowledgedEndFrame",
      "cause",
    ]) {
      if (status?.[key] !== null && status?.[key] !== undefined)
        element.dataset[key] = String(status[key]);
      else delete element.dataset[key];
    }
  }
  destroy() {
    clearInterval(this.timer);
    try {
      this.inputs.clear();
    } catch {
      /* Source shutdown below the page owns final cleanup. */
    }
    this.releaseExport();
    document.removeEventListener("keydown", this.keydown);
    document.removeEventListener("keyup", this.keyup);
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      document.removeEventListener(event, this.pointerEnd);
    window.removeEventListener("blur", this.blur);
    document.removeEventListener("visibilitychange", this.visibility);
  }
}
