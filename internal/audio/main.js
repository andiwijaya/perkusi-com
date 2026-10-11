import "./style.css";
import { AudioEngine } from "../../src/audio/engine.js";
import { renderLoopBank } from "../../src/audio/render-qa.js";
import {
  createLoopVoice,
  fadeOutVoice,
  cancelFade,
  disconnectVoice,
} from "../../src/audio/voice.js";
import {
  resolveLocale,
  readLocale,
  saveLocale,
} from "../../src/i18n/locale.js";
import { navigationHref } from "../../src/app/routes.js";
import { fixturePack } from "./pack.js";
import { prototypeMessages } from "./messages.js";

const engine = new AudioEngine(fixturePack);
// Engineering-only hook; this module is absent from the normal production build.
window.perkusiAudioPrototype = engine;
window.perkusiAudioQA = {
  voice: { createLoopVoice, fadeOutVoice, cancelFade, disconnectVoice },
  render: (seconds) => renderLoopBank(engine.bank, engine.volume, seconds),
};
let stored;
try {
  stored = readLocale(localStorage);
} catch {
  /* Optional storage. */
}
let locale = resolveLocale({
  explicitLocale: new URL(location.href).searchParams.get("lang"),
  storedLocale: stored,
});
const initialUrl = new URL(location.href);
initialUrl.searchParams.set("lang", locale);
history.replaceState(
  { ...history.state, perkusiLocale: locale },
  "",
  initialUrl.pathname + initialUrl.search + initialUrl.hash,
);
const stems = document.querySelector("#stems");
for (const stem of fixturePack.stems) {
  const section = document.createElement("section");
  section.innerHTML = `<h2 data-copy="${stem.id}"></h2><button type="button" data-stem="${stem.id}" aria-pressed="true"></button><p data-stem-status="${stem.id}"></p><button type="button" data-retry="${stem.id}" data-copy="retry" hidden></button>`;
  stems.append(section);
}
function render() {
  const copy = prototypeMessages[locale];
  const state = engine.snapshot();
  document.documentElement.lang = locale;
  document.title = copy.title;
  document.querySelectorAll("[data-copy]").forEach((el) => {
    el.textContent = copy[el.dataset.copy];
  });
  document
    .querySelector(".prototype-language")
    .setAttribute("aria-label", copy.language);
  document
    .querySelectorAll("[data-locale]")
    .forEach((el) =>
      el.setAttribute("aria-pressed", String(el.dataset.locale === locale)),
    );
  document.querySelector("#home").href = navigationHref("home", locale);
  document.querySelector("#status").textContent =
    copy[state.status] || copy.error;
  for (const [id, stem] of Object.entries(state.stems)) {
    const button = document.querySelector(`[data-stem="${id}"]`);
    button.textContent = copy[id];
    button.setAttribute("aria-pressed", String(stem.enabled));
    button.disabled = state.status === "disposed";
    document.querySelector(`[data-stem-status="${id}"]`).textContent =
      stem.state === "error"
        ? copy.assetError
        : stem.state === "loading"
          ? copy.loading
          : stem.pendingAt !== null
            ? copy.pending
            : stem.active
              ? copy.active
              : copy.off;
    document.querySelector(`[data-retry="${id}"]`).hidden =
      stem.state !== "error";
  }
  document.querySelector("#play").disabled = [
    "playing",
    "loading",
    "disposed",
  ].includes(state.status);
  for (const id of ["pause", "reset", "suspend", "dispose", "volume"])
    document.querySelector("#" + id).disabled = engine.disposed;
  document.querySelector("#diagnostics").textContent = JSON.stringify(
    { ...state, events: state.events.slice(-8) },
    null,
    2,
  );
}
async function run(action) {
  try {
    const pending = action();
    render();
    await pending;
  } catch {
    document.querySelector("#status").textContent =
      prototypeMessages[locale].error;
  }
  render();
}
document
  .querySelector("#play")
  .addEventListener("click", () => run(() => engine.play()));
document.querySelector("#pause").addEventListener("click", () => {
  engine.pause();
  render();
});
document.querySelector("#reset").addEventListener("click", () => {
  engine.reset();
  render();
});
document
  .querySelector("#suspend")
  .addEventListener("click", () => run(() => engine.suspend()));
document
  .querySelector("#dispose")
  .addEventListener("click", () => run(() => engine.dispose()));
document
  .querySelector("#volume")
  .addEventListener("input", (event) =>
    engine.setVolume(Number(event.target.value)),
  );
document.querySelectorAll("[data-stem]").forEach((el) =>
  el.addEventListener("click", () => {
    engine.setLayer(el.dataset.stem, !engine.enabled.get(el.dataset.stem));
    render();
  }),
);
document
  .querySelectorAll("[data-retry]")
  .forEach((el) =>
    el.addEventListener("click", () =>
      run(() => engine.retry(el.dataset.retry)),
    ),
  );
document.querySelectorAll("[data-locale]").forEach((el) =>
  el.addEventListener("click", () => {
    locale = el.dataset.locale;
    try {
      saveLocale(localStorage, locale);
    } catch {
      /* Optional storage. */
    }
    const url = new URL(location.href);
    url.searchParams.set("lang", locale);
    history.pushState(
      { perkusiLocale: locale },
      "",
      url.pathname + url.search + url.hash,
    );
    render();
  }),
);
window.addEventListener("popstate", () => {
  locale = resolveLocale({
    explicitLocale: new URL(location.href).searchParams.get("lang"),
    storedLocale: locale,
  });
  render();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && engine.transport.running) run(() => engine.suspend());
});
const visualTimer = setInterval(render, 200); // Diagnostics only; never schedules audio.
window.addEventListener(
  "pagehide",
  () => {
    clearInterval(visualTimer);
    engine.dispose();
  },
  { once: true },
);
render();
