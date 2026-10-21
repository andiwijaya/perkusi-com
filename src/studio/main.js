import "../project/mode-transfer.css";
import "./style.css";
import { AudioEngine } from "../audio/engine.js";
import { StudioWavExporter } from "../audio/studio-exporter.js";
import { createBeatboxOutputStage } from "../beatbox/output-stage.js";
import { createProgrammeOutputStage } from "../audio/programme-output.js";
import { originalGroovePack } from "../beatbox/pack.js";
import {
  CompositionPlayback,
  compositionExportExtras,
} from "../audio/composition.js";
import {
  newComposition,
  compositionDemo,
} from "../project/composition-model.js";
import {
  initCompositionPanel,
  compositionMessages,
} from "./composition-panel.js";
import { initModeTransfer } from "../project/mode-transfer.js";
import { CompositionStore } from "../project/composition-store.js";
import { studioCatalog, studioPack, instrumentPack } from "./pack.js";
import { studioMessages, studioRoleNames } from "./messages.js";
import {
  ProjectHistory,
  emptyPattern,
  STUDIO_ROLES,
  MAX_PATTERNS,
  MAX_CHAIN,
} from "../project/studio-model.js";
import {
  validateProject,
  serializeProject,
  ProjectError,
  cleanTitle,
} from "../project/schema.js";
import {
  FileDelivery,
  readProjectFile,
  safeFilename,
} from "../project/files.js";
import { projectMessages } from "../project/messages.js";
import { trackEvent, exportFailureCategory } from "../analytics.js";
import { initCanonicalStudioPanel } from "./canonical-panel.js";
import { initCanonicalEditableStudio } from "./canonical-workspace.js";
import {
  canonicalLocalBuild,
  canonicalLocalRoute,
  canonicalStudioHref,
  canonicalLegacyHref,
  canonicalRecoveryHref,
} from "./canonical-route.js";

