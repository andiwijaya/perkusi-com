import { createCanonicalStudioController } from "./canonical-controller.js";
const copy = {
  id: {
    note: "Uji lokal playback terpadu · penyuntingan dan penyimpanan belum diaktifkan",
    idle: "Siap untuk uji lokal",
    preparing: "Menyiapkan suara…",
    playing: "Memainkan",
    paused: "Dijeda",
    ended: "Selesai",
    closed: "Ditutup",
    error: "Persiapan gagal",
    headroom:
      "Mix gabungan melampaui batas headroom aman. Pemutaran belum dimulai; proyek dan berkas sumber tetap utuh. Tinjau level mixer, pan, EQ, atau sumber yang bertumpuk sebelum mencoba lagi.",
    budget:
      "Proyek melampaui batas memori audio 64 MiB. Proyek dan berkas sumber tetap tersimpan; gunakan susunan materi aktif yang lebih sederhana.",
    asset:
      "Suara gagal dimuat atau diverifikasi. Periksa ketersediaan aset; proyek dan berkas sumber tetap tersimpan.",
    tuning:
      "Gabungan sumber ini memerlukan persetujuan laras untuk seluruh lagu. Tinjau pilihan Persetujuan kombinasi laras; pilihan tidak diaktifkan otomatis.",
    voices:
      "Overlap melampaui batas 16 suara. Proyek tetap tersimpan; tinjau susunan dan tail yang bertumpuk.",
    window:
      "Pilih jendela lagu 4 atau 8 bar, lalu tekan Mulai Rantai Pola lagu sebelum memutar susunan terbatas. Sumber asli tetap tersimpan.",
    cleanup: "Menunggu pelepasan audio",
    ready: "WAV selesai diuji di memori",
    render: "Menyiapkan WAV…",
    pattern: "Pola",
    tail: "Decay alami",
  },
  en: {
    note: "Local unified playback test · editing and saving are not enabled yet",
    idle: "Ready for local testing",
    preparing: "Preparing sound…",
    playing: "Playing",
    paused: "Paused",
    ended: "Ended",
    closed: "Closed",
    error: "Preparation failed",
    headroom:
      "The combined mix exceeds safe headroom. Playback has not started; your project and source files remain intact. Review mixer levels, pan, EQ, or overlapping sources before trying again.",
    budget:
      "The project exceeds the 64 MiB audio memory limit. Your project and source files remain saved; use a simpler arrangement of active material.",
    asset:
      "Sound could not be loaded or verified. Check asset availability; your project and source files remain saved.",
    tuning:
      "This combination requires whole-song tuning consent. Review Tuning combination consent; it is not enabled automatically.",
    voices:
      "Overlaps exceed the 16-voice limit. Your project remains saved; review the arrangement and overlapping tails.",
    window:
      "Choose a four- or eight-bar song window, then Start song Pattern Chain before finite playback. Your original source remains saved.",
    cleanup: "Waiting for audio release",
    ready: "WAV tested in memory",
    render: "Preparing WAV…",
    pattern: "Pattern",
    tail: "Natural decay",
  },
};

