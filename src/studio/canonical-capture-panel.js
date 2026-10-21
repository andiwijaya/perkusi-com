import { createCanonicalCaptureOwner } from "./canonical-capture-owner.js";
import { canonicalCaptureProject } from "./canonical-capture-material.js";
import { canonicalRegisteredAssets } from "../audio/canonical-registered-assets.js";
import {
  TrackWaveforms,
  waveformCopy,
} from "../loop-station/track-waveforms.js";
import { canonicalAssetUrl } from "./canonical-asset-urls.js";
import { RECORD_INSTRUMENTS } from "../loop-station/record-sources.js";
import { RecordInputs } from "../loop-station/record-inputs.js";
import captureModuleURL from "../loop-station/capture-worklet.js?worker&url";
import finiteReaderModuleURL from "../loop-station/finite-reader-worklet.js?worker&url";
import { fail } from "../project/instrument-contract.js";

const copy = {
  id: {
    title: "Rekam ke Studio",
    source: "Sumber",
    target: "Tujuan",
    fresh: "Track rekaman baru",
    overdub: "Lapisi: ",
    prepare: "Siapkan rekaman",
    record: "Rekam",
    stop: "Hentikan rekaman",
    apply: "Terapkan ke lagu",
    discard: "Buang take",
    wav: "Unduh WAV take",
    package: "Unduh paket take",
    mic: "Mikrofon",
    enable: "Aktifkan mic",
    bars: "Bar",
    count: "Hitungan awal",
    idle: "Siap. Pilih instrumen lalu Siapkan rekaman.",
    ready: "Instrumen siap. Mainkan pad atau mulai Rekam.",
    preparing: "Menutup pemutaran dan menyiapkan sumber…",
    recording: "Merekam",
    review:
      "Take lengkap; terapkan lalu Putar untuk mengulang bersama lagu, atau unduh.",
    partial:
      "Take terputus. WAV dapat diunduh; take parsial tidak diterapkan otomatis.",
    saved: "Take diterapkan; Putar menggunakan Studio yang sama.",
    failed:
      "Belum berhasil; lagu dan take yang sudah diterima tetap tersedia. Coba lagi, unduh cadangan atau buang take.",
    micHint:
      "Mic hanya aktif setelah klik dan izin browser. Monitor mic mati secara default. Gunakan headphone; latensi dan kualitas perangkat belum diverifikasi.",
    needsMic:
      "Sumber mic disiapkan; klik Aktifkan mic untuk meminta izin browser.",
    denied:
      "Izin mic tidak diberikan atau mic belum tersedia. Tidak ada take yang diterapkan.",
    policy: "Kebijakan halaman memblokir mic. Gunakan instrumen bawaan.",
    headroom:
      "Gabungan sumber melampaui batas audio. Proyek dan take tetap utuh; pilih sumber atau track lain.",
    keys: "Pad Q/W/E/R/T/Y/U/I memainkan sumber rekaman. Lepaskan pad bernada untuk meredam.",
    pending:
      "Paket take belum diterapkan; coba Terapkan lagi atau unduh paketnya.",
    hint: "Rekam sambil mendengar seluruh susunan lagu. Setelah hitungan awal, lagu dan take dimulai bersama dari awal. Take hanya berisi sumber terpilih; terapkan untuk mengulangnya dalam lagu.",
  },
  en: {
    title: "Record into Studio",
    source: "Source",
    target: "Target",
    fresh: "New recorded track",
    overdub: "Overdub: ",
    prepare: "Prepare recording",
    record: "Record",
    stop: "Stop recording",
    apply: "Apply to song",
    discard: "Discard take",
    wav: "Download take WAV",
    package: "Download take package",
    mic: "Microphone",
    enable: "Enable mic",
    bars: "Bars",
    count: "Count-in",
    idle: "Ready. Choose an instrument, then Prepare recording.",
    ready: "Instrument ready. Play the pads or start Record.",
    preparing: "Closing playback and preparing the source…",
    recording: "Recording",
    review:
      "Complete take; apply then Play to repeat it with the song, or download.",
    partial:
      "Interrupted take. WAV can be downloaded; partial takes are not applied automatically.",
    saved: "Take applied; Play uses the same Studio.",
    failed:
      "Not completed; your song and accepted take remain available. Retry, download a backup or discard the take.",
    micHint:
      "Mic starts only after a click and browser permission. Mic monitoring is off by default. Use headphones; device latency and quality are unverified.",
    needsMic:
      "Mic source prepared; click Enable mic to request browser permission.",
    denied:
      "Mic permission was denied or input is unavailable. No take was applied.",
    policy: "Page policy blocks the microphone. Use a built-in instrument.",
    headroom:
      "The combined sources exceed audio limits. Project and take are intact; choose a different source or track.",
    keys: "Q/W/E/R/T/Y/U/I play the recording source. Release pitched pads to damp.",
    pending:
      "Take package is not applied yet; retry Apply or download the package.",
    hint: "Record while hearing the complete song arrangement. After count-in, the song and take start together from the beginning. The take contains only the selected source; apply it to repeat it with the song.",
  },
};
const names = {
  "saron-barung": "Saron barung",
  slenthem: "Slenthem",
  "drum-ruang": "Drum Ruang",
  "drum-arus": "Drum Arus",
  "electric-bass": "Electric bass",
  "classical-guitar": "Classical guitar",
};
export function initCanonicalCapturePanel({
  root,
  editor,
  workflow,
  registry,
  memory,
  stopPlayback,
  applyTransaction,
  deliver,
  locale = "id",
  onChange = () => {},
  signal,
}) {
  const c = copy[locale] ?? copy.id,
    life = new AbortController(),
    inputs = new RecordInputs(),
    keys = ["Q", "W", "E", "R", "T", "Y", "U", "I"];
  const el = (tag, text = "", attr = {}) => {
      const n = document.createElement(tag);
      n.textContent = text;
      for (const [k, v] of Object.entries(attr)) n.setAttribute(k, v);
      return n;
    },
    section = el("section", "", {
      class: "st-panel",
      "data-can-capture": "",
      id: "record",
    }),
    source = el("select", "", { "data-cap-source": "" }),
    target = el("select", "", { "data-cap-target": "" }),
    bars = el("select", "", { "data-cap-bars": "" }),
    count = el("select", "", { "data-cap-count": "" }),
    pads = el("div", "", { "data-cap-pads": "", class: "st-pads" }),
    status = el("p", c.idle, { role: "status", "data-cap-status": "" }),
    buttons = {};
  const micOptions = el("div", "", { "data-cap-mic-options": "" }),
    headphones = el("input", "", {
      type: "checkbox",
      "data-cap-headphones": "",
    }),
    monitor = el("input", "", { type: "checkbox", "data-cap-monitor": "" });
  const meter = el("meter", "", {
      min: 0,
      max: 1,
      value: 0,
      "data-cap-mic-meter": "",
      "aria-label":
        locale === "en" ? "Microphone input level" : "Level input mikrofon",
    }),
    micState = el("output", "", { "data-cap-mic-state": "" }),
    releaseMic = el(
      "button",
      locale === "en" ? "Release microphone" : "Lepaskan mikrofon",
      { type: "button", "data-cap-release-mic": "" },
    );
  micOptions.append(meter, micState, releaseMic);
  const waveHost = el("div", "", { "data-cap-waveform": "" }),
    waves = new TrackWaveforms({ memory, documentStore: null });
  waves.figure(
    waveHost,
    "live:capture",
    locale,
    waveformCopy[locale].session,
    true,
  );
  for (const [node, label] of [
    [
      headphones,
      locale === "en" ? "I am using headphones" : "Saya memakai headphone",
    ],
    [
      monitor,
      locale === "en"
        ? "Listen to microphone (off by default)"
        : "Dengarkan mikrofon (mati secara default)",
    ],
  ]) {
    const l = el("label", label);
    l.prepend(node);
    micOptions.append(l);
  }
  section.append(el("h3", c.title), el("p", c.hint, { class: "st-hint" }));
  for (const [node, label] of [
    [source, c.source],
    [target, c.target],
    [bars, c.bars],
    [count, c.count],
  ]) {
    const l = el("label", label);
    l.append(node);
    section.append(l);
  }
  for (const id of RECORD_INSTRUMENTS) source.add(new Option(names[id], id));
  source.add(new Option(c.mic, "microphone"));
  for (const n of [1, 2, 4, 8]) bars.add(new Option(String(n), String(n)));
  bars.value = "2";
  for (const n of [0, 1, 2]) count.add(new Option(String(n), String(n)));
  count.value = "1";
  for (const name of [
    "prepare",
    "enable",
    "record",
    "stop",
    "apply",
    "wav",
    "package",
    "discard",
  ]) {
    const b = el("button", c[name], {
      type: "button",
      ["data-cap-" + name]: "",
    });
    buttons[name] = b;
    section.append(b);
  }
  section.append(
    pads,
    waveHost,
    micOptions,
    status,
    el("p", c.keys, { class: "st-hint" }),
    el("p", c.micHint, { class: "st-hint" }),
  );
  root.querySelector(".canonical-material").prepend(section);
  let current = null,
    packageOutput = null,
    last = null,
    preparing = null,
    abort = null,
    busy = false,
    applying = false,
    closed = false,
    generation = 0,
    padSource = null,
    message = c.idle,
    failure = null;
  const blocked = () => !!(current || packageOutput || preparing || busy),
    notify = () => {
      render();
      onChange();
    };
  const error = (e) => {
    section.dataset.error = e.code ?? e.name ?? "error";
    message =
      e.code === "micPolicyBlocked"
        ? c.policy
        : e.code === "captureHeadroom" || e.code === "voiceHeadroom"
          ? c.headroom
          : ["NotAllowedError", "micNotReady", "micGestureRequired"].includes(
                e.name,
              ) ||
              ["micNotReady", "micGestureRequired", "micDenied"].includes(
                e.code,
              )
            ? c.denied
            : c.failed;
    status.setAttribute("role", "alert");
    failure = message;
    notify();
  };
  const clearInputs = () => {
    try {
      inputs.clear();
    } catch (e) {
      error(e);
    }
  };
  const press = (token, index) => {
    const s = current?.source();
    if (!s || busy || !s.descriptors?.[index]) return;
    try {
      inputs.press(token, s, s.descriptors[index].id);
    } catch (e) {
      error(e);
    }
  };
  const listen = (node, event, fn) =>
    node.addEventListener(event, fn, { signal: life.signal });
  function render() {
    const active = blocked(),
      s = current?.snapshot() ?? last,
      take = s?.take;
    if (!active) {
      const prior = target.value;
      target.replaceChildren(new Option(c.fresh, ""));
      for (const t of editor.snapshot().project.tracks)
        try {
          canonicalCaptureProject(editor.snapshot().project, registry, {
            trackId: t.id,
            rate: editor.snapshot().project.timing.clock.sampleRate,
          });
          target.add(new Option(c.overdub + t.name, t.id));
        } catch {
          /* not a legal one-layer base */
        }
      target.value = [...target.options].some((o) => o.value === prior)
        ? prior
        : "";
    }
    source.disabled = target.disabled = closed || active;
    bars.disabled = closed || active;
    count.disabled = closed || busy || !!packageOutput || !!s?.plan;
    buttons.prepare.disabled = closed || active;
    buttons.enable.hidden = source.value !== "microphone";
    buttons.enable.disabled = closed || busy || !current || !!current.source();
    micOptions.hidden = source.value !== "microphone";
    const input = s?.producer,
      levels =
        s?.micStatus === "ready" && current?.source() ? input?.meter : null;
    meter.value = Math.min(1, Math.max(0, levels?.peak ?? 0));
    micState.textContent =
      locale === "en"
        ? `${s?.micStatus === "ready" ? "Mic ready" : "Mic off or unavailable"}${input?.muted ? " · Input muted" : ""} · Peak ${Number(levels?.peak ?? 0).toFixed(3)} · RMS ${Number(levels?.rms ?? 0).toFixed(3)}${input?.settings?.sampleRate ? " · " + input.settings.sampleRate + " Hz" : ""}${input?.settings?.channelCount ? " · " + input.settings.channelCount + " channels" : ""}`
        : `${s?.micStatus === "ready" ? "Mic siap" : "Mic mati atau belum tersedia"}${input?.muted ? " · Input dibisukan" : ""} · Puncak ${Number(levels?.peak ?? 0).toFixed(3)} · RMS ${Number(levels?.rms ?? 0).toFixed(3)}${input?.settings?.sampleRate ? " · " + input.settings.sampleRate + " Hz" : ""}${input?.settings?.channelCount ? " · " + input.settings.channelCount + " kanal" : ""}`;
    releaseMic.disabled =
      closed || busy || !current?.source() || source.value !== "microphone";
    const wave = current?.waveformState();
    waves.updateLive(
      "capture",
      wave?.identity ?? null,
      wave?.frames ?? 0,
      wave?.read ?? (() => null),
      { partial: !!take?.partial, state: s?.state ?? "idle" },
    );
    headphones.disabled = closed || busy;
    monitor.disabled =
      closed || busy || !current?.source() || !headphones.checked || !!s?.take;
    buttons.record.disabled =
      closed || busy || !current?.source() || !!s?.take || !!s?.plan;
    buttons.stop.disabled = closed || busy || !(current || preparing);
    buttons.apply.disabled =
      closed ||
      busy ||
      !!s?.backingFault ||
      (!packageOutput && (!take || take.partial));
    buttons.wav.disabled = closed || busy || !take || !current;
    buttons.package.disabled =
      closed || busy || (!packageOutput && (!take || take.partial));
    buttons.discard.disabled = closed || busy || !active;
    const actual = current?.source();
    if (actual !== padSource) {
      clearInputs();
      padSource = actual;
      pads.replaceChildren();
      for (const [i, d] of (actual?.descriptors ?? []).entries()) {
        const b = el("button", (d.pitchId ?? d.id) + " · " + keys[i], {
          type: "button",
          "data-cap-pad": i,
        });
        listen(b, "pointerdown", (e) => {
          e.preventDefault();
          try {
            b.setPointerCapture(e.pointerId);
          } catch {
            /* document owns release */
          }
          press("pointer:" + e.pointerId, i);
        });
        pads.append(b);
      }
    }
    for (const b of pads.children)
      b.disabled = closed || busy || !actual || !!packageOutput || !!take;
    if (s?.take) message = s.take.partial ? c.partial : c.review;
    if (packageOutput) message = c.pending;
    if (s?.plan && !s.take) {
      const frame = s.frame ?? 0;
      message =
        (frame < s.plan.startFrame ? c.count : c.recording) +
        " · " +
        Math.max(0, Math.ceil((s.plan.endFrame - frame) / s.plan.sampleRate)) +
        "s";
    }
    if (s?.backingFault) {
      section.dataset.error = s.backingFault;
      status.setAttribute("role", "alert");
      status.textContent =
        locale === "en"
          ? "The song backing could not start safely. Your received take is preserved for download; discard it before retrying. It has not been applied."
          : "Pengiring lagu gagal dimulai dengan aman. Take yang diterima tetap dapat diunduh; buang sebelum mencoba lagi. Take belum diterapkan.";
    } else status.textContent = failure ?? message;
    section.dataset.state = preparing
      ? "preparing"
      : packageOutput
        ? "pending-apply"
        : (s?.state ?? "idle");
  }
  const task = (fn) => {
    delete section.dataset.error;
    failure = null;
    status.setAttribute("role", "status");
    delete section.dataset.error;
    const p = Promise.resolve().then(fn);
    p.catch(error);
    return p;
  };
  listen(source, "change", notify);
  listen(headphones, "change", () => {
    if (!headphones.checked && monitor.checked) {
      monitor.checked = false;
      current?.setMicMonitoring(false).catch(error);
    }
    notify();
  });
  listen(releaseMic, "click", () =>
    task(async () => {
      busy = true;
      notify();
      try {
        await current.stop();
        monitor.checked = false;
      } finally {
        busy = false;
        notify();
      }
    }),
  );
  listen(monitor, "change", () => {
    const enabled = monitor.checked;
    task(async () => {
      busy = true;
      notify();
      try {
        await current.setMicMonitoring(enabled, {
          headphonesConfirmed: headphones.checked,
        });
      } catch (e) {
        monitor.checked = !enabled;
        throw e;
      } finally {
        busy = false;
        notify();
      }
    });
  });
  listen(target, "change", () => {
    if (target.value) {
      const p = canonicalCaptureProject(editor.snapshot().project, registry, {
        trackId: target.value,
        rate: editor.snapshot().project.timing.clock.sampleRate,
      });
      const ref = p.assetRefs[0];
      bars.value = String(ref.frames / p.clock.framesPerBar);
    }
    notify();
  });
  listen(buttons.prepare, "click", () => {
    if (blocked()) return;
    failure = null;
    status.setAttribute("role", "status");
    const id = ++generation;
    monitor.checked = false;
    abort = new AbortController();
    message = c.preparing;
    preparing = (async () => {
      await stopPlayback();
      if (closed || id !== generation) fail("cancelled");
      const bundle = editor.snapshot().bundle,
        rate = bundle.project.timing.clock.sampleRate ?? 48000,
        assets = canonicalRegisteredAssets(rate, canonicalAssetUrl),
        owner = await createCanonicalCaptureOwner({
          bundle,
          registry: assets.registry,
          memory,
          rate,
          contextFactory: (r) =>
            new AudioContext({ sampleRate: r, latencyHint: "interactive" }),
          outputFactory: (ctx) => ctx.destination,
          fetcher: (path, options) => fetch(assets.nativeURL(path), options),
          moduleURL: captureModuleURL,
          finiteReaderModuleURL,
          instrumentId: source.value,
          bars: Number(bars.value),
          resolveUrl: canonicalAssetUrl,
          trackId: target.value || null,
          signal: abort.signal,
          onChange: () => notify(),
        });
      if (closed || id !== generation) {
        await owner.dispose();
        fail("cancelled");
      }
      current = owner;
      message = source.value === "microphone" ? c.needsMic : c.ready;
    })()
      .catch(error)
      .finally(() => {
        preparing = null;
        notify();
      });
    notify();
  });
  listen(buttons.enable, "click", () => {
    if (!current || busy) return;
    failure = null;
    status.setAttribute("role", "status");
    busy = true;
    try {
      const enabled = current.enableMic();
      enabled.catch(error).finally(() => {
        busy = false;
        notify();
      });
    } catch (e) {
      busy = false;
      error(e);
    }
    notify();
  });
  listen(buttons.record, "click", () =>
    task(async () => {
      busy = true;
      notify();
      try {
        await current.record({
          bars: Number(bars.value),
          countInBars: Number(count.value),
        });
      } finally {
        busy = false;
        notify();
      }
    }),
  );
  listen(buttons.stop, "click", () =>
    task(async () => {
      clearInputs();
      if (preparing) {
        generation++;
        abort?.abort();
        await preparing;
      } else await current?.stop();
      notify();
    }),
  );
  const packageTake = async () => {
    if (!packageOutput) packageOutput = await current.exportPackage();
    return packageOutput;
  };
  listen(buttons.apply, "click", () =>
    task(async () => {
      busy = applying = true;
      clearInputs();
      notify();
      try {
        const out = await packageTake(),
          trackId =
            current?.snapshot().overdubTrackId ?? last?.overdubTrackId ?? null;
        if (current) {
          last = current.snapshot();
          await current.dispose();
          current = null;
        }
        await applyTransaction(() =>
          workflow.importFile(out.blob, {
            mode: "add",
            freezeRecordingClock: true,
            replaceRecordingTrackId: trackId,
          }),
        );
        out.release();
        packageOutput = null;
        last = null;
        message = c.saved;
      } finally {
        busy = applying = false;
        notify();
      }
    }),
  );
  listen(buttons.package, "click", () =>
    task(async () => {
      busy = true;
      clearInputs();
      notify();
      try {
        const out = await packageTake();
        await deliver(out.blob, "perkusi-take.perkusi");
      } finally {
        busy = false;
        notify();
      }
    }),
  );
  listen(buttons.wav, "click", () =>
    task(async () => {
      busy = true;
      notify();
      let wav;
      try {
        await current.stop();
        wav = current.wav();
        await deliver(
          new Blob([wav.buffer], { type: "audio/wav" }),
          "perkusi-take.wav",
        );
      } finally {
        wav?.release();
        busy = false;
        notify();
      }
    }),
  );
  const discard = async () => {
    clearInputs();
    generation++;
    abort?.abort();
    await preparing;
    if (current) {
      await current.dispose();
      current = null;
    }
    packageOutput?.release();
    packageOutput = null;
    last = null;
    monitor.checked = false;
    message = c.idle;
    notify();
  };
  listen(buttons.discard, "click", () => task(discard));
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    listen(document, event, (e) => {
      try {
        inputs.release("pointer:" + e.pointerId);
      } catch (x) {
        error(x);
      }
    });
  listen(document, "keydown", (e) => {
    if (
      !blocked() ||
      e.repeat ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.target.closest("input,select,textarea,[contenteditable=true]")
    )
      return;
    const i = keys.indexOf(e.key.toUpperCase());
    if (i >= 0) {
      e.preventDefault();
      press("key:" + e.code, i);
    }
  });
  listen(document, "keyup", (e) => {
    try {
      inputs.release("key:" + e.code);
    } catch (x) {
      error(x);
    }
  });
  listen(window, "blur", clearInputs);
  const timer = setInterval(() => {
    if (blocked()) notify();
  }, 100);
  signal?.addEventListener("abort", () => life.abort(), { once: true });
  render();
  return {
    blocked,
    hasWork: blocked,
    get applying() {
      return applying;
    },
    render,
    async dispose() {
      closed = true;
      life.abort();
      clearInterval(timer);
      await discard();
      await waves.dispose();
    },
  };
}
