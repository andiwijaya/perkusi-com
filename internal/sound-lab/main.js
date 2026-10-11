import "./style.css";
import { AudioEngine } from "../../src/audio/engine.js";
import { createPackFromCatalog } from "../../src/audio/pack-catalog.js";
import { renderLoopBank } from "../../src/audio/render-qa.js";
import {
  characterDefinitions,
  characterSvg,
} from "../../src/characters/characters.js";
import {
  resolveLocale,
  readLocale,
  saveLocale,
} from "../../src/i18n/locale.js";
import { navigationHref } from "../../src/app/routes.js";
import manifest from "../original-groove/manifest.json";
import { labMessages } from "./messages.js";

const urls = import.meta.glob("../original-groove/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});
const selection = { ...manifest.initialSelection };
const pack = () =>
  createPackFromCatalog(
    manifest,
    selection,
    (path) => urls[`../original-groove/${path}`],
  );
let engine = new AudioEngine(pack()),
  preview = "auto",
  changing = false,
  frame;
let stored;
try {
  stored = readLocale(localStorage);
} catch {
  /* Storage is optional. */
}
let locale = resolveLocale({
  explicitLocale: new URL(location.href).searchParams.get("lang"),
  storedLocale: stored,
});
const cast = document.querySelector("#cast");
for (const c of characterDefinitions) {
  const section = document.createElement("section");
  section.className = "role-card";
  section.innerHTML = `<button class="character" type="button" data-role="${c.role}" aria-pressed="true">${characterSvg(c.role)}<span class="character-name">${c.name}</span><span class="character-role"></span></button><label><span data-copy="variant"></span><select data-variant="${c.role}" aria-label="${c.name}"><option value="1">A</option><option value="2">B</option></select></label><p data-status="${c.role}"></p><button type="button" data-retry="${c.role}" data-copy="retry" hidden></button>`;
  cast.append(section);
}
for (const state of [
  "auto",
  "idle",
  "active",
  "selected",
  "focus",
  "loading",
  "error",
]) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.preview = state;
  button.dataset.copy = state;
  button.addEventListener("click", () => {
    preview = state;
    render();
  });
  document.querySelector("#states").append(button);
}
function syncLocale(push = false) {
  const url = new URL(location.href);
  url.searchParams.set("lang", locale);
  history[push ? "pushState" : "replaceState"](
    { ...history.state, perkusiLocale: locale },
    "",
    url.pathname + url.search + url.hash,
  );
}
function render() {
  const copy = labMessages[locale],
    state = engine.snapshot();
  document.documentElement.lang = locale;
  document.title = `Perkusi — ${copy.title}`;
  document.querySelectorAll("[data-copy]").forEach((el) => {
    el.textContent = copy[el.dataset.copy];
  });
  document
    .querySelector(".languages")
    .setAttribute("aria-label", copy.language);
  document.querySelector("#home").href = navigationHref("home", locale);
  document
    .querySelectorAll("[data-locale]")
    .forEach((el) =>
      el.setAttribute("aria-pressed", String(el.dataset.locale === locale)),
    );
  document
    .querySelectorAll("[data-preview]")
    .forEach((el) =>
      el.setAttribute("aria-pressed", String(el.dataset.preview === preview)),
    );
  document.querySelector("#status").textContent =
    copy[state.status] || copy.error;
  document.querySelector("#play").disabled =
    changing || ["playing", "loading", "disposed"].includes(state.status);
  for (const [role, item] of Object.entries(state.stems)) {
    const button = document.querySelector(`[data-role="${role}"]`);
    const visualState =
      item.state === "loading"
        ? "loading"
        : item.state === "error"
          ? "error"
          : item.active
            ? "active"
            : "idle";
    button.dataset.state = preview === "auto" ? visualState : preview;
    button.dataset.selected = String(preview === "selected" || item.enabled);
    button.dataset.focusPreview = String(preview === "focus");
    button.setAttribute("aria-pressed", String(item.enabled));
    button.querySelector(".character-role").textContent = copy.states[role];
    button.setAttribute(
      "aria-label",
      `${characterDefinitions.find((c) => c.role === role).name} — ${copy.states[role]}`,
    );
    const select = document.querySelector(`[data-variant="${role}"]`);
    select.value = String(selection[role]);
    select.disabled =
      changing || state.status === "loading" || state.status === "playing";
    document.querySelector(`[data-status="${role}"]`).textContent =
      item.state === "error"
        ? copy.assetError
        : item.pendingAt !== null
          ? copy.pending
          : copy[visualState === "idle" ? "off" : visualState];
    document.querySelector(`[data-retry="${role}"]`).hidden =
      item.state !== "error";
    button.disabled = changing || engine.disposed;
  }
  document.querySelector("#diagnostics").textContent = JSON.stringify(
    {
      selection,
      ...state,
      events: state.events.slice(-8),
      listening: "UNVERIFIED",
    },
    null,
    2,
  );
}
async function run(action) {
  try {
    const result = action();
    render();
    await result;
  } catch {
    document.querySelector("#status").textContent = labMessages[locale].error;
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
  .querySelector("#volume")
  .addEventListener("input", (event) =>
    engine.setVolume(Number(event.target.value)),
  );
document.querySelectorAll("[data-role]").forEach((el) =>
  el.addEventListener("click", () => {
    engine.setLayer(el.dataset.role, !engine.enabled.get(el.dataset.role));
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
document.querySelectorAll("[data-variant]").forEach((el) =>
  el.addEventListener("change", async () => {
    if (changing || engine.transport.running) return;
    changing = true;
    const previous = engine,
      enabled = new Map(engine.enabled),
      volume = engine.volume;
    selection[el.dataset.variant] = Number(el.value);
    render();
    await previous.dispose();
    engine = new AudioEngine(pack());
    engine.setVolume(volume);
    for (const [role, value] of enabled) engine.setLayer(role, value);
    changing = false;
    render();
  }),
);
document.querySelectorAll("[data-locale]").forEach((el) =>
  el.addEventListener("click", () => {
    locale = el.dataset.locale;
    try {
      saveLocale(localStorage, locale);
    } catch {
      /* Optional. */
    }
    syncLocale(true);
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
let lastRender = 0;
function animate(time) {
  const beat = engine.transport.beatsAt(engine.context?.currentTime || 0);
  // This frame clock reads audio phase for visuals only; it never schedules sound.
  for (const el of document.querySelectorAll(".character"))
    el.style.setProperty("--pulse", String(Math.max(0, 1 - (beat % 1) * 4)));
  if (time - lastRender > 160) {
    render();
    lastRender = time;
  }
  frame = requestAnimationFrame(animate);
}
window.addEventListener(
  "pagehide",
  () => {
    cancelAnimationFrame(frame);
    engine.dispose();
  },
  { once: true },
);
window.perkusiSoundLab = {
  get engine() {
    return engine;
  },
  manifest,
  selection,
  createPack: pack,
  render: (seconds) => renderLoopBank(engine.bank, engine.volume, seconds),
  dispose: () => engine.dispose(),
};
syncLocale();
render();
frame = requestAnimationFrame(animate);
