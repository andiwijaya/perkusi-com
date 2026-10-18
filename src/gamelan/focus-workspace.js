import "./focus-workspace.css";
import c44100 from "../../internal/instrument-focus/registry-44100.json" with { type: "json" };
import c48000 from "../../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentSession } from "../audio/instrument-session.js";
import { focusCopy } from "./focus-copy.js";
import { HeldPadInputs } from "./held-pad-inputs.js";
import { OwnedOutput } from "../audio/owned-output.js";
import { utf8Bytes } from "../project/instrument-contract.js";
import {
  CORPUS_INSTRUMENTS,
  instrumentNames,
  physicalFocus,
  padLabel,
} from "./instrument-focus.js";
import { instrumentArt } from "./stage-art.js";
import { initInstrumentStudio } from "../studio/instrument-panel.js";
import { legacyAudible } from "../project/instrument-mix.js";
import { instrumentGroups } from "../project/instrument-mix.js";
import { instrumentDemo, INSTRUMENT_DEMOS } from "./instrument-demos.js";
import { readinessCopy } from "./readiness-copy.js";
import { initInstrumentLibrary } from "./instrument-library.js";
import { shareInstrumentOutput } from "../project/instrument-share.js";
import { gamelanWavAttribution, sourceQualityPending } from "./attribution.js";
import { resolveLocale } from "../i18n/locale.js";
import {
  trackEvent,
  initAnalytics,
  exportFailureCategory,
} from "../analytics.js";
import { gamelanPreviewPaths } from "./preview-paths.js";
import { instrumentRouteContext } from "./route-context.js";
import { InstrumentRouteStore } from "../project/instrument-route-store.js";
import { initRoutePanel } from "./route-panel.js";
import { routeCopy } from "./route-copy.js";
import {
  gamelanHostAllowed,
  syncGamelanPublicMetadata,
} from "./public-context.js";

if (
  !gamelanHostAllowed(location.hostname, import.meta.env.GAMELAN_PUBLIC_BUILD)
)
  throw Error("Local candidate only");
initAnalytics();
export const session = new InstrumentSession({
  catalogs: { 44100: c44100, 48000: c48000 },
  attributionFactory: gamelanWavAttribution,
});
const routeContext = instrumentRouteContext(
  location.pathname,
  location.search,
  import.meta.env.GAMELAN_V5_UX ? "gamelan-preview" : import.meta.env.MODE,
);
const routeStore = routeContext
  ? new InstrumentRouteStore(session.registry)
  : null;
let locale = resolveLocale({
    pathname: location.pathname,
    explicitLocale: new URL(location.href).searchParams.get("lang"),
  }),
  lastSignature = "",
  noticeCode = null,
  progress = null,
  projectOutput = null,
  studioView = false,
  modeChanging = false,
  library = null,
  lastWav = null,
  sharing = false,
  shareMessage = "",
  demoSignature = "",
  firstNote = false;
let routePanel = null,
  v5Shell = null;
const host = document.querySelector("#instrument-workspace"),
  keys = ["a", "s", "d", "f", "g", "h", "j"],
  heldKeys = new Set();
