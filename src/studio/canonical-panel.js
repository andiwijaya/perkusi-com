import { createCanonicalStudioController } from "./canonical-controller.js";
import { canonicalTransportControls } from "./canonical-transport-controls.js";
const copy = {
  id: {
    note: "Uji lokal playback terpadu · penyuntingan dan penyimpanan belum diaktifkan",
    idle: "Siap",
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
      "Pilih jendela pemutaran 4 atau 8 bar untuk sumber Loop lama. Sumber asli tetap tersimpan.",
    cleanup: "Menunggu pelepasan audio",
    ready: "WAV selesai diuji di memori",
    render: "Menyiapkan WAV…",
    pattern: "Pola",
    tail: "Decay alami",
    repeat: "Ulang terus",
    prepared: "Siap dimainkan",
    seek: "Posisi lagu",
    stream: "Audio terhenti. Proyek tetap utuh; tekan Play untuk mencoba lagi.",
    repeatHint:
      "Pilih sebelum Play untuk mengulang seluruh lagu. Matikan untuk menyelesaikan putaran; Kembali ke awal menghentikan dan mengatur posisi ke awal. WAV berisi satu putaran.",
    transportRefused:
      "Kontrol belum tersedia pada keadaan ini. Pilihan sebelumnya dipertahankan; gunakan Stop sebelum mengubah mode ulang.",
  },
  en: {
    note: "Local unified playback test · editing and saving are not enabled yet",
    idle: "Ready",
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
      "Choose a four- or eight-bar playback window for older Loop sources. Your original source remains saved.",
    cleanup: "Waiting for audio release",
    ready: "WAV tested in memory",
    render: "Preparing WAV…",
    pattern: "Pattern",
    tail: "Natural decay",
    repeat: "Repeat continuously",
    prepared: "Ready to play",
    seek: "Song position",
    stream: "Audio stopped. Your project is intact; press Play to try again.",
    repeatHint:
      "Choose before Play to repeat the whole song. Turn off to finish the cycle; Return to start stops and resets the position. WAV contains one pass.",
    transportRefused:
      "This control is unavailable in the current state. The previous choice is retained; use Stop before changing repeat mode.",
  },
};

