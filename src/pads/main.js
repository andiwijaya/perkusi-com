import {
  slenthemPelogPack,
  slenthemSlendroPack,
  slenthemPelogLevel,
  slenthemSlendroLevel,
  slenthemNotices,
} from "./instruments/slenthem.js";
import { gongPack, gongLevel, gongNotices } from "./instruments/gong-ageng.js";
import {
  kempulPelogPack,
  kempulSlendroPack,
  kempulPelogLevel,
  kempulSlendroLevel,
  kempulNotices,
} from "./instruments/kempul.js";
import {
  demungPelogPack,
  demungSlendroPack,
  demungLevel,
  demungNotices,
} from "./instruments/demung.js";
import {
  bonangBarungPelogPack,
  bonangBarungSlendroPack,
  bonangBarungLevel,
  bonangBarungNotices,
} from "./instruments/bonang-barung.js";
import {
  saronBarungPelogPack,
  saronBarungSlendroPack,
  saronBarungLevel,
  saronBarungNotices,
} from "./instruments/saron-barung.js";
import {
  pekingPelogPack,
  pekingSlendroPack,
  pekingLevel,
  pekingNotices,
} from "./instruments/peking.js";
import "./style.css";
import { createStudioPlayback } from "../studio/playback.js";
import { initLivePads, LIVE_PAD_GROUPS } from "../studio/live-pads.js";
import { studioRoleNames } from "../studio/messages.js";
import { kendhangNotices } from "../studio/kendhang-pack.js";
import { bassNotices } from "../studio/bass-pack.js";
import { guitarNotices } from "../studio/guitar-pack.js";
import { createPadOwner } from "./owner.js";
import { padMessages } from "./page.js";
import { createExtraSampler } from "./extra-sampler.js";
import { createExtraLoading } from "./extra-loading.js";
import { createCoreLoading } from "./core-loading.js";
import { CORE_GROUPS, coreCopy, coreStatusText } from "./core-page.js";
import {
  kethukPack,
  kethukLevel,
  kethukNotices,
} from "./instruments/kethuk.js";
import {
  kempyangPack,
  kempyangLevel,
  kempyangNotices,
} from "./instruments/kempyang.js";
import {
  extraPadCopy,
  extraPadNotes,
  renderExtraButtons,
} from "./extra-page.js";
import {
  bonangPanerusPelogPack,
  bonangPanerusSlendroPack,
  bonangPanerusLevel,
  bonangPanerusNotices,
} from "./instruments/bonang-panerus.js";
import {
  kenongPelogPack,
  kenongSlendroPack,
  kenongLevel,
  kenongNotices,
} from "./instruments/kenong.js";