host.innerHTML = `<header><div><strong>perkusi.</strong><span class="candidate" data-copy="candidate"></span></div><button id="if-language"></button></header>
<main><h1 data-copy="title"></h1><p class="intro" data-copy="intro"></p><div class="steps"><span data-copy="step1"></span><span data-copy="step2"></span><span data-copy="step3"></span></div>
<section id="if-ensemble-stage" class="ensemble-stage"><h2 data-copy="stageTitle"></h2><p data-copy="stageHint"></p><div id="if-stage-cards" class="stage-cards"></div></section>
<section id="if-focus-workspace" class="workspace"><div class="controls"><label><span data-copy="instrument"></span><select id="if-instrument">${CORPUS_INSTRUMENTS.map((name) => `<option value="${name}">${instrumentNames[name]}</option>`).join("")}</select></label>
<label><span data-copy="laras"></span><select id="if-laras"><option value="pelog">Pelog</option><option value="slendro">Slendro</option></select></label><label><span data-copy="tempo"></span><input id="if-tempo" type="number" min="60" max="180" step="any" required value="96"></label>
<label class="check"><input id="if-ensemble" type="checkbox"><span data-copy="ensemble"></span></label><div class="audio-actions"><button id="if-enable" class="primary"></button><button id="if-pause" data-copy="pause"></button></div></div>
<div class="status" id="if-status" role="status" aria-live="polite"><span class="status-dot"></span><span id="if-status-text"></span><button id="if-retry"></button><button id="if-cancel" data-copy="cancel"></button></div>
<div class="stage"><svg class="rack-art" viewBox="0 0 720 240" aria-hidden="true"><defs><linearGradient id="wood" x2="1" y2="1"><stop stop-color="#64775c"/><stop offset="1" stop-color="#2d493a"/></linearGradient></defs><path d="M24 66Q360 112 696 66L676 185Q360 229 44 185Z" fill="url(#wood)"/><path d="M44 172Q360 211 676 172" fill="none" stroke="#a5b88a" stroke-width="4"/><path d="M70 184L57 229H96L110 190M610 190L624 229H663L650 184" fill="#3c5741"/><path d="M45 96Q360 143 675 96" fill="none" stroke="#a2a975" stroke-width="6"/><g fill="none" stroke="#849464" stroke-width="3"><path d="M115 138l18 22-18 22-18-22Z"/><path d="M585 138l18 22-18 22-18-22Z"/><path d="M350 160l12 16-12 16-12-16Z"/></g></svg><div id="if-pads" class="pads"></div></div>
<div id="if-ensemble-pads" class="ensemble-pads"></div><p class="keyboard-help" data-copy="keys"></p>
<div class="take-panel"><div class="toolbar"><button id="if-record" class="record"></button><button id="if-replay" data-copy="replay"></button><button id="if-damp" data-copy="damp"></button><button id="if-clear" data-copy="clear"></button><button id="if-studio" data-copy="toStudio"></button></div>
<label class="check"><input id="if-guide" type="checkbox"><span data-copy="guide"></span></label><div class="metrics"><span><span data-copy="events"></span><strong id="if-events">0</strong></span><span><span data-copy="voices"></span><strong id="if-voices">0</strong></span><span><span data-copy="memory"></span><strong id="if-memory">0 MB</strong></span><span><span data-copy="profile"></span><strong id="if-profile">—</strong></span></div>
<div id="if-studio-host" class="instrument-studio" hidden></div><p id="if-notice" class="notice" aria-live="polite"></p><progress id="if-progress" class="hidden" max="1"></progress><div class="file-actions"><button id="if-export" class="primary" data-copy="export"></button><button id="if-pause-export" data-copy="pauseExport"></button><button id="if-cancel-export" data-copy="cancelExport"></button><button id="if-project" data-copy="project"></button><button id="if-open" data-copy="import"></button><button id="if-release-wav" data-copy="releaseWav"></button><input class="hidden" id="if-file" type="file" accept=".json,.perkusi.json"></div></div></section><p class="credit" data-copy="credit"></p></main>`;
const $ = (id) => document.getElementById(id),
  t = () => focusCopy[locale];
const main = host.querySelector("main"),
  skipLink = document.createElement("a");
main.id = "if-main";
main.tabIndex = -1;
skipLink.href = "#if-main";
skipLink.className = "skip-link";
host.prepend(skipLink);
$("if-status").removeAttribute("role");
$("if-status").removeAttribute("aria-live");
$("if-status-text").setAttribute("role", "status");
$("if-status-text").setAttribute("aria-atomic", "true");
$("if-notice").setAttribute("role", "status");
$("if-notice").setAttribute("aria-atomic", "true");
host.querySelector(".keyboard-help").id = "if-pad-help";
host.addEventListener(
  "invalid",
  (event) => {
    event.target.setAttribute("aria-invalid", "true");
  },
  true,
);
host.addEventListener("input", (event) => {
  event.target.removeAttribute("aria-invalid");
});
for (const language of ["id", "en"])
  Object.assign(focusCopy[language].errors, readinessCopy[language].errors);
for (const language of ["id", "en"])
  Object.assign(focusCopy[language].errors, routeCopy[language].errors);
const demoHost = document.createElement("section"),
  libraryHost = document.createElement("section"),
  helpHost = document.createElement("details");
demoHost.id = "if-demo-panel";
demoHost.className = "readiness-panel";
libraryHost.id = "if-library";
libraryHost.className = "readiness-panel";
helpHost.id = "if-help";
helpHost.className = "readiness-panel";
helpHost.innerHTML =
  "<summary></summary><p data-help></p><p data-privacy></p><a data-credits></a>";
host.querySelector(".steps").after(helpHost, demoHost);
host.querySelector(".credit").before(libraryHost);
const shareButton = document.createElement("button"),
  shareStatus = document.createElement("output");