// Called only by initStudio's explicit localhost dependency injection. Reuses
// the existing main Studio transport/grid/master/chain, with no storage work.
export function initCanonicalStudioPanel({
  root,
  createOwner,
  readDocument,
  readView,
  readPlaybackView = null,
  readRevision = () => null,
  onPosition = () => {},
  command,
  onWav = () => {},
  onExportStart = () => {},
  onExportResult = () => {},
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
          "[data-canonical-handoff],[data-canonical-inbox],[data-canonical-authoring],[data-canonical-tuning],[data-legacy-discovery],[data-can-capture],[data-canonical-beatbox]",
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
  const repeatLabel = document.createElement("label"),
    repeatInput = document.createElement("input"),
    repeatHint = document.createElement("p");
  repeatInput.type = "checkbox";
  repeatInput.id = "st-repeat";
  repeatInput.dataset.canTransportControl = "";
  repeatInput.setAttribute("aria-describedby", "st-repeat-hint");
  repeatLabel.append(repeatInput, document.createTextNode(" " + c.repeat));
  repeatHint.id = "st-repeat-hint";
  repeatHint.className = "st-hint";
  repeatHint.textContent = c.repeatHint;
  root.querySelector(".st-transport").append(repeatLabel, repeatHint);
  const seekLabel = document.createElement("label"),
    seekInput = document.createElement("input");
  seekLabel.textContent = c.seek + " ";
  seekLabel.style.flex = "1 1 12rem";
  seekLabel.style.minWidth = "0";
  seekInput.type = "range";
  seekInput.id = "st-seek";
  seekInput.min = "0";
  seekInput.max = "1";
  seekInput.step = "1";
  seekInput.value = "0";
  seekInput.disabled = true;
  seekInput.dataset.canTransportControl = "";
  seekInput.setAttribute("aria-label", c.seek);
  seekInput.style.maxWidth = "100%";
  seekLabel.append(seekInput);
  root.querySelector(".st-transport").append(seekLabel);
  let seekDragging = false;
  seekInput.addEventListener(
    "input",
    () => {
      seekDragging = true;
    },
    { signal: life.signal },
  );
  seekInput.addEventListener(
    "pointerdown",
    () => {
      seekDragging = true;
    },
    { signal: life.signal },
  );
  // Releasing the thumb without changing its value emits no change event.
  // Restore live position updates in that case too, including outside release.
  document.addEventListener(
    "pointerup",
    () => {
      seekDragging = false;
    },
    { signal: life.signal },
  );
  seekInput.addEventListener(
    "pointercancel",
    () => {
      seekDragging = false;
    },
    { signal: life.signal },
  );
  seekInput.addEventListener(
    "change",
    () => {
      seekDragging = false;
      const frame = Number(seekInput.value);
      void Promise.resolve()
        .then(() => controller.seek(frame))
        .catch(showTransportRefusal);
    },
    { signal: life.signal },
  );
  let exporting = false,
    disposed = false,
    raf,
    exportAbort = null,
    rendering = null,
    renderPosition = null,
    transportLocked = false;
  const syncTransportControls = (s = controller.snapshot()) => {
    const state = canonicalTransportControls(s, {
      locked: transportLocked,
      disposed,
    });
    repeatInput.checked = state.repeatChecked;
    repeatInput.disabled = state.repeatDisabled;
    seekInput.disabled = state.seekDisabled;
  };
  function showTransportRefusal(error) {
    syncTransportControls();
    root.dataset.canonicalControlError =
      error.code ?? error.message ?? "canonicalNotReady";
    $("status").textContent = c.transportRefused;
    $("status").setAttribute("role", "alert");
    if (renderPosition) renderPosition();
  }
  const followHint = document.createElement("p");
  followHint.id = "st-playback-view";
  followHint.className = "st-hint";
  followHint.hidden = true;
  $("position").after(followHint);
  root
    .querySelector(".st-grid-scroll")
    .setAttribute("aria-describedby", followHint.id);
  const controller = createCanonicalStudioController({
    createOwner,
    onChange(s) {
      delete root.dataset.canonicalControlError;
      root.dataset.canonicalState = s.status;
      root.dataset.canonicalGeneration = String(s.generation);
      root.dataset.canonicalCycle = String(s.cycle);
      syncTransportControls(s);
      seekInput.max = String(Math.max(1, (s.capability?.bodyFrames ?? 2) - 1));
      if (s.error) root.dataset.canonicalAudioError = s.error;
      else delete root.dataset.canonicalAudioError;
      const reason = {
        canonicalStreamProcessorFault: c.stream,
        canonicalStreamStarved: c.stream,
        canonicalStreamClockDiscontinuity: c.stream,
        canonicalStreamReadyDeadline: c.stream,
        canonicalStreamArmDeadline: c.stream,
        canonicalStreamContextClosed: c.stream,
        canonicalStreamReceipt: c.stream,
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
      $("render").disabled =
        disposed ||
        s.closed ||
        exporting ||
        ["preparing", "cleanup-pending"].includes(s.status);
      if (s.capability)
        $("duration").textContent =
          (s.capability.frames / s.capability.rate).toFixed(2) + " s";
      onTransport(s);
      // Stop/retirement changes transport state before the next animation
      // frame. Clear the matching presentation in that same state update.
      if (!disposed && !s.capability) renderPosition?.();
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
  repeatInput.addEventListener(
    "change",
    () => {
      try {
        controller.setRepeat(repeatInput.checked);
        delete root.dataset.canonicalControlError;
      } catch (error) {
        showTransportRefusal(error);
      }
    },
    { signal: life.signal },
  );
  const readCommand = (p) =>
    typeof command === "function" ? command(p) : command;
  listen("play", () =>
    controller.snapshot().status === "prepared"
      ? controller.startPrepared()
      : controller.snapshot().status === "paused"
        ? controller.resume()
        : controller.play(readDocument(), {
            command: readCommand(readDocument()),
          }),
  );
  listen("pause", () => controller.pause());
  listen("stop", () => controller.stop());
  const render = async () => {
    if (disposed) return;
    onExportStart();
    delete root.dataset.canonicalExportError;
    exporting = true;
    onTransport(controller.snapshot());
    $("render").disabled = true;
    $("project-status").textContent = c.render;
    $("project-status").setAttribute("role", "status");
    exportAbort = new AbortController();
    const request = { title: readDocument().title, revision: readRevision() };
    let wav,
      preparedGeneration = null;
    const abortPreparation = () => {
      if (controller.snapshot().generation === preparedGeneration)
        void controller.stop().catch(() => {});
    };
    try {
      if (!controller.snapshot().capability) {
        // Export before Play or after Stop/end prepares silently. It does not
        // start native sources or require an undisclosed playback workaround.
        const preparation = controller.play(readDocument(), {
          command: readCommand(readDocument()),
          prepareOnly: true,
        });
        preparedGeneration = controller.snapshot().generation;
        exportAbort.signal.addEventListener("abort", abortPreparation, {
          once: true,
        });
        await preparation;
        exportAbort.signal.removeEventListener("abort", abortPreparation);
      }
      if (exportAbort.signal.aborted) throw Error("cancelled");
      wav = await controller.exportWav({ signal: exportAbort.signal });
      if (disposed) throw Error("cancelled");
      await onWav(wav, request);
      onExportResult();
      $("project-status").textContent = wavReadyText ?? c.ready;
    } catch (error) {
      onExportResult(error);
      root.dataset.canonicalExportError =
        error.code ?? error.message ?? "exportFailed";
      $("project-status").textContent =
        {
          combinedMemoryLimit: c.budget,
          budgetExceeded: c.budget,
          voiceHeadroom: c.headroom,
          voiceLimit: c.voices,
          arrangementWindowRequired: c.window,
        }[error.code] ?? c.error;
      $("project-status").setAttribute("role", "alert");
    } finally {
      wav?.output?.release();
      exportAbort.signal.removeEventListener("abort", abortPreparation);
      if (
        preparedGeneration !== null &&
        controller.snapshot().generation === preparedGeneration &&
        controller.snapshot().status === "prepared"
      )
        await controller.stop().catch(() => {});
      exporting = false;
      onTransport(controller.snapshot());
      $("render").disabled =
        disposed ||
        ["preparing", "cleanup-pending", "closed"].includes(
          controller.snapshot().status,
        );
    }
  };
  listen("render", () => {
    rendering = render();
    return rendering;
  });
  renderPosition = () => {
    const transport = controller.snapshot(),
      p = transport.capability ? controller.position() : null,
      state = transport.status,
      editing = readView();
    let current = null,
      view = editing,
      step = null;
    if (p) {
      if (p.cycle) root.dataset.canonicalCycle = String(p.cycle);
      if (!seekDragging)
        seekInput.value = String(Math.min(Number(seekInput.max), p.frame));
      seekInput.setAttribute(
        "aria-valuetext",
        (p.frame / transport.capability.rate).toFixed(2) + " s",
      );
      const selected = editing.sourceId;
      current =
        p.compositions?.find((row) => row.sourceId === selected) ??
        p.compositions?.[0];
      if (current && readPlaybackView)
        view = readPlaybackView(current.sourceId) ?? editing;
      if (state === "playing" && p.started !== false)
        step = current?.step ?? null;
      $("position").textContent =
        (p.frame / transport.capability.rate).toFixed(2) +
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
      if (!seekDragging) seekInput.value = "0";
    }
    const following = state === "playing" && current && p.started !== false,
      pattern =
        view.patterns.find(
          (a) =>
            a.id === (following ? current.patternId : editing.activePattern),
        ) ?? editing.patterns.find((a) => a.id === editing.activePattern),
      readonly =
        !!following &&
        (current.sourceId !== editing.sourceId ||
          current.patternId !== editing.activePattern);
    root.querySelector(".st-grid-scroll").inert = readonly;
    followHint.hidden = !readonly;
    followHint.textContent = readonly
      ? locale === "en"
        ? `Playing pattern ${current.patternName}. Pause or select this pattern to edit it.`
        : `Memainkan pola ${current.patternName}. Jeda atau pilih pola ini untuk mengeditnya.`
      : "";
    const bilah = root.querySelector("[data-can-bilah]");
    if (bilah) bilah.inert = readonly;
    for (const el of root.querySelectorAll("[data-st-step]")) {
      const [role, index] = el.dataset.stStep.split(":");
      el.classList.toggle(
        "st-playhead",
        step !== null && Number(index) === step,
      );
      el.setAttribute("aria-pressed", String(!!pattern.steps[role][index]));
    }
    for (const el of root.querySelectorAll("[data-st-head]")) {
      const active = step !== null && Number(el.dataset.stHead) === step;
      el.classList.toggle("st-playhead", active);
      if (active) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    }
    for (const el of root.querySelectorAll("[data-can-note]")) {
      const n = Number(el.dataset.canNote),
        note = pattern.notes[n];
      el.classList.toggle("st-playhead", step !== null && n === step);
      el.setAttribute("aria-pressed", String(!!note));
      el.textContent = note?.pitch ?? String(n + 1);
      if (step !== null && n === step) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    }
    for (const el of root.querySelectorAll("[data-can-remove-chain]"))
      el.classList.toggle(
        "st-current",
        !!following &&
          Number(el.dataset.canRemoveChain) === current.bar % view.chain.length,
      );
    onPosition(p, state);
  };
  const tick = () => {
    renderPosition();
    if (!disposed) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  root.dataset.canonicalOptIn = "true";
  $("play").disabled = false;
  $("status").textContent = c.idle;
  syncTransportControls();
  return Object.freeze({
    controller,
    refresh,
    setTransportLocked(value) {
      transportLocked = Boolean(value);
      syncTransportControls();
    },
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