// Called only by initStudio's explicit localhost dependency injection. Reuses
// the existing main Studio transport/grid/master/chain, with no storage work.
export function initCanonicalStudioPanel({
  root,
  createOwner,
  readDocument,
  readView,
  command,
  onWav = () => {},
  onTransport = () => {},
  wavReadyText = null,
  locale = document.documentElement.lang,
} = {}) {
  const c = copy[locale] ?? copy.id,
    $ = (id) => root.querySelector("#st-" + id),
    life = new AbortController();
  function refresh() {
    const initial = readView(),
      pattern = initial.patterns.find((p) => p.id === initial.activePattern);
    root.querySelectorAll("button,input,select").forEach((el) => {
      if (
        !el.closest(
            "[data-canonical-handoff],[data-canonical-inbox],[data-canonical-authoring],[data-canonical-tuning],[data-legacy-discovery]",
        )
      )
        el.disabled = true;
    });
    $("title").value = initial.title;
    $("bpm").value = initial.timing.bpm;
    $("master").value = initial.master.volume;
    $("master-value").textContent =
      Math.round(initial.master.volume * 100) + "%";
    $("swing").value = initial.timing.swing;
    $("swing-value").textContent = Math.round(initial.timing.swing * 100) + "%";
    $("pattern-name").value = pattern.name;
    $("duration").textContent =
      ((initial.chain.length * 4 * 60) / initial.timing.bpm).toFixed(2) + " s";
    for (const track of initial.tracks) {
      root.querySelector(`[data-st-volume="${track.role}"]`).value =
        track.volume;
      root.querySelector(`[data-st-volume-value="${track.role}"]`).textContent =
        Math.round(track.volume * 100) + "%";
      root.querySelector(`[data-st-pan="${track.role}"]`).value = track.pan;
      root.querySelector(`[data-st-pan-value="${track.role}"]`).textContent =
        String(track.pan);
      for (const flag of ["mute", "solo"])
        root
          .querySelector(`[data-st-${flag}="${track.role}"]`)
          .setAttribute("aria-pressed", String(track[flag]));
    }
    $("chain-mode").checked = true;
    $("pattern").replaceChildren(
      ...initial.patterns.map((p) => new Option(p.name, p.id)),
    );
    $("pattern").value = initial.activePattern;
    $("kit").value = initial.pack.id;
    $("chain-list").textContent = initial.chain
      .map((id) => initial.patterns.find((p) => p.id === id).name)
      .join(" → ");
    for (const el of root.querySelectorAll("[data-st-step]")) {
      const [role, step] = el.dataset.stStep.split(":");
      el.setAttribute(
        "aria-pressed",
        String(Boolean(pattern.steps[role][Number(step)])),
      );
    }
  }
  refresh();
  const note =
    root.querySelector("[data-canonical-notice]") ??
    document.createElement("p");
  note.className = "st-hint";
  note.dataset.canonicalNotice = "";
  note.textContent = c.note;
  root.querySelector(".st-transport").before(note);
  let exporting = false,
    disposed = false,
    raf,
    exportAbort = null,
    rendering = null;
  const controller = createCanonicalStudioController({
    createOwner,
    onChange(s) {
      root.dataset.canonicalState = s.status;
      root.dataset.canonicalGeneration = String(s.generation);
      if (s.error) root.dataset.canonicalAudioError = s.error;
      else delete root.dataset.canonicalAudioError;
      const reason = {
        voiceHeadroom: c.headroom,
        voiceLimit: c.voices,
        combinedMemoryLimit: c.budget,
        tuningConsentRequired: c.tuning,
        assetFailed: c.asset,
        canonicalAssetUnavailable: c.asset,
        canonicalAssetIdentityMismatch: c.asset,
        canonicalAssetNotRegistered: c.asset,
        assetLength: c.asset,
        assetHash: c.asset,
        assetTooLarge: c.asset,
        unobservableAssetBody: c.asset,
        cachedAssetInvalid: c.asset,
        arrangementWindowRequired: c.window,
      }[s.error];
      $("status").textContent =
        s.status === "error" && reason
          ? reason
          : (c[s.status] ??
            (s.status === "cleanup-pending" ? c.cleanup : c.error));
      $("status").setAttribute("role", s.error ? "alert" : "status");
      $("play").disabled =
        disposed ||
        s.closed ||
        s.status === "preparing" ||
        s.status === "cleanup-pending";
      $("pause").disabled = disposed || s.status !== "playing";
      $("stop").disabled = disposed || s.pendingOwners === 0;
      $("render").disabled = disposed || !s.capability || exporting;
      if (s.capability)
        $("duration").textContent =
          (s.capability.frames / s.capability.rate).toFixed(2) + " s";
      onTransport(s);
    },
  });
  const listen = (id, fn) =>
    $(id).addEventListener(
      "click",
      () => {
        Promise.resolve()
          .then(fn)
          .catch(() => {
            /* Controller emits its bounded status. */
          });
      },
      { signal: life.signal },
    );
  listen("play", () =>
    controller.snapshot().status === "paused"
      ? controller.resume()
      : controller.play(readDocument(), { command }),
  );
  listen("pause", () => controller.pause());
  listen("stop", () => controller.stop());
  const render = async () => {
    if (disposed) return;
    exporting = true;
    onTransport(controller.snapshot());
    $("render").disabled = true;
    $("project-status").textContent = c.render;
    exportAbort = new AbortController();
    const request = { title: readDocument().title };
    let wav;
    try {
      wav = await controller.exportWav({ signal: exportAbort.signal });
      if (disposed) throw Error("cancelled");
      await onWav(wav, request);
      $("project-status").textContent = wavReadyText ?? c.ready;
    } catch {
      $("project-status").textContent = c.error;
    } finally {
      wav?.output?.release();
      exporting = false;
      onTransport(controller.snapshot());
      $("render").disabled = !controller.snapshot().capability || disposed;
    }
  };
  listen("render", () => {
    rendering = render();
    return rendering;
  });
  const tick = () => {
    const p = controller.position();
    if (p) {
      const selected = readView().sourceId,
        current =
          p.compositions?.find((row) => row.sourceId === selected) ??
          p.compositions?.[0];
      $("position").textContent =
        (p.frame / controller.snapshot().capability.rate).toFixed(2) +
        " s" +
        (current
          ? " · " + c.pattern + " " + current.patternName
          : p.stage === "natural-tail"
            ? " · " + c.tail
            : "");
      if (current) $("position").dataset.canonicalPattern = current.patternId;
      else delete $("position").dataset.canonicalPattern;
    } else {
      $("position").textContent = "0.00 s";
      delete $("position").dataset.canonicalPattern;
    }
    if (!disposed) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  root.dataset.canonicalOptIn = "true";
  $("play").disabled = false;
  $("status").textContent = c.idle;
  return Object.freeze({
    controller,
    refresh,
    get exporting() {
      return exporting;
    },
    cancelExport() {
      exportAbort?.abort();
    },
    async dispose() {
      disposed = true;
      life.abort();
      cancelAnimationFrame(raf);
      exportAbort?.abort();
      const close = controller.dispose();
      close.catch(() => {});
      await rendering?.catch(() => {});
      await close;
    },
  });
}