shareButton.id = "if-share";
shareButton.type = "button";
shareStatus.id = "if-share-status";
shareStatus.setAttribute("role", "status");
$("if-release-wav").before(shareButton, shareStatus);
const error = (code) => {
  noticeCode = code ?? "fallback";
  render(session.snapshot());
};
const act = async (fn) => {
  noticeCode = null;
  try {
    await fn();
  } catch (e) {
    error(e.code ?? "fallback");
  }
  render(session.snapshot());
};
function download(output, name) {
  const url = output.downloadURL();
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}
function render(s) {
  const r = readinessCopy[locale];
  skipLink.textContent = t().skip;
  $("if-progress").setAttribute("aria-label", t().exporting);
  helpHost.querySelector("summary").textContent = r.help;
  helpHost.querySelector("[data-help]").textContent = r.helpText;
  helpHost.querySelector("[data-privacy]").textContent = r.helpPrivacy;
  helpHost.querySelector("[data-credits]").textContent = r.credits;
  helpHost.querySelector("[data-credits]").href = gamelanPreviewPaths(
    location.pathname,
    locale,
    { studio: routeContext?.studio },
  ).credits;
  shareButton.textContent = r.share;
  shareButton.disabled =
    sharing || !lastWav?.active || s.exporting || s.disposing || s.disposed;
  shareStatus.textContent = sharing
    ? r.sharing
    : shareMessage
      ? r[shareMessage]
      : "";
  $("if-release-wav").disabled = sharing;
  demoHost.hidden = studioView;
  renderDemos(s);
  library?.render();
  routePanel?.render();
  const hasAudio = s.events || legacyAudible(session.project.composition);
  if (s.disposing || s.disposed) {
    projectOutput?.release();
    projectOutput = null;
  }
  $("if-instrument").value = s.focus.instrument;
  $("if-laras").value = s.focus.laras;
  $("if-ensemble").checked = s.focus.ensemble;
  $("if-ensemble-stage").hidden = studioView;
  $("if-focus-workspace").classList.toggle("studio-view", studioView);
  $("if-studio-host").hidden = !studioView;
  document.documentElement.lang = locale;
  document.title =
    locale === "id"
      ? "Perkusi — Fokus Instrumen Kandidat"
      : "Perkusi — Candidate Instrument Focus";
  for (const node of host.querySelectorAll("[data-copy]"))
    node.textContent = t()[node.dataset.copy];
  if (routeContext?.studio) {
    host.querySelector("h1").textContent = routeCopy[locale].studioTitle;
    document.title = "Perkusi — " + routeCopy[locale].studioTitle;
  }
  if (import.meta.env.GAMELAN_PUBLIC_BUILD) {
    const meta = syncGamelanPublicMetadata(locale, {
      studio: !!routeContext?.studio,
    });
    host.querySelector('[data-copy="candidate"]').textContent = r.preview;
    if (routeContext?.studio)
      host.querySelector("h1").textContent = meta.heading;
  }
  $("if-language").textContent = t().language;
  $("if-enable").textContent =
    s.contextState === "absent" ? t().enable : t().resume;
  $("if-status").className = "status " + s.status;
  const statusText =
    s.status === "ready" && !s.playbackRequested
      ? t().paused
      : (t()[s.status] ?? t().error);
  if ($("if-status-text").textContent !== statusText)
    $("if-status-text").textContent = statusText;
  $("if-enable").disabled =
    s.exporting ||
    s.disposing ||
    s.disposed ||
    (s.playbackRequested &&
      ["ready", "loading", "starting"].includes(s.status));
  $("if-cancel").classList.toggle("hidden", s.status !== "loading");
  $("if-retry").classList.toggle(
    "hidden",
    !["error", "cancelled"].includes(s.status),
  );
  $("if-retry").textContent = t().retry;
  $("if-record").textContent = s.recording ? t().finish : t().record;
  $("if-record").classList.toggle("active", s.recording);
  $("if-record").disabled =
    !s.playbackRequested ||
    s.status !== "ready" ||
    s.exporting ||
    s.replaying ||
    s.armingRecord;
  $("if-replay").disabled =
    !hasAudio || !s.playbackRequested || s.recording || s.exporting;
  $("if-guide").checked = s.legacyGuide;
  $("if-guide").disabled = !s.playbackRequested || s.recording || s.replaying;
  $("if-pause").disabled = s.contextState === "absent";
  $("if-damp").disabled = !s.playbackRequested;
  $("if-events").textContent = s.events;
  $("if-voices").textContent = s.voiceCount;
  $("if-memory").textContent =
    (s.memory.bytes / 1048576).toFixed(1) + " MiB / 64";
  $("if-profile").textContent = s.profile / 1000 + " kHz";
  $("if-tempo").value = session.project.composition.timing.bpm;
  $("if-tempo").disabled = !!s.events || s.recording || s.legacyGuide;
  $("if-studio").disabled =
    modeChanging ||
    s.status === "loading" ||
    s.status === "starting" ||
    s.recording ||
    s.armingRecord ||
    s.exporting ||
    s.replaying ||
    s.disposing ||
    s.disposed;
  $("if-cancel-export").classList.toggle("hidden", !s.exporting);
  $("if-export").disabled =
    !hasAudio || s.repeating || s.recording || s.exporting || sharing;
  $("if-pause-export").disabled =
    !hasAudio || s.repeating || s.recording || s.exporting || sharing;
  $("if-progress").classList.toggle("hidden", !s.exporting);
  if (progress !== null) $("if-progress").value = progress;
  const code = noticeCode ?? s.error;
  $("if-notice").classList.toggle("error-notice", !!code);
  const noticeText = code
    ? (t().errors[code] ?? t().errors.fallback)
    : s.recording
      ? t().recording
      : s.exporting
        ? t().exporting
        : s.replaying
          ? t().replaying
          : "";
  if ($("if-notice").textContent !== noticeText)
    $("if-notice").textContent = noticeText;
  const main = s.notes
    .filter((n) => n.instrument === s.focus.instrument)
    .sort(
      (a, b) =>
        Number(a.pitch.match(/\d+/)?.[0]) - Number(b.pitch.match(/\d+/)?.[0]),
    );
  const signature =
    s.focus.instrument +
    "/" +
    s.focus.laras +
    "/" +
    s.notes.map((n) => n.sampleId).join();
  if (signature !== lastSignature) {
    lastSignature = signature;
    inputs.clear({ damp: false });
    $("if-pads").replaceChildren();
    $("if-pads").classList.toggle("few-pads", main.length <= 4);
    const bars = ["demung", "saron-barung", "peking", "slenthem"].includes(
      s.focus.instrument,
    );
    const originalRack = host.querySelector(".rack-art");
    originalRack.hidden = !bars;
    let figure = host.querySelector(".focus-figure");
    if (!figure) {
      figure = document.createElement("div");
      figure.className = "focus-figure";
      originalRack.after(figure);
    }
    figure.hidden = bars;
    figure.innerHTML = bars ? "" : instrumentArt(s.focus.instrument);
    $("if-ensemble-pads").replaceChildren();
    for (const [i, n] of main.entries()) {
      const b = document.createElement("button");
      b.className = "pad";
      b.classList.toggle(
        "pot-pad",
        [
          "bonang-barung",
          "bonang-panerus",
          "kenong",
          "kethuk",
          "kempyang",
        ].includes(n.instrument),
      );
      b.classList.toggle(
        "gong-pad",
        ["gong-ageng", "kempul"].includes(n.instrument),
      );
      b.dataset.bank = n.bankId;
      b.dataset.sample = n.sampleId;
      if (sourceQualityPending(n.sampleId)) {
        b.dataset.quality = "pending";
        b.title = r.review;
      }
      b.dataset.key = keys[i];
      b.dataset.damp = [
        "gong-ageng",
        "kempul",
        "kendhang-ciblon",
        "kethuk",
        "kempyang",
      ].includes(n.instrument)
        ? ""
        : "true";
      const degree = padLabel(n);
      b.setAttribute(
        "aria-label",
        `${instrumentNames[s.focus.instrument]} ${degree}, ${keys[i].toUpperCase()}`,
      );
      b.setAttribute("aria-keyshortcuts", keys[i].toUpperCase());
      b.setAttribute("aria-describedby", "if-pad-help");
      b.innerHTML = `<strong>${degree}</strong><kbd>${keys[i].toUpperCase()}</kbd>`;
      $("if-pads").append(b);
    }
    for (const n of s.notes.filter(
      (n) => n.instrument !== s.focus.instrument,
    )) {
      const b = document.createElement("button");
      b.className = "ensemble-pad";
      b.dataset.bank = n.bankId;
      b.dataset.sample = n.sampleId;
      b.textContent =
        n.instrument.replaceAll("-", " ") +
        (n.instrument === "kendhang-ciblon" ? " · " + n.articulation : "");
      $("if-ensemble-pads").append(b);
    }
  }
  for (const b of host.querySelectorAll("[data-sample]"))
    b.disabled =
      studioView || s.repeating || s.status !== "ready" || !s.playbackRequested;
  renderStage(s);
  if (studioView) studio.render(s);
  v5Shell?.render(s, studioView);
}
function renderDemos(s) {
  const r = readinessCopy[locale],
    busy =
      s.repeating ||
      s.recording ||
      s.armingRecord ||
      s.exporting ||
      s.status === "loading" ||
      s.status === "starting" ||
      s.disposing ||
      s.disposed;
  const groupStates = instrumentGroups(session.project, session.registry);
  const signature =
    locale +
    "/" +
    groupStates.map((g) => g.bankId + "/" + g.instrumentId).join(",");
  const focusedMute = demoHost.contains(document.activeElement)
    ? document.activeElement.dataset.demoMute
    : null;
  const rebuild = signature !== demoSignature;
  if (rebuild) {
    demoSignature = signature;
    demoHost.replaceChildren();
    const h = document.createElement("h2"),
      p = document.createElement("p"),
      cards = document.createElement("div");
    h.textContent = r.demos;
    p.textContent = r.demoHelp;
    cards.className = "demo-choices";
    demoHost.append(h, p, cards);
    for (const demo of INSTRUMENT_DEMOS) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.playDemo = demo.id;
      b.textContent = r.playDemo + ": " + demo.title[locale];
      b.disabled = busy;
      b.onclick = (event) =>
        act(async () => {
          const p = session.project.composition;
          if (
            (session.project.events.length ||
              p.clips.some((c) => c.enabled) ||
              p.patterns.some(
                (a) =>
                  a.notes.some(Boolean) ||
                  Object.values(a.steps).some((row) => row.some(Boolean)),
              )) &&
            !confirm(r.replaceDemo)
          )
            return;
          const demoProject = instrumentDemo(demo.id, session.registry);
          session.importJSON(JSON.stringify(demoProject));
          await session.enable({
            gesture: event.isTrusted,
            focus: {
              instrument: "kendhang-ciblon",
              laras: demo.laras,
              ensemble: false,
            },
          });
          await session.replay({ playAlong: true });
          trackEvent("gamelan_demo_played");
        });
      cards.append(b);
    }
    const resume = document.createElement("button");
    resume.type = "button";
    resume.dataset.demoResume = "true";
    resume.textContent = r.continue;
    resume.onclick = (event) =>
      act(async () => {
        await session.enable({ gesture: event.isTrusted });
        await session.replay({ resume: true, playAlong: true });
      });
    demoHost.append(resume);
    const groups = document.createElement("div");
    groups.className = "demo-mutes";
    for (const group of groupStates) {
      const label = document.createElement("label"),
        checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = group.mute;
      checkbox.disabled = busy;
      checkbox.dataset.demoMute = group.bankId + "/" + group.instrumentId;
      label.append(
        checkbox,
        document.createTextNode(
          r.mute +
            " " +
            (instrumentNames[group.instrumentId] ?? group.instrumentId),
        ),
      );
      groups.append(label);
    }
    demoHost.append(groups);
    const beat = document.createElement("output");
    beat.id = "if-demo-beat";
    beat.setAttribute("aria-live", "off");
    demoHost.append(beat);
  }
  // Preserve keyed inputs across project/mix notifications and reconcile from
  // accepted state even when a native toggle was refused without a new project.
  for (const checkbox of demoHost.querySelectorAll("[data-demo-mute]")) {
    const group = groupStates.find(
      (g) => g.bankId + "/" + g.instrumentId === checkbox.dataset.demoMute,
    );
    checkbox.checked = group.mute;
    checkbox.disabled = busy;
    checkbox.onchange = () =>
      act(() =>
        session.setInstrumentGroupMix({ ...group, mute: checkbox.checked }),
      );
    if (
      rebuild &&
      focusedMute === checkbox.dataset.demoMute &&
      !checkbox.disabled
    )
      checkbox.focus();
  }
  for (const button of demoHost.querySelectorAll("[data-play-demo]"))
    button.disabled = busy;
  demoHost.querySelector("[data-demo-resume]").disabled =
    busy || !s.canResume || s.replaying;
  $("if-demo-beat").textContent = s.replaying
    ? r.beat + " " + (s.clock.beat + 1).toFixed(1)
    : "";
}
function renderStage(s) {
  const busy =
    modeChanging ||
    s.recording ||
    s.armingRecord ||
    s.exporting ||
    s.replaying ||
    s.disposing ||
    s.disposed;
  for (const card of $("if-stage-cards").children) {
    const name = card.dataset.instrument,
      physical = physicalFocus(session.registry, name, s.focus.laras),
      chosen = name === s.focus.instrument;
    const state = chosen
      ? s.status === "loading"
        ? "stageLoading"
        : ["error", "cancelled"].includes(s.status)
          ? "stageError"
          : s.status === "ready"
            ? "stageActive"
            : "stageIdle"
      : "stageIdle";
    card.querySelector(".stage-detail").textContent =
      `${physical.length} ${t().stageNotes} · ${physical[0].bank.laras === "shared" ? t().stageShared : s.focus.laras}`;
    const stateText = card.querySelector(".stage-state");
    if (stateText.textContent !== t()[state])
      stateText.textContent = t()[state];
    card.classList.toggle(
      "playing",
      s.notes.some((n) => n.instrument === name && n.active),
    );
    card.dataset.state = state;
    const choose = card.querySelector("[data-stage-focus]"),
      strike = card.querySelector("[data-stage-strike]");
    choose.textContent = t().chooseFocus;
    choose.setAttribute(
      "aria-label",
      `${instrumentNames[name]} - ${t().chooseFocus}`,
    );
    choose.disabled = busy;
    choose.setAttribute("aria-pressed", String(chosen));
    strike.textContent = t().stageStrike;
    strike.setAttribute(
      "aria-label",
      `${instrumentNames[name]} - ${t().stageStrike}`,
    );
    strike.disabled = busy || s.status === "loading";
  }
}
const focus = () =>
  session.setFocus({
    instrument: $("if-instrument").value,
    laras: $("if-laras").value,
    ensemble: $("if-ensemble").checked,
  });
