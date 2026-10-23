import {
  CLIP_ROLES,
  PITCHES,
  editCompositionClip,
  newCompositionClip,
  patternClips,
  compositionClips,
} from "../project/composition-model.js";
import { initKendhangPanel } from "./kendhang-panel.js";
import { initBassPanel } from "./bass-panel.js";
import { initGuitarPanel } from "./guitar-panel.js";
const copy = {
  id: {
    title: "Loop pola & Bilah",
    help: "Ketuk nada untuk memilih, lalu isi 16 langkah di bawahnya. Loop Beatbox berulang dalam frasa 2 bar, selalu 96 BPM. Pilih rantai 2/4/6/8 bar untuk frasa lengkap; WAV memuat satu putaran rantai. Perubahan pilihan suara menjeda musik; ketuk Mainkan untuk melanjutkan.",
    identity:
      "Nusantara Fusion: perkusi tangan dan warna metal sintetis orisinal, terinspirasi musik Indonesia masa kini. Bilah adalah sampler metal bernada D minor. Bukan rekaman tradisional atau klaim laras gamelan autentik.",
    notes: "Nada",
    scope:
      "Loop untuk pola {pattern}. Aktif, variasi dan mix disimpan pada pola ini. Perubahan kontrol loop menjeda pemutaran; tekan Putar lagi. Kosongkan pola juga menghapus loop pola tersebut.",
    volume: "Volume",
    pan: "Pan",
    mute: "Bisukan",
    solo: "Solo",
    enabled: "Aktif",
    variant: "Variasi",
    loop: "Loop Beatbox",
    tempo:
      "Aktifkan loop dan ubah tempo ke 96 BPM? Nada dan step tetap tersimpan.",
    fusion: "Nusantara Fusion",
    malam: "Malam Bilah",
    bumi: "Bumi dan Tangan",
    step: "Langkah",
    velocity: "Kekuatan nada",
    clipTempo: "Loop Beatbox harus 96 BPM.",
    needsConversion: "Gunakan Buka di Beatbox untuk memilih salinan turunan.",
    legacyOriginal:
      "Proyek lama tetap disimpan. Simpan salinan V3 untuk mengubahnya.",
  },
  en: {
    title: "Pattern loops & Bilah",
    help: "Pick a note, then fill the 16 steps below. Beatbox loops repeat in two-bar phrases, always at 96 BPM. Choose a 2/4/6/8-bar chain for complete phrases; WAV contains one chain pass. Changing sound selections pauses the music; press Play to continue.",
    identity:
      "Nusantara Fusion: original synthetic hand percussion and metallic colors, inspired by contemporary Indonesian music. Bilah is a D minor struck-metal sampler. These are not traditional recordings or an authentic gamelan tuning claim.",
    notes: "Notes",
    scope:
      "Loops for pattern {pattern}. Enabled, variation and mix belong to this pattern. Editing loop controls pauses playback; press Play again. Clear pattern also clears its loops.",
    volume: "Volume",
    pan: "Pan",
    mute: "Mute",
    solo: "Solo",
    enabled: "Enabled",
    variant: "Variation",
    loop: "Beatbox loop",
    tempo:
      "Enable the loop and change tempo to 96 BPM? Your notes and steps are kept.",
    fusion: "Nusantara Fusion",
    malam: "Night Metal",
    bumi: "Bumi & Handbeat",
    step: "Step",
    velocity: "Note strength",
    clipTempo: "Beatbox loops require 96 BPM.",
    needsConversion: "Use Open in Beatbox to choose a derived copy.",
    legacyOriginal: "The old original is kept. Save a V3 copy to edit it.",
  },
};
export const compositionMessages = copy;
export function initCompositionPanel({
  root,
  current,
  edit,
  engine,
  locked,
  kendhangNotices,
  bassNotices,
  guitarNotices,
}) {
  const panel = document.createElement("section");
  panel.className = "composition-panel st-panel";
  panel.innerHTML = `<h2 data-v3-copy="title"></h2><p data-v3-copy="help"></p><p data-v3-copy="identity"></p><div class="v3-note-picks"></div><label><span data-v3-copy="velocity"></span><input id="v3-velocity" type="range" min="0.1" max="1" step="0.1" value="0.7"></label><div class="v3-note-grid" role="group"></div><div class="v3-instrument-mix"></div><p data-v3-scope></p><div class="v3-clips"></div>`;
  root.querySelector(".st-grid-scroll").after(panel);
  const life = new AbortController();
  let pitch = "d4";
  const locale = () => (document.documentElement.lang === "en" ? "en" : "id");
  const listen = (el, event, fn) =>
    el.addEventListener(event, fn, { signal: life.signal });
  const button = (label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    listen(b, "click", () => {
      if (!locked()) fn();
    });
    return b;
  };
  const picks = panel.querySelector(".v3-note-picks"),
    grid = panel.querySelector(".v3-note-grid");
  for (const name of PITCHES) {
    const b = button(name.toUpperCase(), () => {
      pitch = name;
      void engine.composition.pad(name).catch(() => {
        engine.error = "audio-start";
      });
      update();
    });
    b.dataset.v3Pitch = name;
    picks.append(b);
  }
  for (let i = 0; i < 16; i++) {
    const b = button(String(i + 1), () =>
      edit((p) => {
        const a = p.patterns.find((a) => a.id === p.activePattern);
        a.notes[i] =
          a.notes[i]?.pitch === pitch
            ? null
            : {
                pitch,
                velocity: Number(panel.querySelector("#v3-velocity").value),
              };
      }),
    );
    b.dataset.v3Step = i;
    grid.append(b);
  }
  function controls(container, identity, isClip) {
    const row = document.createElement("div");
    row.className = "v3-mix";
    row.dataset.v3Mix = identity;
    const name = document.createElement("strong");
    name.textContent = isClip ? identity : "Bilah";
    name.dataset.v3Name = identity;
    row.append(name);
    const fields = isClip
      ? ["enabled", "variant", "volume", "pan", "mute", "solo"]
      : ["volume", "pan", "mute", "solo"];
    for (const field of fields) {
      const label = document.createElement("label"),
        span = document.createElement("span");
      span.dataset.v3Copy = field;
      let input;
      if (field === "variant") {
        input = document.createElement("select");
        input.append(new Option("A", "1"), new Option("B", "2"));
      } else {
        input = document.createElement("input");
        input.type = ["volume", "pan"].includes(field) ? "range" : "checkbox";
        if (input.type === "range") {
          input.min = field === "pan" ? "-1" : "0";
          input.max = "1";
          input.step = ".05";
        }
      }
      input.dataset.v3Field = field;
      label.append(span, input);
      row.append(label);
      listen(input, input.type === "range" ? "input" : "change", () => {
        if (locked()) {
          update();
          return;
        }
        if (
          field === "enabled" &&
          input.checked &&
          current().timing.bpm !== 96 &&
          !window.confirm(copy[locale()].tempo)
        ) {
          update();
          return;
        }
        const value =
          input.type === "checkbox" ? input.checked : Number(input.value);
        edit((p) => {
          if (isClip) editCompositionClip(p, identity, field, value);
          else p.instrument[field] = value;
        });
        // edit() catches validation failures; always restore controls from its actual score.
        update();
      });
    }
    container.append(row);
  }
  controls(panel.querySelector(".v3-instrument-mix"), "bilah", false);
  const kendhang = initKendhangPanel({
    after: panel.querySelector(".v3-instrument-mix"),
    current,
    edit,
    engine,
    locked,
    notices: kendhangNotices,
  });
  const bass = initBassPanel({
    after: panel.querySelector(".kendhang-section"),
    current,
    edit,
    engine,
    locked,
    notices: bassNotices,
  });
  const guitar = initGuitarPanel({
    after: panel.querySelector(".bass-section"),
    current,
    edit,
    engine,
    locked,
    notices: guitarNotices,
  });
  for (const role of CLIP_ROLES)
    controls(panel.querySelector(".v3-clips"), role, true);
  function update() {
    kendhang.update();
    bass.update();
    guitar.update();
    const p = current(),
      c = copy[locale()];
    panel
      .querySelectorAll("[data-v3-copy]")
      .forEach((el) => (el.textContent = c[el.dataset.v3Copy]));
    const a = p.patterns.find((a) => a.id === p.activePattern);
    panel.querySelector("[data-v3-scope]").textContent = c.scope.replace(
      "{pattern}",
      a.name,
    );
    grid.setAttribute("aria-label", c.notes);
    for (const b of grid.children) {
      const i = Number(b.dataset.v3Step),
        n = a.notes[i];
      b.textContent = n ? n.pitch.toUpperCase() : i + 1;
      b.setAttribute("aria-pressed", String(!!n));
      b.setAttribute(
        "aria-label",
        `${c.notes} · ${c.step} ${i + 1} · ${n ? n.pitch.toUpperCase() : "—"}`,
      );
      b.disabled = locked();
    }
    for (const b of picks.children) {
      b.setAttribute("aria-pressed", String(b.dataset.v3Pitch === pitch));
      b.disabled = locked();
    }
    const names =
      locale() === "id"
        ? [
            "Bumi · kick",
            "Sabet · snare",
            "Cicik · hi-hat",
            "Dum · bass vokal",
            "Luma · dengung",
            "Tara · perkusi",
          ]
        : [
            "Bumi · kick",
            "Sabet · snare",
            "Cicik · hi-hat",
            "Dum · vocal bass",
            "Luma · hum",
            "Tara · percussion",
          ];
    for (const row of panel.querySelectorAll("[data-v3-mix]")) {
      const label =
        row.dataset.v3Mix === "bilah"
          ? "Bilah"
          : names[CLIP_ROLES.indexOf(row.dataset.v3Mix)];
      row.querySelector("strong").textContent = label;
      const t =
        row.dataset.v3Mix === "bilah"
          ? p.instrument
          : patternClips(p).find((c) => c.role === row.dataset.v3Mix) ||
            newCompositionClip(row.dataset.v3Mix);
      for (const input of row.querySelectorAll("[data-v3-field]")) {
        const field = input.dataset.v3Field;
        input.type === "checkbox"
          ? (input.checked = t[field])
          : (input.value = t[field]);
        input.setAttribute("aria-label", `${label} · ${c[field]}`);
        input.disabled = locked();
      }
    }
    root.querySelector("#st-bpm").disabled =
      locked() || compositionClips(p).some((c) => c.enabled);
  }
  listen(document, "keydown", (event) => {
    if (
      event.defaultPrevented ||
      event.target.closest(".st-live-pads") ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.repeat ||
      event.target.closest("input,textarea,select,[contenteditable=true]") ||
      document.querySelector("dialog[open]") ||
      locked()
    )
      return;
    const i = ["z", "x", "c", "v", "b"].indexOf(event.key.toLowerCase());
    if (i >= 0) {
      event.preventDefault();
      pitch = PITCHES[i];
      void engine.composition.pad(pitch).catch(() => {
        engine.error = "audio-start";
      });
      update();
    }
  });
  return {
    update,
    dispose() {
      kendhang.dispose();
      bass.dispose();
      guitar.dispose();
      life.abort();
      panel.remove();
    },
  };
}
