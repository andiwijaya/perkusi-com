import "./style.css";
import { createStudioPlayback } from "../studio/playback.js";
import { initLivePads, LIVE_PAD_GROUPS } from "../studio/live-pads.js";
import { studioRoleNames } from "../studio/messages.js";
import { kendhangNotices } from "../studio/kendhang-pack.js";
import { bassNotices } from "../studio/bass-pack.js";
import { guitarNotices } from "../studio/guitar-pack.js";
import { createPadOwner } from "./owner.js";
import { padMessages } from "./page.js";

export function initPadStation() {
  const root = document.querySelector(".pad-station"),
    life = new AbortController();
  const { engine, playback } = createStudioPlayback({ arrangement: false });
  let disposed = false,
    state = "ready",
    locale;
  const status = (next) => {
    state = next;
    const p = root.querySelector("#ps-status");
    p.textContent = padMessages[locale || "id"][next];
    p.setAttribute("role", next === "error" ? "alert" : "status");
  };
  const owner = createPadOwner({ engine, playback, onStatus: status });
  const pads = initLivePads({
    root,
    playDrum: (pitch) => owner.play("drum", pitch),
    playInstrument: (family, pitch) => owner.play(family, pitch),
    locked: () => disposed,
    onError: () => status("error"),
    bilahAnywhere: true,
  });
  const listen = (target, event, fn) =>
    target.addEventListener(event, fn, { signal: life.signal });
  function localize() {
    locale = document.documentElement.lang === "en" ? "en" : "id";
    for (const el of root.querySelectorAll("[data-pad-copy]"))
      el.textContent = padMessages[locale][el.dataset.padCopy];
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
      recordingLicense: "CC BY 3.0",
      packageLicense: "Artistic 2.0",
      notice: "NOTICE",
      license: "CC0",
      provenance: "Provenance / SHA256",
      source: "FreePats — " + padMessages[locale].source,
    };
    for (const a of root.querySelectorAll("[data-pad-credit-key]"))
      a.textContent = names[a.dataset.padCreditKey];
    status(state);
  }
  for (const [family, notices] of Object.entries({
    kendhang: kendhangNotices,
    bass: bassNotices,
    guitar: guitarNotices,
  })) {
    const list = root.querySelector(`[data-pad-credits="${family}"]`);
    for (const [name, href] of Object.entries(notices)) {
      const li = document.createElement("li"),
        a = document.createElement("a");
      a.href = href;
      a.dataset.padCreditKey = name;
      li.append(a);
      list.append(li);
    }
  }
  listen(root.querySelector("#ps-stop"), "click", () => owner.stop());
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
    life.abort();
    pads.dispose();
    void owner.dispose().catch(() => {});
  }
  listen(window, "pagehide", dispose);
  localize();
  for (const el of root.querySelectorAll("button,input")) el.disabled = false;
  pads.update();
  root.dataset.ready = "true";
  if (import.meta.env.DEV) window.perkusiPads = { engine, owner, dispose };
  return dispose;
}