$("if-language").onclick = () => {
  locale = locale === "id" ? "en" : "id";
  const url = new URL(location.href);
  url.searchParams.set("lang", locale);
  history.replaceState(null, "", url);
  render(session.snapshot());
};
$("if-enable").onclick = (e) =>
  act(() => session.enable({ gesture: e.isTrusted }));
$("if-pause").onclick = () => act(() => session.pause());
for (const id of ["if-instrument", "if-laras", "if-ensemble"])
  $(id).onchange = () => act(focus);
$("if-retry").onclick = () => act(focus);
$("if-cancel").onclick = () => session.cancelLoading();
$("if-tempo").onchange = () => {
  const input = $("if-tempo");
  if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
    input.reportValidity();
    return;
  }
  act(() => session.setTempo(input.valueAsNumber));
};
$("if-record").onclick = () =>
  act(() =>
    session.snapshot().recording
      ? session.finishRecording()
      : session.startRecording(),
  );
$("if-replay").onclick = () => act(() => session.replay());
$("if-damp").onclick = () => act(() => session.dampAll());
$("if-clear").onclick = () => act(() => session.clearRecording());
$("if-guide").onchange = () =>
  act(() => session.legacyGuide($("if-guide").checked));
const exporting = (pauseAndRelease) =>
  act(async () => {
    progress = 0;
    try {
      const result = await session.exportWav({
        pauseAndRelease,
        onProgress: (e) => {
          progress = e.value;
          render(session.snapshot());
        },
      });
      download(result, "perkusi-instrument.wav");
      lastWav = result;
      trackEvent("audio_export_succeeded");
    } catch (error) {
      trackEvent("audio_export_failed", exportFailureCategory(error.code));
      throw error;
    } finally {
      progress = null;
    }
  });
