import { InstrumentStudioBridge } from "../project/instrument-studio-bridge.js";
import { PPQ, MAX_EVENT_TICK } from "../project/instrument-project.js";
import { instrumentNames, padLabel } from "../gamelan/instrument-focus.js";
import { instrumentStudioMessages } from "./instrument-messages.js";
import {
  compositionPanel,
  combinedMessages,
} from "./instrument-composition-panel.js";
import {
  INSTRUMENT_DEMOS,
  instrumentDemo,
} from "../gamelan/instrument-demos.js";
import { legacyAudible } from "../project/instrument-mix.js";
import { readinessCopy } from "../gamelan/readiness-copy.js";

export function initInstrumentStudio({
  host,
  session,
  locale,
  act,
  back,
  fileAction,
  sharing = () => false,
  canShare = () => false,
}) {
  let bridge = null,
    page = 0,
    selected = null,
    lastProject = null,
    lastLocale = null,
    renderedProject = null,
    renderedPage = -1,
    filledEvent = null,
    desktopHintDismissed = false;
  host.innerHTML = `<h2 id="is-title"></h2><p id="is-intro"></p><div class="toolbar"><button id="is-back"></button><button id="is-enable"></button><button id="is-play"></button><button id="is-pause"></button><button id="is-undo"></button><button id="is-redo"></button></div><p id="is-status" role="status"></p><div class="studio-columns"><div><h3 id="is-events"></h3><div id="is-list" class="event-list"></div><div class="toolbar"><button id="is-previous"></button><output id="is-page"></output><button id="is-next"></button></div></div><form id="is-editor"><p id="is-selection"></p><label><span id="is-beat-label"></span><input id="is-beat" type="number" min="0" max="${(MAX_EVENT_TICK - 1) / PPQ}" step="any" required></label><label><span id="is-velocity-label"></span><input id="is-velocity" type="number" min="0" max="1" step="any" required></label><div class="toolbar"><button id="is-apply" type="submit"></button><button id="is-delete" type="button"></button></div><p id="is-notice"></p></form></div><div class="toolbar"><button id="is-export"></button><button id="is-pause-export"></button><button id="is-project"></button><button id="is-open"></button><button id="is-release"></button></div>`;
  const $ = (id) => host.querySelector("#is-" + id),
    text = () => instrumentStudioMessages[locale()];
  $("title").tabIndex = -1;
  $("editor").setAttribute("aria-labelledby", "is-selection");
  $("beat").setAttribute(
    "aria-describedby",
    "is-selection is-notice if-notice",
  );
  $("velocity").setAttribute(
    "aria-describedby",
    "is-selection is-notice if-notice",
  );
  const cancelExport = document.createElement("button");
  cancelExport.id = "is-cancel-export";
  cancelExport.type = "button";
  $("pause-export").after(cancelExport);
  const desktopHint = document.createElement("aside");
  desktopHint.id = "is-desktop-hint";
  desktopHint.className = "studio-desktop-hint";
  desktopHint.innerHTML =
    '<p id="is-desktop-hint-text"></p><button type="button" id="is-dismiss-hint"></button>';
  $("intro").after(desktopHint);
  $("dismiss-hint").onclick = () => {
    desktopHintDismissed = true;
    desktopHint.hidden = true;
    [$("enable"), $("pause"), $("back")]
      .find((button) => !button.disabled)
      ?.focus();
  };
  const compositionHost = document.createElement("section"),
    demosHost = document.createElement("section"),
    resumeButton = document.createElement("button");
  compositionHost.id = "is-composition";
  demosHost.id = "is-demos";
  desktopHint.after(demosHost, compositionHost);
  resumeButton.id = "is-resume";
  resumeButton.type = "button";
  $("play").after(resumeButton);
  const shareButton = document.createElement("button");
  shareButton.id = "is-share";
  shareButton.type = "button";
  $("release").before(shareButton);
  let compositionUI;
  const blocked = (s) =>
    s.disposing ||
    s.disposed ||
    s.exporting ||
    s.recording ||
    s.armingRecord ||
    s.replaying ||
    s.status === "loading" ||
    s.status === "starting";
  function render(s = session.snapshot()) {
    const t = text();
    const cancelHadFocus = document.activeElement === cancelExport;
    cancelExport.textContent = t.cancelExport;
    cancelExport.hidden = !s.exporting;
    cancelExport.disabled = s.disposed || s.disposing;
    $("desktop-hint-text").textContent = t.desktopHint;
    $("dismiss-hint").textContent = t.dismissHint;
    desktopHint.hidden = desktopHintDismissed;
    for (const name of [
      "title",
      "intro",
      "back",
      "enable",
      "play",
      "pause",
      "undo",
      "redo",
      "apply",
      "previous",
      "next",
      "notice",
      "project",
      "open",
      "release",
      "export",
      "pauseExport",
    ])
      $(name.replace("pauseExport", "pause-export")).textContent = t[name];
    $("delete").textContent = t.remove;
    $("beat-label").textContent = t.beat;
    $("velocity-label").textContent = t.velocity;
    $("status").textContent = s.replaying
      ? t.play
      : s.exporting
        ? t.export
        : s.recording
          ? t.finishFirst
          : "";
    if (!bridge) return;
    if (session.project !== lastProject) {
      bridge.replace(session.project);
      lastProject = session.project;
    }
    const busy = blocked(s) || sharing();
    shareButton.textContent = readinessCopy[locale()].share;
    shareButton.disabled = busy || !canShare();
    $("release").disabled = sharing();
    resumeButton.textContent = combinedMessages[locale()].resume;
    resumeButton.disabled = busy || !s.canResume || !s.playbackRequested;
    const audible =
      bridge.project.events.length || legacyAudible(bridge.project.composition);
    $("back").disabled = busy;
    $("enable").disabled = busy || s.playbackRequested;
    $("play").disabled = busy || !audible || !s.playbackRequested;
    $("pause").disabled = s.contextState === "absent";
    $("undo").disabled = busy || !bridge.canUndo;
    $("redo").disabled = busy || !bridge.canRedo;
    for (const name of ["export", "pause-export"])
      $(name).disabled = busy || !audible;
    if (cancelHadFocus && cancelExport.hidden)
      queueMicrotask(() => {
        if (!$("export").disabled) $("export").focus();
      });
    compositionUI?.render(busy);
    const demoSignature = locale() + busy;
    if (demosHost.dataset.signature !== demoSignature) {
      demosHost.dataset.signature = demoSignature;
      demosHost.replaceChildren();
      const heading = document.createElement("h3");
      heading.textContent =
        locale() === "id" ? "Empat demo kandidat" : "Four candidate demos";
      demosHost.append(heading);
      for (const demo of INSTRUMENT_DEMOS) {
        const article = document.createElement("article"),
          p = document.createElement("p"),
          button = document.createElement("button");
        p.textContent = demo.detail[locale()];
        button.type = "button";
        button.disabled = busy;
        button.textContent =
          (locale() === "id" ? "Muat demo: " : "Load demo: ") +
          demo.title[locale()];
        button.dataset.demo = demo.id;
        button.onclick = () =>
          transact(() =>
            bridge.loadProject(instrumentDemo(demo.id, session.registry)),
          );
        article.append(button, p);
        demosHost.append(article);
      }
    }
    $("events").textContent = t.events + " · " + bridge.project.events.length;
    const pages = Math.max(1, Math.ceil(bridge.project.events.length / 64));
    page = Math.min(page, pages - 1);
    $("page").textContent = page + 1 + " / " + pages;
    $("previous").disabled = !page;
    $("next").disabled = page >= pages - 1;
    if (
      lastLocale !== locale() ||
      renderedProject !== bridge.project ||
      renderedPage !== page
    ) {
      lastLocale = locale();
      renderedProject = bridge.project;
      renderedPage = page;
      $("list").replaceChildren();
      for (const e of bridge.project.events.slice(page * 64, page * 64 + 64)) {
        const version = bridge.project.banks.find(
            (b) => b.id === e.bankId,
          ).version,
          descriptor = session.registry.sample(e.bankId, version, e.sampleId),
          bank = session.registry.bank(e.bankId, version);
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.event = e.id;
        button.setAttribute("aria-controls", "is-editor");
        const note = {
          instrument: descriptor.instrumentId,
          pitch: descriptor.pitchId,
          articulation: descriptor.articulation,
        };
        const legacy = descriptor.instrumentId === "legacy-hat";
        button.textContent = `${legacy ? t.legacy : (instrumentNames[descriptor.instrumentId] ?? descriptor.instrumentId)} · ${bank.laras === "shared" ? t.shared : legacy ? t.legacy : bank.laras} · ${legacy ? "—" : padLabel(note)} · ${e.action === "strike" ? t.strike : t.damp} · ${(e.tick / PPQ).toFixed(6)}`;
        button.onclick = () => {
          selected = e.id;
          fill();
          if (!$("beat").disabled) $("beat").focus();
        };
        $("list").append(button);
      }
      if (!bridge.project.events.length) $("list").textContent = t.empty;
    }
    fill();
  }
  function fill() {
    const e = bridge?.project.events.find((e) => e.id === selected),
      busy = blocked(session.snapshot());
    for (const button of $("list").querySelectorAll("[data-event]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.event === selected),
      );
    $("selection").textContent = e
      ? ([...$("list").querySelectorAll("[data-event]")].find(
          (button) => button.dataset.event === selected,
        )?.textContent ?? text()[e.action === "strike" ? "strike" : "damp"])
      : text().selection;
    $("beat").disabled =
      $("velocity").disabled =
      $("apply").disabled =
      $("delete").disabled =
        !e || busy;
    if (e) {
      if (filledEvent !== e) {
        $("beat").value = e.tick / PPQ;
        $("velocity").value = e.velocity;
        filledEvent = e;
      }
      $("velocity").disabled = busy || e.action === "damp";
    }
  }
  const transact = (fn) =>
    act(() => {
      fn();
      lastProject = session.project;
      renderedProject = null;
      render();
    });
  compositionUI = compositionPanel({
    host: compositionHost,
    locale,
    session,
    transact,
    getBridge: () => bridge,
  });
  $("editor").onsubmit = (e) => {
    e.preventDefault();
    transact(() =>
      bridge.editEvent(selected, {
        tick: Math.round(Number($("beat").value) * PPQ),
        velocity: Number($("velocity").value),
      }),
    );
  };
  $("delete").onclick = async () => {
    await transact(() => bridge.deleteEvent(selected));
    if (!bridge.project.events.some((event) => event.id === selected)) {
      selected = null;
      const target = $("list").querySelector("button") ?? $("events");
      if (target === $("events")) target.tabIndex = -1;
      target.focus();
    }
  };
  for (const [action, other] of [
    ["undo", "redo"],
    ["redo", "undo"],
  ])
    $(action).onclick = async () => {
      await transact(() => bridge[action]());
      if ($(action).disabled && !$(other).disabled) $(other).focus();
    };
  $("previous").onclick = () => {
    page--;
    render();
  };
  $("next").onclick = () => {
    page++;
    render();
  };
  $("enable").onclick = (e) =>
    act(() => session.enable({ gesture: e.isTrusted }));
  $("play").onclick = () => act(() => session.replay());
  resumeButton.onclick = () => act(() => session.replay({ resume: true }));
  $("pause").onclick = () => act(() => session.pause());
  $("back").onclick = () => act(back);
  for (const [name, target] of Object.entries({
    export: "if-export",
    "pause-export": "if-pause-export",
    project: "if-project",
    open: "if-open",
    release: "if-release-wav",
    share: "if-share",
    "cancel-export": "if-cancel-export",
  }))
    $(name).onclick = () => fileAction(target);
  return {
    async enter() {
      const project = await session.prepareStudio();
      bridge = new InstrumentStudioBridge(project, session.registry, (p) =>
        session.importJSON(JSON.stringify(p)),
      );
      lastProject = session.project;
      lastLocale = null;
      page = 0;
      selected = null;
      render();
    },
    render,
    get project() {
      return bridge?.toFocus();
    },
  };
}