export function initStudio({ canonicalCandidate = null } = {}) {
  const root = document.querySelector(".studio-page"),
    $ = (id) => root.querySelector("#st-" + id);
  if (
    (import.meta.env.DEV ||
      import.meta.env.CANONICAL_LOCAL_REVIEW ||
      import.meta.env.CANONICAL_FINAL_STUDIO ||
      import.meta.env.CANONICAL_PUBLIC_PREVIEW) &&
    !canonicalCandidate &&
    canonicalLocalRoute(
      true,
      location.href,
      import.meta.env.CANONICAL_PUBLIC_PREVIEW,
    )
  )
    return import("./canonical-entry.js")
      .then(({ initCanonicalLocalEntry }) => initCanonicalLocalEntry())
      .catch((error) => {
        root.dataset.canonicalError = error.code ?? error.message;
        $("project-status").setAttribute("role", "alert");
        $("project-status").textContent =
          document.documentElement.lang === "en"
            ? "Local Studio could not open. Your saved projects remain available."
            : "Studio lokal belum dapat dibuka. Proyek tersimpan tetap tersedia.";
        for (const [href, label] of [
          ...(import.meta.env.CANONICAL_FINAL_STUDIO
            ? []
            : [
                [
                  canonicalLegacyHref(document.documentElement.lang),
                  document.documentElement.lang === "en"
                    ? "Previous Studio"
                    : "Studio sebelumnya",
                ],
              ]),
          [
            canonicalRecoveryHref(document.documentElement.lang),
            document.documentElement.lang === "en"
              ? "Recover saved projects"
              : "Pulihkan proyek tersimpan",
          ],
        ]) {
          const a = document.createElement("a");
          a.href = href;
          a.textContent = label;
          $("project-status").append(document.createTextNode(" · "), a);
        }
        throw error;
      });
  if (
    (import.meta.env.DEV ||
      import.meta.env.CANONICAL_LOCAL_REVIEW ||
      import.meta.env.CANONICAL_PUBLIC_PREVIEW) &&
    !canonicalCandidate &&
    canonicalLocalBuild(
      true,
      location.href,
      import.meta.env.CANONICAL_PUBLIC_PREVIEW,
    )
  ) {
    const entry = document.createElement("a");
    entry.id = "st-canonical-entry";
    entry.dataset.stCopy = "canonicalEntry";
    entry.href = canonicalStudioHref(document.documentElement.lang);
    entry.addEventListener("click", () => {
      entry.href = canonicalStudioHref(document.documentElement.lang);
    });
    root.querySelector(".st-intro").append(entry);
    const recovery = document.createElement("a");
    recovery.id = "st-canonical-recovery";
    recovery.dataset.stCopy = "canonicalRecovery";
    recovery.href = canonicalRecoveryHref(document.documentElement.lang);
    recovery.addEventListener("click", () => {
      recovery.href = canonicalRecoveryHref(document.documentElement.lang);
    });
    root.querySelector(".st-intro").append(recovery);
  }
  if (canonicalCandidate) {
    if (
      !canonicalLocalBuild(
        true,
        location.href,
        import.meta.env.CANONICAL_PUBLIC_PREVIEW ||
          import.meta.env.CANONICAL_FINAL_STUDIO,
      )
    )
      throw Error("canonicalLocalOnly");
    return canonicalCandidate.editable
      ? initCanonicalEditableStudio({ root, ...canonicalCandidate })
      : initCanonicalStudioPanel({ root, ...canonicalCandidate });
  }
  const engine = new AudioEngine(studioPack(1), {
    variantPacks: [studioPack(2), studioPack(3)],
    sequenceCatalog: studioCatalog,
    outputStageFactory: (context, input) =>
      createProgrammeOutputStage(context, input, createBeatboxOutputStage),
  });
  engine.arrangement = true;
  $("chain-mode").checked = true;
  const playback = new CompositionPlayback(engine, {
    loopPack: originalGroovePack,
    instrumentPack,
  });
  const history = new ProjectHistory(newComposition(), (p) =>
    validateProject(p, studioCatalog),
  );
  const store = new CompositionStore(studioCatalog),
    delivery = new FileDelivery();
  const exporter = new StudioWavExporter({
    catalog: studioCatalog,
    packForKit: (id) =>
      studioPack(studioCatalog.kits.findIndex((k) => k.id === id) + 1),
    extensions: compositionExportExtras({
      loopPack: originalGroovePack,
      instrumentPack,
    }),
    outputStageFactory: createBeatboxOutputStage,
    matchProgramme: true,
    retainedBytes: () => engine.cacheBounds().bytes,
  });
  let locale,
    c,
    errors,
    disposed = false,
    busy = false,
    calibrating = false,
    reading = false,
    receiving = false,
    readyFile = null,
    selectedSave = "",
    projectStatus = "idle",
    statusError = false,
    draftAllowed = true,
    draftTimer,
    frame,
    lastFrame = 0,
    keyboard = false,
    restoreFocus = null;
  let savedItems = [],
    storeAvailable = true;
  const padTimers = new Set();
  const importLocks = new Map();
  const life = new AbortController(),
    listen = (target, event, fn) =>
      target.addEventListener(event, fn, { signal: life.signal });
  const current = () => history.current;
  const project = () =>
    validateProject(
      { ...structuredClone(current()), title: cleanTitle($("title").value) },
      studioCatalog,
    );
  const text = (el, value) => {
    if (el && el.textContent !== String(value)) el.textContent = value;
  };
  function message(key, error = false) {
    projectStatus = key;
    statusError = error;
    text($("project-status"), c[key] || errors[key] || errors.invalidProject);
    $("project-status").setAttribute("role", error ? "alert" : "status");
  }
  function fail(error) {
    message(error.code || "invalidProject", true);
  }
  function readSaves() {
    try {
      savedItems = store.read();
      storeAvailable = true;
    } catch {
      savedItems = [];
      storeAvailable = false;
      message("storageUnavailable", true);
    }
    updateSaves();
  }
  function updateSaves() {
    const select = $("saved");
    select.replaceChildren(new Option(c.choose, ""));
    for (const item of savedItems)
      select.add(new Option(item.project.title, item.id));
    select.value = selectedSave;
    selectedSave = select.value;
    $("load").disabled = busy || reading || receiving || !selectedSave;
    $("saved-delete").disabled = busy || reading || receiving || !selectedSave;
  }
  function saveDraft() {
    if (!draftAllowed || disposed || receiving) return;
    try {
      store.saveDraft(current());
    } catch {
      draftAllowed = false;
      message("storageUnavailable", true);
    }
  }
  function changed() {
    clearTimeout(draftTimer);
    if (!receiving) draftTimer = setTimeout(saveDraft, 250);
    sync();
  }
  function edit(fn) {
    if (reading || receiving) return;
    try {
      if (history.edit(fn)) {
        changed();
        message("editSaved");
      }
    } catch (e) {
      fail(e);
    }
  }
  function apply(p) {
    const valid = validateProject(p, studioCatalog);
    engine.rewind();
    engine.arrangement = true;
    $("chain-mode").checked = true;
    history.replace(valid);
    readyFile = null;
    $("result").hidden = true;
    $("title").value = current().title;
    changed();
    message("loaded");
  }
  function sync() {
    if (disposed) return;
    const p = current(),
      pattern = p.patterns.find((a) => a.id === p.activePattern);
    if (document.activeElement !== $("title")) $("title").value = p.title;
    playback.configure(
      p,
      studioCatalog.kits.findIndex((k) => k.id === p.pack.id) + 1,
    );
    compositionPanel.update();
    $("kit").value = p.pack.id;
    $("bpm").value = p.timing.bpm;
    $("swing").value = p.timing.swing;
    $("master").value = p.master.volume;
    $("quantize").checked = p.timing.quantize;
    text($("swing-value"), Math.round(p.timing.swing * 100) + "%");
    text($("master-value"), Math.round(p.master.volume * 100) + "%");
    $("pattern").replaceChildren(
      ...p.patterns.map((a) => new Option(a.name, a.id)),
    );
    $("pattern").value = p.activePattern;
    $("pattern-name").value = pattern.name;
    $("undo").disabled = !history.past.length || busy || reading || receiving;
    $("redo").disabled = !history.future.length || busy || reading || receiving;
    $("new").disabled =
      p.patterns.length >= MAX_PATTERNS || busy || reading || receiving;
    $("duplicate").disabled = $("new").disabled;
    $("delete-pattern").disabled =
      p.patterns.length <= 1 || busy || reading || receiving;
    for (const [i, role] of STUDIO_ROLES.entries()) {
      for (let s = 0; s < 16; s++) {
        const el = root.querySelector(`[data-st-step="${role}:${s}"]`),
          value = pattern.steps[role][s];
        el.setAttribute("aria-pressed", String(value > 0));
        el.setAttribute(
          "aria-label",
          `${studioRoleNames[locale][i]} · ${c.step} ${s + 1}`,
        );
        el.querySelector(".st-velocity").style.width = value * 70 + "%";
      }
      const track = p.tracks[i];
      for (const field of ["volume", "pan"]) {
        const input = root.querySelector(`[data-st-${field}="${role}"]`);
        input.value = track[field];
        input.setAttribute(
          "aria-label",
          `${studioRoleNames[locale][i]} · ${c[field]}`,
        );
        text(
          root.querySelector(`[data-st-${field}-value="${role}"]`),
          field === "volume"
            ? Math.round(track[field] * 100) + "%"
            : track[field],
        );
      }
      for (const field of ["mute", "solo"]) {
        const el = root.querySelector(`[data-st-${field}="${role}"]`);
        el.setAttribute("aria-pressed", String(track[field]));
        el.setAttribute(
          "aria-label",
          `${studioRoleNames[locale][i]} · ${c[field]}`,
        );
      }
      root
        .querySelector(`[data-st-pad="${role}"]`)
        .setAttribute("aria-label", `${studioRoleNames[locale][i]} · ${i + 1}`);
    }
    const oldFocus = document.activeElement?.dataset?.stChainRemove;
    $("chain-list").replaceChildren(
      ...p.chain.map((id, index) => {
        const slot = document.createElement("div");
        slot.className = "st-chain-slot";
        slot.dataset.stChainSlot = index;
        const label = document.createElement("span");
        label.textContent = `${index + 1} · ${p.patterns.find((a) => a.id === id).name}`;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "×";
        button.dataset.stChainRemove = index;
        button.setAttribute(
          "aria-label",
          `${c.removeChain} · ${c.chainSlot} ${index + 1}`,
        );
        button.disabled = p.chain.length <= 1 || busy || reading || receiving;
        slot.append(label, button);
        return slot;
      }),
    );
    if (oldFocus !== undefined) {
      const target = root.querySelector(
        `[data-st-chain-remove="${Math.min(Number(oldFocus), p.chain.length - 1)}"]`,
      );
      (target?.disabled ? $("add-chain") : target)?.focus({
        preventScroll: true,
      });
    }
    $("add-chain").disabled =
      p.chain.length >= MAX_CHAIN || busy || reading || receiving;
    text(
      $("duration"),
      ((p.chain.length * 4 * 60) / p.timing.bpm).toFixed(2) + " s",
    );
    updateSaves();
    renderStatus();
  }
  function renderStatus() {
    const s = engine.snapshot();
    text(
      $("status"),
      calibrating
        ? c.loadingAudio
        : s.error
          ? c.errorAudio
          : s.status === "playing"
            ? c.playing
            : s.status === "loading"
              ? c.loadingAudio
              : ["paused", "suspended", "interrupted"].includes(s.status)
                ? c.paused
                : c.idle,
    );
    $("play").disabled = busy || s.status === "loading";
    $("pause").disabled =
      !calibrating && !["loading", "playing"].includes(s.status);
    text(
      $("position"),
      `${Math.floor(s.beat / 4) + 1} : ${Math.floor(s.beat % 4) + 1}`,
    );
    const step =
      s.status === "playing" &&
      s.sequence.playhead >= 0 &&
      engine.context.currentTime >=
        engine.transport.origin +
          engine.transport.position * engine.transport.beatSeconds
        ? s.sequence.playhead % 16
        : -1;
    root.querySelectorAll("[data-st-head]").forEach((el) => {
      const current = Number(el.dataset.stHead) === step;
      el.classList.toggle("st-playhead", current);
      if (current) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    });
    root.querySelectorAll("[data-v3-step]").forEach((el) => {
      const current = Number(el.dataset.v3Step) === step;
      el.classList.toggle("st-playhead", current);
      if (current) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    });
    root
      .querySelectorAll("[data-st-step]")
      .forEach((el) =>
        el.classList.toggle(
          "st-playhead",
          Number(el.dataset.stStep.split(":")[1]) === step,
        ),
      );
    const bar =
      engine.arrangement && step >= 0
        ? Math.floor(s.beat / 4) % current().chain.length
        : -1;
    root
      .querySelectorAll("[data-st-chain-slot]")
      .forEach((el) =>
        el.classList.toggle(
          "st-current",
          Number(el.dataset.stChainSlot) === bar,
        ),
      );
  }
  function localize() {
    locale = document.documentElement.lang === "en" ? "en" : "id";
    c = studioMessages[locale];
    errors = { ...projectMessages[locale], ...compositionMessages[locale] };
    root
      .querySelectorAll("[data-st-copy]")
      .forEach((el) => text(el, c[el.dataset.stCopy]));
    root
      .querySelectorAll("[data-st-role]")
      .forEach((el) =>
        text(el, studioRoleNames[locale][Number(el.dataset.stRole)]),
      );
    for (const id of ["kit", "demo-kind"])
      for (const option of $(id).options)
        text(
          option,
          c[option.value] || compositionMessages[locale][option.value],
        );
    root.querySelector(".st-guide").setAttribute("aria-label", c.quick);
    root
      .querySelector(".st-grid-scroll")
      .setAttribute("aria-label", c.sequencer);
    root.querySelector(".st-transport").setAttribute("aria-label", c.tempo);
    $("file").setAttribute("aria-label", c.file);
    message(projectStatus, statusError);
    text(
      $("share").querySelector("span"),
      readyFile && delivery.canShare(readyFile) ? c.share : c.shareDownload,
    );
    sync();
  }
  async function play() {
    if (busy || disposed || engine.status === "playing") return;
    const operation = engine.operation;
    const requested = project(),
      signature = JSON.stringify(requested);
    const calibrationLocks = new Map(
      [...root.querySelectorAll("button,input,select")]
        .filter((el) => !["st-pause", "st-stop", "st-cancel"].includes(el.id))
        .map((el) => [el, el.disabled]),
    );
    const context = engine.ensureContext();
    const resumed = context.resume();
    setBusy(true);
    calibrating = true;
    for (const el of calibrationLocks.keys()) el.disabled = true;
    root.setAttribute("aria-busy", "true");
    renderStatus();
    try {
      await resumed;
      const programme = engine.arrangement
        ? requested
        : { ...requested, chain: [requested.activePattern] };
      const measured = await exporter.render(programme, () => {}, {
        rate: 48000,
        uncalibrated: true,
      });
      if (
        disposed ||
        engine.operation !== operation ||
        JSON.stringify(project()) !== signature
      )
        return;
      engine.outputStage.setProgrammeGain(measured.programmeCalibration.gain);
    } catch (e) {
      if (!disposed) fail(e);
      return;
    } finally {
      if (!disposed) {
        calibrating = false;
        for (const [el, disabled] of calibrationLocks) el.disabled = disabled;
        root.removeAttribute("aria-busy");
        setBusy(false);
        sync();
        renderStatus();
      }
    }
    const before = engine.stats.starts;
    const job = engine.play();
    renderStatus();
    await job;
    if (!disposed) {
      if (engine.stats.starts > before && engine.context?.state === "running")
        trackEvent("audio_started");
      renderStatus();
    }
  }
  async function pad(role) {
    if (busy || disposed) return;
    const button = root.querySelector(`[data-st-pad="${role}"]`);
    button.classList.add("st-hit");
    try {
      if (engine.status !== "playing") engine.outputStage?.setProgrammeGain(1);
      await engine.triggerPad(role);
    } catch {
      engine.error = "audio-start";
    } finally {
      if (!disposed) {
        const timer = setTimeout(() => {
          padTimers.delete(timer);
          if (!disposed) button.classList.remove("st-hit");
        }, 130);
        padTimers.add(timer);
        renderStatus();
      }
    }
  }
  function nextPattern(p) {
    let i = 1;
    while (p.patterns.some((a) => a.id === "p" + i)) i++;
    return "p" + i;
  }
  function setBusy(value) {
    if (reading && !importLocks.size) {
      root.querySelectorAll("button,input,select").forEach((el) => {
        if (!["st-play", "st-pause", "st-stop"].includes(el.id))
          importLocks.set(el, el.disabled);
      });
    } else if (!reading && importLocks.size) {
      for (const [el, disabled] of importLocks) el.disabled = disabled;
      importLocks.clear();
    }
    busy = value;
    $("render").disabled = busy || reading || receiving;
    $("cancel").hidden = !busy;
    $("progress").hidden = !busy;
    for (const id of [
      "save",
      "load",
      "saved-delete",
      "import",
      "project-download",
    ])
      $(id).disabled = busy || reading || receiving;
    updateSaves();
    $("undo").disabled = !history.past.length || busy || reading || receiving;
    $("redo").disabled = !history.future.length || busy || reading || receiving;
    if (reading) for (const el of importLocks.keys()) el.disabled = true;
    compositionPanel.update();
  }
  function ownFocus() {
    const el = document.activeElement;
    restoreFocus =
      keyboard && [$("render"), $("cancel")].includes(el) ? $("render") : null;
  }
  function settleFocus() {
    const target = restoreFocus;
    restoreFocus = null;
    if (
      !disposed &&
      target &&
      !target.disabled &&
      (["BODY", "HTML"].includes(document.activeElement?.tagName) ||
        document.activeElement === target ||
        document.activeElement === $("cancel"))
    )
      target.focus({ focusVisible: true });
  }
  async function renderWav() {
    if (busy || reading || receiving) return;
    let p;
    try {
      p = project();
    } catch (e) {
      fail(e);
      return;
    }
    if (!engine.arrangement && !window.confirm(c.previewExport)) return;
    ownFocus();
    readyFile = null;
    $("result").hidden = true;
    setBusy(true);
    try {
      const result = await exporter.render(p, (progress) => {
        if (!disposed) {
          message(progress.phase);
          const bar = $("progress");
          progress.value === null
            ? bar.removeAttribute("value")
            : (bar.value = progress.value);
        }
      });
      if (disposed) return;
      readyFile = new File(
        [result.blob],
        safeFilename(result.project.title, "wav"),
        { type: "audio/wav" },
      );
      text($("filename"), readyFile.name);
      $("result").hidden = false;
      text(
        $("share").querySelector("span"),
        delivery.canShare(readyFile) ? c.share : c.shareDownload,
      );
      message("exportReady");
      trackEvent("export_succeeded");
    } catch (e) {
      if (!disposed) {
        fail(e);
        if (e.code !== "cancelled")
          trackEvent("export_failed", exportFailureCategory(e.code));
      }
    } finally {
      if (!disposed) {
        setBusy(false);
        settleFocus();
      }
    }
  }
  listen(document, "keydown", (event) => {
    keyboard = true;
    const form = event.target.closest(
      "input,textarea,select,[contenteditable=true]",
    );
    if (form || document.querySelector("dialog[open]")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (
        !busy &&
        !reading &&
        (event.shiftKey ? history.redo() : history.undo())
      )
        changed();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (/^[1-8]$/.test(event.key)) {
      event.preventDefault();
      void pad(STUDIO_ROLES[Number(event.key) - 1]);
    } else if (
      event.code === "Space" &&
      !event.target.closest("button,a,summary")
    ) {
      event.preventDefault();
      if (engine.transport.running) engine.pause();
      else void play();
      renderStatus();
    }
  });
  listen(document, "pointerdown", () => {
    keyboard = false;
    restoreFocus = null;
  });
  listen(document, "focusin", (event) => {
    if (
      restoreFocus &&
      ![restoreFocus, $("cancel")].includes(event.target) &&
      !["BODY", "HTML"].includes(event.target.tagName)
    )
      restoreFocus = null;
  });
  listen(root, "keydown", (event) => {
    const el = event.target.closest("[data-st-step]");
    if (
      !el ||
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const [role, s] = el.dataset.stStep.split(":");
    let row = STUDIO_ROLES.indexOf(role),
      step = Number(s);
    if (event.key === "ArrowLeft") step = Math.max(0, step - 1);
    if (event.key === "ArrowRight") step = Math.min(15, step + 1);
    if (event.key === "ArrowUp") row = Math.max(0, row - 1);
    if (event.key === "ArrowDown") row = Math.min(7, row + 1);
    if (event.key === "Home") step = 0;
    if (event.key === "End") step = 15;
    root.querySelectorAll("[data-st-step]").forEach((a) => (a.tabIndex = -1));
    const next = root.querySelector(
      `[data-st-step="${STUDIO_ROLES[row]}:${step}"]`,
    );
    next.tabIndex = 0;
    next.focus();
  });
  listen(root, "click", async (event) => {
    const target = event.target.closest("button");
    if (!target || target.disabled) return;
    if (target.dataset.stStep) {
      const [role, step] = target.dataset.stStep.split(":");
      edit((p) => {
        const row = p.patterns.find((a) => a.id === p.activePattern).steps[
          role
        ];
        row[Number(step)] = row[Number(step)] ? 0 : 1;
      });
      return;
    }
    if (target.dataset.stPad) {
      void pad(target.dataset.stPad);
      return;
    }
    if (target.dataset.stMute || target.dataset.stSolo) {
      const field = target.dataset.stMute ? "mute" : "solo",
        role = target.dataset.stMute || target.dataset.stSolo;
      edit((p) => {
        const t = p.tracks.find((t) => t.role === role);
        t[field] = !t[field];
      });
      return;
    }
    if (target.dataset.stChainRemove !== undefined) {
      const index = Number(target.dataset.stChainRemove);
      edit((p) => {
        if (p.chain.length > 1) p.chain.splice(index, 1);
      });
      return;
    }
    try {
      switch (target.id) {
        case "st-play":
          await play();
          break;
        case "st-pause":
          if (calibrating) exporter.cancel();
          engine.pause();
          renderStatus();
          break;
        case "st-stop":
          if (calibrating) exporter.cancel();
          engine.rewind();
          renderStatus();
          break;
        case "st-dismiss":
          $("desktop").hidden = true;
          break;
        case "st-demo":
          if (
            history.past.length &&
            !window.confirm(
              locale === "en"
                ? "Replace this arrangement? You can undo to restore it."
                : "Ganti susunan ini? Gunakan Urungkan untuk mengembalikannya.",
            )
          )
            break;
          edit((p) => Object.assign(p, compositionDemo($("demo-kind").value)));
          engine.rewind();
          engine.arrangement = true;
          $("chain-mode").checked = true;
          $("title").value = current().title;
          break;
        case "st-clear":
          edit((p) => {
            const a = p.patterns.find((a) => a.id === p.activePattern);
            a.steps = emptyPattern().steps;
            a.notes = Array(16).fill(null);
          });
          break;
        case "st-new":
        case "st-duplicate":
          edit((p) => {
            if (p.patterns.length >= MAX_PATTERNS)
              throw new ProjectError("limits");
            const id = nextPattern(p),
              a =
                target.id === "st-duplicate"
                  ? structuredClone(
                      p.patterns.find((a) => a.id === p.activePattern),
                    )
                  : { ...emptyPattern(), notes: Array(16).fill(null) };
            a.id = id;
            a.name = id.toUpperCase();
            p.patterns.push(a);
            p.activePattern = id;
          });
          break;
        case "st-rename": {
          const name = cleanTitle($("pattern-name").value);
          edit((p) => {
            p.patterns.find((a) => a.id === p.activePattern).name = name;
          });
          break;
        }
        case "st-delete-pattern":
          edit((p) => {
            if (p.patterns.length === 1) throw new ProjectError("limits");
            const id = p.activePattern;
            p.patterns = p.patterns.filter((a) => a.id !== id);
            p.activePattern = p.patterns[0].id;
            p.chain = p.chain.filter((a) => a !== id);
            if (!p.chain.length) p.chain = [p.activePattern];
          });
          break;
        case "st-add-chain":
          edit((p) => {
            if (p.chain.length >= MAX_CHAIN) throw new ProjectError("limits");
            p.chain.push(p.activePattern);
          });
          break;
        case "st-undo":
          if (!busy && !reading && history.undo()) changed();
          break;
        case "st-redo":
          if (!busy && !reading && history.redo()) changed();
          break;
        case "st-save":
          selectedSave = store.save(project());
          readSaves();
          message("saved");
          trackEvent("project_saved");
          break;
        case "st-load":
          if (
            !history.past.length ||
            window.confirm(
              locale === "en"
                ? "Load this project? Your current draft will be replaced. Download it first if you want to keep it."
                : "Muat proyek ini? Draft saat ini akan diganti. Unduh dulu untuk menyimpannya.",
            )
          )
            apply(store.load(selectedSave));
          break;
        case "st-saved-delete":
          if (window.confirm(c.deleteConfirm)) {
            store.remove(selectedSave);
            selectedSave = "";
            readSaves();
            message("deleted");
          }
          break;
        case "st-project-download": {
          const p = project();
          delivery.download(
            new Blob([serializeProject(p, studioCatalog)], {
              type: "application/json",
            }),
            safeFilename(p.title, "perkusi.json"),
          );
          message("projectDownloaded");
          break;
        }
        case "st-import":
          $("file").click();
          break;
        case "st-render":
          await renderWav();
          break;
        case "st-cancel":
          ownFocus();
          exporter.cancel();
          message("cancelling");
          break;
        case "st-wav-download":
          if (readyFile) {
            delivery.download(readyFile, readyFile.name);
            message("downloaded");
          }
          break;
        case "st-share":
          if (readyFile) message(await delivery.share(readyFile));
          break;
      }
    } catch (e) {
      if (!disposed) fail(e);
    }
  });
  listen(root, "input", (event) => {
    const el = event.target;
    if (el.id === "st-title") {
      try {
        edit((p) => (p.title = cleanTitle(el.value)));
      } catch {
        /* Incomplete field is validated before persistence/export. */
      }
      return;
    }
    if (el.dataset.stVolume || el.dataset.stPan) {
      const field = el.dataset.stVolume ? "volume" : "pan",
        role = el.dataset.stVolume || el.dataset.stPan;
      edit(
        (p) =>
          (p.tracks.find((t) => t.role === role)[field] = Number(el.value)),
      );
    }
    if (el.id === "st-master")
      edit((p) => (p.master.volume = Number(el.value)));
    if (el.id === "st-swing") edit((p) => (p.timing.swing = Number(el.value)));
  });
  listen(root, "change", async (event) => {
    const el = event.target;
    if (reading && el.id !== "st-file") return;
    if (el.id === "st-kit") edit((p) => (p.pack.id = el.value));
    if (el.id === "st-bpm") edit((p) => (p.timing.bpm = Number(el.value)));
    if (el.id === "st-pattern") edit((p) => (p.activePattern = el.value));
    if (el.id === "st-quantize") edit((p) => (p.timing.quantize = el.checked));
    if (el.id === "st-chain-mode") {
      engine.arrangement = el.checked;
      playback.configure(
        current(),
        studioCatalog.kits.findIndex((k) => k.id === current().pack.id) + 1,
        true,
      );
    }
    if (el.id === "st-saved") {
      selectedSave = el.value;
      updateSaves();
    }
    if (el.id === "st-file") {
      const file = el.files?.[0];
      el.value = "";
      if (!file || busy || reading || receiving) return;
      restoreFocus =
        keyboard && document.activeElement === $("import") ? $("import") : null;
      reading = true;
      setBusy(false);
      message("loading");
      try {
        const valid = await readProjectFile(file, studioCatalog);
        if (
          !disposed &&
          (!history.past.length ||
            window.confirm(
              locale === "en"
                ? "Import this project? Your current draft will be replaced. Download it first if you want to keep it."
                : "Impor proyek ini? Draft saat ini akan diganti. Unduh dulu untuk menyimpannya.",
            ))
        )
          apply(valid);
      } catch (e) {
        if (!disposed) fail(e);
      } finally {
        reading = false;
        if (!disposed) {
          setBusy(false);
          sync();
          settleFocus();
        }
      }
    }
  });
  listen(document, "perkusi:locale", localize);
  listen(document, "visibilitychange", () => {
    if (document.hidden) {
      engine.pause();
      saveDraft();
      renderStatus();
    }
  });
  function dispose() {
    if (disposed) return;
    saveDraft();
    disposed = true;
    clearTimeout(draftTimer);
    for (const timer of padTimers) clearTimeout(timer);
    padTimers.clear();
    importLocks.clear();
    cancelAnimationFrame(frame);
    life.abort();
    transfer.dispose();
    compositionPanel.dispose();
    exporter.dispose();
    delivery.dispose();
    readyFile = null;
    void engine.dispose({ immediate: true });
  }
  listen(window, "pagehide", dispose);
  function tick(time) {
    if (disposed) return;
    if (time - lastFrame > 60) {
      lastFrame = time;
      renderStatus();
    }
    frame = requestAnimationFrame(tick);
  }
  const compositionPanel = initCompositionPanel({
    root,
    current,
    edit,
    engine,
    locked: () => busy || reading || receiving || disposed,
  });
  for (const kind of ["kit", "demo-kind"]) {
    $(kind).replaceChildren(
      ...(kind === "kit"
        ? ["ruang", "arus", "fusion"]
        : ["fusion", "malam", "bumi", "ruang", "arus"]
      ).map((id) => new Option(id, id)),
    );
  }
  root
    .querySelectorAll("button,input,select")
    .forEach((el) => (el.disabled = false));
  localize();
  readSaves();
  try {
    const draft = store.readDraft();
    if (draft) apply(draft);
  } catch {
    draftAllowed = false;
    message("recoveryError", true);
  }
  if (!storeAvailable) message("storageUnavailable", true);
  const transfer = initModeTransfer({
    root,
    mode: "studio",
    beforeNavigate: async () => {
      engine.pause();
      await new Promise((resolve) => setTimeout(resolve, 8));
    },
    current: project,
    onReceiving(value) {
      receiving = value;
      if (value) clearTimeout(draftTimer);
      $("title").disabled = value;
      sync();
    },
    apply: (p) => {
      draftAllowed = true;
      apply(p);
    },
    delivery,
    locked: () => busy || reading || receiving || disposed,
  });
  root.dataset.ready = "true";
  trackEvent("studio_open");
  frame = requestAnimationFrame(tick);
  // Only development/native QA can access the owner; production has no app hook.
  if (import.meta.env.DEV)
    window.perkusiStudio = {
      engine,
      exporter,
      history,
      project,
      store,
      dispose,
    };
  return dispose;
}