$("if-export").onclick = () => exporting(false);
$("if-pause-export").onclick = () => exporting(true);
$("if-cancel-export").onclick = () => session.cancelExport();
$("if-project").onclick = () =>
  act(() => {
    projectOutput?.release();
    projectOutput = null;
    const text = session.toJSON();
    const allocation = session.memory.reserve(
      utf8Bytes(text) * 2,
      "project download encoding + Blob",
    );
    try {
      projectOutput = new OwnedOutput(
        new Blob([text], { type: "application/json" }),
        allocation,
      );
      download(projectOutput, "perkusi-instrument.perkusi.json");
    } catch (error) {
      projectOutput?.release();
      projectOutput = null;
      allocation.release();
      throw error;
    }
  });
$("if-open").onclick = () => $("if-file").click();
$("if-file").onchange = () =>
  act(async () => {
    const file = $("if-file").files[0];
    if (!file) return;
    if (file.size > 1048576) {
      error("projectTooLarge");
      return;
    }
    session.importJSON(await file.text());
    $("if-file").value = "";
  });
$("if-release-wav").onclick = () => {
  projectOutput?.release();
  projectOutput = null;
  session.releaseExport();
  lastWav = null;
  render(session.snapshot());
};
shareButton.onclick = () =>
  act(async () => {
    if (sharing || !lastWav?.active) return;
    sharing = true;
    shareMessage = "";
    render(session.snapshot());
    try {
      const result = await shareInstrumentOutput(lastWav, {
        memory: session.memory,
        download,
      });
      shareMessage =
        result === "shared"
          ? "shareShared"
          : result === "cancelled"
            ? "shareCancelled"
            : "shareDownload";
    } finally {
      sharing = false;
      render(session.snapshot());
    }
  });