export function initPadStation() {
  const root = document.querySelector(".pad-station"),
    life = new AbortController();
  const { engine, playback } = createStudioPlayback({ arrangement: false });
  const samplers = {
    "slenthem-pelog": createExtraSampler(
      engine,
      slenthemPelogPack,
      slenthemPelogLevel,
      { releaseBudget: 4, maxOneShotSeconds: 25 },
    ),
    "slenthem-slendro": createExtraSampler(
      engine,
      slenthemSlendroPack,
      slenthemSlendroLevel,
      { releaseBudget: 4, maxOneShotSeconds: 25 },
    ),
    "gong-ageng": createExtraSampler(engine, gongPack, gongLevel, {
      releaseBudget: 4,
      maxOneShotSeconds: 25,
    }),
    "kempul-pelog": createExtraSampler(
      engine,
      kempulPelogPack,
      kempulPelogLevel,
      {
        releaseBudget: 4,
        maxOneShotSeconds: 20,
      },
    ),
    "kempul-slendro": createExtraSampler(
      engine,
      kempulSlendroPack,
      kempulSlendroLevel,
      { releaseBudget: 4, maxOneShotSeconds: 20 },
    ),
    "demung-pelog": createExtraSampler(engine, demungPelogPack, demungLevel, {
      releaseBudget: 4,
      maxOneShotSeconds: 15,
    }),
    "demung-slendro": createExtraSampler(
      engine,
      demungSlendroPack,
      demungLevel,
      { releaseBudget: 4, maxOneShotSeconds: 15 },
    ),
    "bonang-barung-pelog": createExtraSampler(
      engine,
      bonangBarungPelogPack,
      bonangBarungLevel,
      { releaseBudget: 4, maxOneShotSeconds: 15 },
    ),
    "bonang-barung-slendro": createExtraSampler(
      engine,
      bonangBarungSlendroPack,
      bonangBarungLevel,
      { releaseBudget: 4, maxOneShotSeconds: 15 },
    ),
    "saron-barung-pelog": createExtraSampler(
      engine,
      saronBarungPelogPack,
      saronBarungLevel,
      { releaseBudget: 4, maxOneShotSeconds: 20 },
    ),
    "saron-barung-slendro": createExtraSampler(
      engine,
      saronBarungSlendroPack,
      saronBarungLevel,
      { releaseBudget: 4, maxOneShotSeconds: 20 },
    ),
    "peking-pelog": createExtraSampler(engine, pekingPelogPack, pekingLevel, {
      releaseBudget: 4,
      maxOneShotSeconds: 15,
    }),
    "peking-slendro": createExtraSampler(
      engine,
      pekingSlendroPack,
      pekingLevel,
      { releaseBudget: 4, maxOneShotSeconds: 15 },
    ),
    "bonang-panerus-pelog": createExtraSampler(
      engine,
      bonangPanerusPelogPack,
      bonangPanerusLevel,
      { releaseBudget: 4, maxOneShotSeconds: 8 },
    ),
    "bonang-panerus-slendro": createExtraSampler(
      engine,
      bonangPanerusSlendroPack,
      bonangPanerusLevel,
      { releaseBudget: 4, maxOneShotSeconds: 8 },
    ),
    kethuk: createExtraSampler(engine, kethukPack, kethukLevel),
    kempyang: createExtraSampler(engine, kempyangPack, kempyangLevel),
    "kenong-pelog": createExtraSampler(engine, kenongPelogPack, kenongLevel, {
      releaseBudget: 4,
    }),
    "kenong-slendro": createExtraSampler(
      engine,
      kenongSlendroPack,
      kenongLevel,
      { releaseBudget: 4 },
    ),
  };
  let selected = "kethuk";
  let loading, core;
  const sustained = new Set([
    "slenthem-pelog",
    "slenthem-slendro",
    "gong-ageng",
    "kempul-pelog",
    "kempul-slendro",
    "bonang-panerus-pelog",
    "bonang-panerus-slendro",
    "peking-pelog",
    "peking-slendro",
    "saron-barung-pelog",
    "saron-barung-slendro",
    "bonang-barung-pelog",
    "bonang-barung-slendro",
    "demung-pelog",
    "demung-slendro",
  ]);
  const exclusive = new Set([
    "slenthem-pelog",
    "slenthem-slendro",
    "kempul-pelog",
    "kempul-slendro",
    "demung-pelog",
    "demung-slendro",
  ]);
  const extra = {
    play: (pitch) => {
      if (!loading?.isReady()) {
        loading?.invalidate();
        return;
      }
      return samplers[selected].play(pitch);
    },
    stop: () => {
      loading?.pause();
      Object.values(samplers).forEach((s) => s.stop());
    },
    dispose: () => Object.values(samplers).forEach((s) => s.dispose()),
  };
  let disposed = false,
    state = "preparing",
    locale;
  const status = (next) => {
    state = next;
    const p = root.querySelector("#ps-status");
    p.textContent = padMessages[locale || "id"][next];
    p.setAttribute("role", next === "error" ? "alert" : "status");
  };
  const canPlay = (family) =>
    family === "extra"
      ? core?.allReady() && loading?.isReady()
      : core?.isReady(family);
  const owner = createPadOwner({
    engine,
    playback,
    extra,
    onStatus: status,
    canPlay,
    stopSounds: () => {
      // Fence pending gestures and silence voices, leaving asset preparation
      // and its cancellation generations untouched. No transport runs here.
      ++engine.operation;
      Object.values(samplers).forEach((s) => s.silence());
      engine.clearVoices(true);
    },
  });
  const pads = initLivePads({
    root,
    playDrum: (pitch) => owner.play("drum", pitch),
    playInstrument: (family, pitch) => owner.play(family, pitch),
    locked: () => disposed,
    padLocked: ({ family }) => !canPlay(family),
    onError: () => status("error"),
    bilahAnywhere: true,
  });
  const listen = (target, event, fn) =>
    target.addEventListener(event, fn, { signal: life.signal });
  function renderLoading() {
    const view = loading.snapshot(),
      t = extraPadCopy[locale || "id"],
      area = root.querySelector("#ps-extra-loading"),
      retry = root.querySelector("#ps-extra-retry"),
      name = extraPadNotes[selected].option || extraPadNotes[selected].name;
    area.dataset.state = view.state;
    root.querySelector("#ps-extra-status").textContent = (
      t[view.state] || t.loading
    )
      .replace("{name}", name)
      .replace("{ready}", view.ready)
      .replace("{total}", view.total || extraPadNotes[selected].notes.length);
    retry.hidden = !["error", "paused"].includes(view.state);
    retry.textContent = view.state === "paused" ? t.continue : t.retry;
    if (!core?.allReady()) {
      area.dataset.state = "waiting";
      root.querySelector("#ps-extra-status").textContent =
        coreCopy[locale || "id"][
          core?.snapshot().failed.length ? "extraBlocked" : "extraWaiting"
        ];
      retry.hidden = true;
    }
    root
      .querySelector(".ps-extra-pads")
      .setAttribute("aria-busy", String(area.dataset.state === "loading"));
    pads.update();
  }
  loading = createExtraLoading(samplers, renderLoading);
  function renderCoreLoading() {
    const snapshot = core.snapshot(),
      language = locale || "id";
    for (const { family } of CORE_GROUPS) {
      const view = snapshot.groups[family],
        area = root.querySelector(`[data-core-loading="${family}"]`),
        retry = area.querySelector("button");
      area.dataset.state = view.state;
      area.querySelector("[data-core-status]").textContent = coreStatusText(
        language,
        family,
        view,
      );
      retry.hidden = !(
        view.state === "error" ||
        (snapshot.phase === "paused" &&
          !snapshot.failed.length &&
          family === "drum")
      );
      retry.textContent =
        coreCopy[language][view.state === "error" ? "retry" : "continue"];
    }
    root.dataset.coreReady = String(core.allReady());
    renderLoading();
  }
  core = createCoreLoading(
    {
      drum: engine.bank,
      bilah: playback.banks.instrument,
      kendhang: playback.banks.kendhang,
      bass: playback.banks.bass,
      guitar: playback.banks.guitar,
    },
    {
      ensureContext: () => engine.ensureContext(),
      currentContext: () => engine.context,
      onChange: renderCoreLoading,
      onReady: () => {
        if (state === "preparing") status("ready");
        prepareSelected();
      },
      onBlocked: () => loading.pause(),
    },
  );
  let observedContext;
  function contextChanged() {
    if (observedContext.state !== "running") {
      loading.invalidate();
      core.invalidate();
    }
  }
  function observeContext() {
    if (engine.context === observedContext) return;
    observedContext?.removeEventListener("statechange", contextChanged);
    observedContext = engine.context;
    observedContext?.addEventListener("statechange", contextChanged, {
      signal: life.signal,
    });
  }
  function prepareSelected() {
    if (!core.allReady()) {
      renderLoading();
      return;
    }
    const job = loading.prepare(selected);
    observeContext();
    void job;
  }
  function localize() {
    locale = document.documentElement.lang === "en" ? "en" : "id";
    for (const el of root.querySelectorAll("[data-pad-copy]"))
      el.textContent = padMessages[locale][el.dataset.padCopy];
    for (const el of root.querySelectorAll("[data-extra-copy]"))
      el.textContent = extraPadCopy[locale][el.dataset.extraCopy];
    const info = root.querySelector("#ps-bank-info");
    info.textContent = extraPadNotes[selected].info?.[locale] || "";
    info.hidden = !info.textContent;
    for (const el of root.querySelectorAll("[data-st-role]"))
      el.textContent = studioRoleNames[locale][Number(el.dataset.stRole)];
    for (const g of LIVE_PAD_GROUPS) {
      const group = root.querySelector(`[data-live-group="${g.family}"]`);
      group.setAttribute("aria-label", g[locale]);
      group.querySelector("h3").textContent = g[locale];
      for (const p of g.pitches)
        group
          .querySelector(`[data-live-pad="${g.family}:${p}"]`)
          .setAttribute("aria-label", `${g[locale]} ${p.toUpperCase()}`);
    }
    root
      .querySelector(".ps-controls")
      .setAttribute("aria-label", padMessages[locale].master);
    const names = {
      takSource: "TAK — " + padMessages[locale].source,
      thungSource: "THUNG — " + padMessages[locale].source,
      pelogSource: "Kethuk Pelog 6 - " + padMessages[locale].source,
      slendroSource: "Kethuk Slendro 2 - " + padMessages[locale].source,
      recordingLicense: "CC BY 3.0",
      packageLicense: "Artistic 2.0",
      notice: "NOTICE",
      license: "CC0",
      provenance: "Provenance / SHA256",
      source: "FreePats — " + padMessages[locale].source,
    };
    for (const a of root.querySelectorAll("[data-pad-credit-key]"))
      if (["pelogSource", "slendroSource"].includes(a.dataset.padCreditKey))
        a.textContent = `${a.closest("ul").dataset.padCredits} ${a.dataset.padCreditKey === "pelogSource" ? "Pelog 6" : a.closest("ul").dataset.padCredits === "kempyang" ? "Slendro 1" : "Slendro 2"} - ${padMessages[locale].source}`;
      else if (/^source\d+$/.test(a.dataset.padCreditKey))
        a.textContent = `${padMessages[locale].source} ${a.dataset.padCreditKey.slice(6)}`;
      else if (names[a.dataset.padCreditKey])
        a.textContent = names[a.dataset.padCreditKey];
    status(state);
    renderCoreLoading();
  }
  for (const [family, notices] of Object.entries({
    kendhang: kendhangNotices,
    bass: bassNotices,
    guitar: guitarNotices,
    kethuk: {
      ...kethukNotices,
      pelogPage: "https://freesound.org/people/Digitopia_CdM/sounds/261691/",
      slendroPage: "https://freesound.org/people/Digitopia_CdM/sounds/261685/",
    },
    kempyang: {
      ...kempyangNotices,
      page261984: "https://freesound.org/people/Digitopia_CdM/sounds/261984/",
      page261760: "https://freesound.org/people/Digitopia_CdM/sounds/261760/",
    },
    kenong: kenongNotices,
    peking: pekingNotices,
    "saron-barung": saronBarungNotices,
    "bonang-barung": bonangBarungNotices,
    demung: demungNotices,
    kempul: kempulNotices,
    slenthem: slenthemNotices,
    "gong-ageng": gongNotices,
    "bonang-panerus": bonangPanerusNotices,
  })) {
    const list = root.querySelector(`[data-pad-credits="${family}"]`);
    for (const [name, href] of Object.entries(notices)) {
      const li = document.createElement("li"),
        a = document.createElement("a");
      a.href = href;
      a.dataset.padCreditKey = name;
      a.textContent =
        name === "pelogPage"
          ? "Freesound 261691"
          : name === "slendroPage"
            ? "Freesound 261685"
            : name.startsWith("page")
              ? "Freesound " + name.slice(4)
              : name.startsWith("source")
                ? "Source " + name.slice(6)
                : name;
      li.append(a);
      list.append(li);
    }
  }
  listen(root.querySelector("#ps-stop"), "click", () => owner.stop());
  for (const retry of root.querySelectorAll("[data-core-retry]"))
    listen(retry, "click", () => {
      core.retry(retry.dataset.coreRetry);
      observeContext();
    });
  listen(root.querySelector("#ps-extra-instrument"), "change", (e) => {
    if (!Object.hasOwn(samplers, e.target.value) || e.target.value === selected)
      return;
    owner.stop();
    loading.pause();
    // Large banks replace extra caches; core banks are owned separately.
    if (exclusive.has(e.target.value))
      for (const sampler of Object.values(samplers)) sampler.unload();
    else if (sustained.has(selected)) samplers[selected].unload();
    selected = e.target.value;
    root.querySelector(".ps-extra-pads").innerHTML = renderExtraButtons(
      selected,
      true,
    );
    prepareSelected();
    localize();
  });
  listen(root.querySelector("#ps-extra-retry"), "click", prepareSelected);
  listen(root.querySelector("#ps-master"), "input", (e) => {
    owner.setMaster(Number(e.target.value));
    root.querySelector("#ps-volume").value =
      `${Math.round((Number(e.target.value) / 0.75) * 100)}%`;
  });
  listen(root.querySelector("#ps-mute"), "change", (e) =>
    owner.setMuted(e.target.checked),
  );
  listen(document, "perkusi:locale", localize);
  listen(document, "visibilitychange", () => {
    if (document.hidden) owner.stop();
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    loading.dispose();
    core.dispose();
    cancelAnimationFrame(firstFrame);
    cancelAnimationFrame(secondFrame);
    life.abort();
    pads.dispose();
    void owner.dispose().catch(() => {});
  }
  listen(window, "pagehide", dispose);
  localize();
  for (const el of root.querySelectorAll("button,input,select"))
    el.disabled = false;
  // Controls become usable immediately; pads must remain disabled during the
  // two-frame opportunity to paint before any audio request is admitted.
  pads.update();
  let secondFrame;
  const firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(() => {
      if (disposed) return;
      core.start();
      observeContext();
    });
  });
  root.dataset.ready = "true";
  if (import.meta.env.DEV)
    window.perkusiPads = { engine, owner, extra, core, dispose };
  return dispose;
}
