import { STUDIO_ROLES } from "../project/studio-model.js";
import { KENDHANG_STROKES } from "../project/kendhang.js";
import { BASS_PITCHES } from "../project/bass.js";
import { GUITAR_PITCHES } from "../project/guitar.js";
import { PITCHES } from "../project/composition-model.js";

export const LIVE_PAD_GROUPS = [
  {
    family: "bilah",
    id: "Bilah",
    en: "Bilah",
    pitches: PITCHES,
    keys: ["z", "x", "c", "v", "b"],
  },
  {
    family: "kendhang",
    id: "Kendhang Ciblon",
    en: "Kendhang Ciblon",
    pitches: KENDHANG_STROKES,
    keys: ["a", "s"],
  },
  {
    family: "bass",
    id: "Bass elektrik",
    en: "Electric bass",
    pitches: BASS_PITCHES,
    keys: ["d", "f", "g"],
  },
  {
    family: "guitar",
    id: "Gitar nylon",
    en: "Nylon guitar",
    pitches: GUITAR_PITCHES,
    keys: ["h", "j", "k"],
  },
];
export function renderInstrumentPads(locale) {
  return `<div class="st-instrument-pads">${LIVE_PAD_GROUPS.map((g) => `<section class="st-live-group" data-live-group="${g.family}" style="--pad-columns:${g.pitches.length}" aria-label="${g[locale]}"><h3>${g[locale]}</h3><div class="st-pads">${g.pitches.map((pitch, i) => `<button type="button" class="st-pad" data-live-pad="${g.family}:${pitch}" aria-label="${g[locale]} ${pitch.toUpperCase()}" aria-keyshortcuts="${g.keys[i].toUpperCase()}"><b aria-hidden="true">${g.keys[i].toUpperCase()}</b><span>${pitch.toUpperCase()}</span></button>`).join("")}</div></section>`).join("")}</div>`;
}
export function shortcutAction(
  event,
  { locked = false, dialogOpen = false, insidePads = false } = {},
) {
  if (
    locked ||
    dialogOpen ||
    event.defaultPrevented ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    event.target?.isContentEditable ||
    event.target?.closest?.(
      "input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox]",
    )
  )
    return null;
  const key = event.key.toLowerCase();
  if (/^[1-8]$/.test(key))
    return { family: "drum", pitch: STUDIO_ROLES[Number(key) - 1] };
  for (const g of LIVE_PAD_GROUPS) {
    if (g.family === "bilah" && !insidePads) continue;
    const i = g.keys.indexOf(key);
    if (i >= 0) return { family: g.family, pitch: g.pitches[i] };
  }
  return null;
}
export function initLivePads({
  root,
  playDrum,
  playInstrument,
  locked,
  onError,
}) {
  const panel = root.querySelector(".st-live-pads"),
    doc = root.ownerDocument,
    win = doc.defaultView,
    life = new AbortController(),
    pointers = new Map(),
    keys = new Map(),
    pending = new Map();
  let disposed = false;
  const listen = (target, type, fn, capture = false) =>
    target.addEventListener(type, fn, { signal: life.signal, capture });
  const pad = (target) => {
    const b = target?.closest?.("button.st-pad");
    return b && panel.contains(b) ? b : null;
  };
  const blocked = () =>
    disposed ||
    locked() ||
    !!doc.querySelector('dialog[open],[role="dialog"][aria-modal="true"]');
  const action = (b) =>
    b.dataset.stPad
      ? { family: "drum", pitch: b.dataset.stPad }
      : {
          family: b.dataset.livePad.split(":")[0],
          pitch: b.dataset.livePad.split(":")[1],
        };
  function refreshPressed(b) {
    b.classList.toggle(
      "st-pressed",
      [...pointers.values(), ...keys.values()].includes(b),
    );
  }
  function clearPressed() {
    const held = new Set([...pointers.values(), ...keys.values()]);
    pointers.clear();
    keys.clear();
    for (const b of held) b.classList.remove("st-pressed");
  }
  function fire(b) {
    if (blocked() || b.disabled) return;
    const a = action(b);
    pending.set(b, (pending.get(b) || 0) + 1);
    b.setAttribute("aria-busy", "true");
    let job;
    try {
      job =
        a.family === "drum"
          ? playDrum(a.pitch)
          : playInstrument(a.family, a.pitch);
    } catch (e) {
      job = Promise.reject(e);
    }
    void Promise.resolve(job)
      .catch((e) => {
        if (!disposed) onError(e);
      })
      .finally(() => {
        if (disposed) return;
        const n = (pending.get(b) || 1) - 1;
        if (n) pending.set(b, n);
        else {
          pending.delete(b);
          b.removeAttribute("aria-busy");
        }
      });
  }
  listen(panel, "pointerdown", (e) => {
    const b = pad(e.target);
    if (
      !b ||
      e.button !== 0 ||
      blocked() ||
      b.disabled ||
      pointers.has(e.pointerId)
    )
      return;
    pointers.set(e.pointerId, b);
    refreshPressed(b);
    b.focus({ preventScroll: true });
    try {
      b.setPointerCapture(e.pointerId);
    } catch {
      /* Synthetic probes may not own a native pointer. */
    }
    fire(b);
  });
  const release = (e) => {
    const b = pointers.get(e.pointerId);
    if (b) {
      pointers.delete(e.pointerId);
      refreshPressed(b);
    }
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    listen(panel, type, release);
  listen(panel, "click", (e) => {
    const b = pad(e.target);
    if (!b) return;
    if (e.detail > 0 || e.pointerType) return;
    fire(b);
  });
  listen(
    doc,
    "keydown",
    (e) => {
      const b = pad(e.target),
        activation = b && (e.key === "Enter" || e.code === "Space"),
        name = e.code || e.key;
      if (activation) {
        e.preventDefault();
        if (
          blocked() ||
          b.disabled ||
          e.repeat ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey ||
          e.shiftKey ||
          keys.has(name)
        )
          return;
        keys.set(name, b);
        refreshPressed(b);
        fire(b);
        return;
      }
      const a = shortcutAction(e, { locked: blocked(), insidePads: !!b });
      if (!a) return;
      e.preventDefault();
      if (keys.has(name)) return;
      const button =
        a.family === "drum"
          ? panel.querySelector(`[data-st-pad="${a.pitch}"]`)
          : panel.querySelector(`[data-live-pad="${a.family}:${a.pitch}"]`);
      if (!button || button.disabled) return;
      keys.set(name, button);
      refreshPressed(button);
      fire(button);
    },
    true,
  );
  listen(
    doc,
    "keyup",
    (e) => {
      const name = e.code || e.key,
        b = keys.get(name);
      if (b) {
        e.preventDefault();
        keys.delete(name);
        refreshPressed(b);
      }
    },
    true,
  );
  listen(win, "blur", clearPressed);
  listen(doc, "visibilitychange", () => {
    if (doc.hidden) clearPressed();
  });
  return {
    update() {
      for (const b of panel.querySelectorAll("button.st-pad"))
        b.disabled = blocked();
      if (blocked()) clearPressed();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      life.abort();
      clearPressed();
      for (const b of pending.keys()) b.removeAttribute("aria-busy");
      pending.clear();
    },
  };
}