const inputs = new HeldPadInputs({
  activate: (b) => {
    b.classList.add("pressed");
    act(() => {
      strikeNote(b.dataset.bank, b.dataset.sample);
    });
  },
  deactivate: (b, damp) => {
    b.classList.remove("pressed");
    if (damp && b.dataset.damp && session.snapshot().playbackRequested)
      act(() => session.damp(b.dataset.bank, b.dataset.sample));
  },
});
const studio = initInstrumentStudio({
  host: $("if-studio-host"),
  session,
  locale: () => locale,
  act,
  sharing: () => sharing,
  canShare: () => !!lastWav?.active,
  back: async () => {
    if (modeChanging) return;
    modeChanging = true;
    try {
      await session.prepareStudio();
      inputs.clear({ damp: false });
      studioView = false;
    } finally {
      modeChanging = false;
      render(session.snapshot());
      if (!studioView) $("if-instrument").focus();
    }
  },
  fileAction: (id) => $(id).click(),
});
$("if-studio").onclick = () =>
  act(async () => {
    if (modeChanging) return;
    modeChanging = true;
    render(session.snapshot());
    try {
      await studio.enter();
      inputs.clear({ damp: false });
      studioView = true;
      trackEvent("gamelan_to_studio");
    } finally {
      modeChanging = false;
      render(session.snapshot());
      if (studioView) document.getElementById("is-title").focus();
    }
  });
