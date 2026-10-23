import { GUITAR_PITCHES, GUITAR_CREDITS } from "../project/guitar.js";
const copy = {
  id: {
    title: "Gitar nylon - 3 nada",
    scope:
      "Nada gitar untuk pola {pattern}. Pilih B2/E3/G3, lalu isi 16 langkah. Sampel pendek 1,8 detik; nada berbeda boleh berdering bersama; nada sama meredam petikan sebelumnya. Mengubah langkah menjeda musik. Kosongkan pola juga menghapus nada gitar.",
    velocity: "Kekuatan nada gitar",
    step: "Langkah",
    mix: "Mix gitar — seluruh proyek",
    volume: "Volume",
    pan: "Pan",
    mute: "Bisukan",
    solo: "Solo",
    credits: "Sumber & lisensi gitar",
    license: "Lisensi CC0",
    provenance: "Asal, perubahan & hash sampel",
    source: "Sumber FreePats — Nylon Guitar",
  },
  en: {
    title: "Nylon guitar - 3 notes",
    scope:
      "Guitar notes for pattern {pattern}. Pick B2/E3/G3, then fill the 16 steps. Short 1.8-second samples; different pitches ring together; repeating the same pitch fades its previous pluck. Editing steps pauses playback. Clear pattern also clears its guitar notes.",
    velocity: "Guitar note strength",
    step: "Step",
    mix: "Guitar mix — whole project",
    volume: "Volume",
    pan: "Pan",
    mute: "Mute",
    solo: "Solo",
    credits: "Guitar sources & license",
    license: "CC0 license",
    provenance: "Source, changes & sample hashes",
    source: "FreePats source — Nylon Guitar",
  },
};
export function initGuitarPanel({
  after,
  current,
  edit,
  engine,
  locked,
  notices,
}) {
  const section = document.createElement("section"),
    life = new AbortController();
  let pitch = "b2";
  section.className = "guitar-section kendhang-section";
  section.innerHTML = `<h3 data-g-copy="title"></h3><p data-g-scope></p><div class="v3-note-picks" data-g-picks></div><label><span data-g-copy="velocity"></span><input data-g-velocity type="range" min="0.1" max="1" step="0.1" value="0.7"></label><div class="v3-note-grid" data-g-grid role="group"></div><p data-g-copy="mix"></p><div class="v3-mix" data-g-mix></div><details><summary data-g-copy="credits"></summary><p data-g-credits></p><ul data-g-links></ul></details>`;
  after.after(section);
  const on = (el, event, fn) =>
    el.addEventListener(event, fn, { signal: life.signal });
  for (const id of GUITAR_PITCHES) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.guitarPitch = id;
    b.textContent = id.toUpperCase();
    on(b, "click", () => {
      if (locked()) return;
      pitch = id;
      void engine.composition.pad(id, "guitar").catch(() => {
        engine.error = "audio-start";
      });
      update();
    });
    section.querySelector("[data-g-picks]").append(b);
  }
  for (let i = 0; i < 16; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.guitarStep = i;
    on(b, "click", () => {
      if (locked()) return;
      edit((p) => {
        const a = p.patterns.find((a) => a.id === p.activePattern);
        a.guitarNotes[i] =
          a.guitarNotes[i]?.pitch === pitch
            ? null
            : {
                pitch,
                velocity: Number(
                  section.querySelector("[data-g-velocity]").value,
                ),
              };
      });
      update();
    });
    section.querySelector("[data-g-grid]").append(b);
  }
  for (const field of ["volume", "pan", "mute", "solo"]) {
    const label = document.createElement("label"),
      span = document.createElement("span"),
      input = document.createElement("input");
    span.dataset.gCopy = field;
    input.dataset.gField = field;
    input.type = ["volume", "pan"].includes(field) ? "range" : "checkbox";
    if (input.type === "range") {
      input.min = field === "pan" ? "-1" : "0";
      input.max = "1";
      input.step = ".05";
    }
    on(input, input.type === "range" ? "input" : "change", () => {
      if (!locked())
        edit((p) => {
          p.guitar[field] =
            input.type === "checkbox" ? input.checked : Number(input.value);
        });
      update();
    });
    label.append(span, input);
    section.querySelector("[data-g-mix]").append(label);
  }
  section.querySelector("[data-g-credits]").textContent = GUITAR_CREDITS;
  for (const [key, url] of Object.entries(notices)) {
    const li = document.createElement("li"),
      a = document.createElement("a");
    a.href = url;
    a.dataset.gCopy = key;
    li.append(a);
    section.querySelector("[data-g-links]").append(li);
  }
  function update() {
    const p = current(),
      a = p.patterns.find((a) => a.id === p.activePattern),
      c = copy[document.documentElement.lang === "en" ? "en" : "id"];
    section
      .querySelectorAll("[data-g-copy]")
      .forEach((el) => (el.textContent = c[el.dataset.gCopy]));
    section.querySelector("[data-g-scope]").textContent = c.scope.replace(
      "{pattern}",
      a.name,
    );
    section
      .querySelector("[data-g-grid]")
      .setAttribute("aria-label", c.title + " " + a.name);
    for (const b of section.querySelectorAll("[data-guitar-pitch]")) {
      b.setAttribute("aria-pressed", String(b.dataset.guitarPitch === pitch));
      b.disabled = locked();
    }
    for (const b of section.querySelectorAll("[data-guitar-step]")) {
      const i = Number(b.dataset.guitarStep),
        n = a.guitarNotes[i];
      b.textContent = n ? n.pitch.toUpperCase() : i + 1;
      b.setAttribute("aria-pressed", String(!!n));
      b.setAttribute(
        "aria-label",
        `Guitar ${c.step} ${i + 1} ${n ? n.pitch.toUpperCase() : "-"}`,
      );
      b.disabled = locked();
    }
    for (const input of section.querySelectorAll("[data-g-field]")) {
      const field = input.dataset.gField;
      input.type === "checkbox"
        ? (input.checked = p.guitar[field])
        : (input.value = p.guitar[field]);
      input.setAttribute("aria-label", `Guitar ${c[field]}`);
      input.disabled = locked();
    }
    section.querySelector("[data-g-velocity]").disabled = locked();
  }
  return {
    update,
    dispose() {
      life.abort();
      section.remove();
    },
  };
}