const chooseStage = (name, hit, event) =>
  act(async () => {
    const spec = {
      instrument: name,
      laras: $("if-laras").value,
      ensemble: $("if-ensemble").checked,
    };
    const choice = session.setFocus(spec);
    if (hit && session.snapshot().contextState === "absent") {
      // Initiate the shared context synchronously in the trusted stage gesture.
      const ready = session.enable({ gesture: event.isTrusted });
      await choice;
      await ready;
    } else await choice;
    $("if-focus-workspace").scrollIntoView({
      block: "start",
      behavior: "auto",
    });
    if (!hit) $("if-instrument").focus();
    if (hit) {
      if (!session.snapshot().playbackRequested)
        await session.enable({ gesture: event.isTrusted });
      const note = session.snapshot().notes.find((n) => n.instrument === name);
      strikeNote(note.bankId, note.sampleId);
    }
  });
function strikeNote(bankId, sampleId) {
  const when = session.strike(bankId, sampleId);
  if (!firstNote) {
    firstNote = true;
    trackEvent("gamelan_first_note");
  }
  return when;
}
for (const name of CORPUS_INSTRUMENTS) {
  const card = document.createElement("article");
  card.dataset.instrument = name;
  card.innerHTML = `${instrumentArt(name)}<h3>${instrumentNames[name]}</h3><p class="stage-detail"></p><p class="stage-state" role="status"></p><div><button type="button" data-stage-focus="${name}"></button><button type="button" data-stage-strike="${name}"></button></div>`;
  card.querySelector("[data-stage-focus]").onclick = (e) =>
    chooseStage(name, false, e);
  card.querySelector("[data-stage-strike]").onclick = (e) =>
    chooseStage(name, true, e);
  $("if-stage-cards").append(card);
}
host.addEventListener("pointerdown", (e) => {
  const b = e.target.closest("[data-sample]");
  if (b && !b.disabled) {
    e.preventDefault();
    b.focus({ preventScroll: true });
    try {
      b.setPointerCapture(e.pointerId);
    } catch {
      /* Browser without capture. */
    }
    inputs.press("pointer:" + e.pointerId, b);
  }
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  document.addEventListener(type, (e) =>
    inputs.release("pointer:" + e.pointerId),
  );
document.addEventListener("keydown", (e) => {
  const token = "key:" + (e.code || e.key.toLowerCase());
  if (heldKeys.has(token) && (e.repeat || inputs.owns(token))) {
    e.preventDefault();
    return;
  }
  heldKeys.delete(token); // A fresh press after blur replaces a cancelled cycle.
  if (
    e.repeat ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.target.matches("input,select,textarea")
  )
    return;
  const letter = e.key.toLowerCase(),
    b =
      keys.includes(letter) && e.target.closest("[data-sample]")
        ? host.querySelector(`[data-key="${letter}"]`)
        : ["Enter", " "].includes(e.key)
          ? e.target.closest("[data-sample]")
          : null;
  if (b) {
    e.preventDefault();
    if (!b.disabled) {
      heldKeys.add(token);
      inputs.press(token, b);
    }
  }
});
document.addEventListener("keyup", (e) => {
  const token = "key:" + (e.code || e.key.toLowerCase());
  if (!heldKeys.delete(token)) return;
  // Also cancel native button activation after focus moves during a held key.
  e.preventDefault();
  inputs.release(token);
});
window.addEventListener("blur", () => {
  inputs.clear({ damp: false });
  // Keep consumed keys until keyup so moved focus cannot receive a native click.
  session.pause();
});
window.addEventListener("pagehide", () => {
  session.pause();
  library?.close();
  routePanel?.close();
  projectOutput?.release();
  projectOutput = null;
  inputs.clear({ damp: false });
  heldKeys.clear();
  void session.dispose();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    inputs.clear({ damp: false });
    session.pause();
    library?.flush();
  }
});
library = initInstrumentLibrary({
  host: libraryHost,
  session,
  locale: () => locale,
  act,
  reportError: error,
  draftStore: routeStore,
  immediateDraft: !!routeStore,
});
if (routeContext) {
  const routeHost = document.createElement("section");
  routeHost.id = "if-route";
  routeHost.className = "readiness-panel";
  helpHost.before(routeHost);
  const downloadRaw = (text, name) => {
    projectOutput?.release();
    projectOutput = null;
    const allocation = session.memory.reserve(
      utf8Bytes(text) * 2,
      "route backup Blob + encoding",
    );
    try {
      projectOutput = new OwnedOutput(
        new Blob([text], { type: "application/json" }),
        allocation,
      );
      download(projectOutput, name);
    } catch (e) {
      allocation.release();
      throw e;
    }
  };
  routePanel = initRoutePanel({
    host: routeHost,
    session,
    store: routeStore,
    studio: routeContext.studio,
    locale: () => locale,
    act,
    blocked: () => {
      const s = session.snapshot();
      return (
        sharing ||
        modeChanging ||
        s.recording ||
        s.armingRecord ||
        s.exporting ||
        s.replaying ||
        s.disposing ||
        s.disposed ||
        s.status === "loading" ||
        s.status === "starting"
      );
    },
    downloadRaw,
    flushDraft: () => library.flush(),
    sharedDraftAvailable: () => library.sharedDraftAvailable,
    readSharedDraft: () => library.readSharedDraft(),
    restore: (p) => session.importJSON(JSON.stringify(p)),
    releaseProjectOutput: () => {
      projectOutput?.release();
      projectOutput = null;
    },
  });
  window.addEventListener("beforeunload", (event) => {
    if (library?.hasPending) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  window.addEventListener("storage", (event) => {
    if (
      event.key === "perkusi.workspace.instrument-route.v4" &&
      event.storageArea === sessionStorage
    ) {
      session.pause();
      error("routeConflict");
    }
  });
}
if (import.meta.env.GAMELAN_V5_UX) {
  const { initV5Shell } = await import("./v5-shell.js");
  v5Shell = initV5Shell({
    host,
    session,
    studio,
    locale: () => locale,
    act,
    setLocale: (language) => {
      locale = language;
      const url = new URL(location.href);
      url.searchParams.set("lang", language);
      history.replaceState(null, "", url);
      render(session.snapshot());
    },
    flushDraft: () => {
      if (!library.flush())
        throw Object.assign(Error("draft was not saved"), {
          code: noticeCode ?? "storageUnavailable",
        });
      // Check the route revision even when there is no debounced pending write.
      // A concurrent tab-draft replacement must not be silently abandoned.
      routeStore?.prepare(session.project);
      return true;
    },
    blocked: () => {
      const s = session.snapshot();
      return (
        sharing ||
        modeChanging ||
        s.recording ||
        s.armingRecord ||
        s.exporting ||
        s.disposing ||
        s.disposed ||
        s.status === "loading" ||
        s.status === "starting"
      );
    },
    releaseOutputs: () => {
      library.close();
      routePanel?.close();
      projectOutput?.release();
      projectOutput = null;
      inputs.clear({ damp: false });
    },
  });
}
session.subscribe(render);
if (routeContext?.studio) {
  modeChanging = true;
  studio
    .enter()
    .then(() => {
      studioView = true;
    })
    .catch((e) => error(e.code ?? "fallback"))
    .finally(() => {
      modeChanging = false;
      render(session.snapshot());
    });
}
trackEvent(routeContext?.studio ? "studio_open" : "gamelan_open");
const visualClock = setInterval(() => {
  if (session.snapshot().replaying && !studioView)
    renderDemos(session.snapshot());
}, 100);
window.addEventListener("pagehide", () => clearInterval(visualClock));
