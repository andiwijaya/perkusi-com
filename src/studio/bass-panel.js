import { BASS_PITCHES, BASS_CREDITS } from "../project/bass.js";
const copy = {
  id: {
    title: "Bass elektrik — 3 nada",
    scope:
      "Nada bass untuk pola {pattern}. Pilih E1/G1/B1, lalu isi 16 langkah. Sampel pendek 1,2 detik; nada berikut meredam nada sebelumnya. Mengubah langkah menjeda musik. Kosongkan pola juga menghapus nada bass.",
    velocity: "Kekuatan nada bass",
    step: "Langkah",
    mix: "Mix bass — seluruh proyek",
    volume: "Volume",
    pan: "Pan",
    mute: "Bisukan",
    solo: "Solo",
    credits: "Sumber & lisensi bass",
    license: "Lisensi CC0",
    provenance: "Asal, perubahan & hash sampel",
    source: "Sumber FreePats — Bass Guitar YR",
  },
  en: {
    title: "Electric bass — 3 notes",
    scope:
      "Bass notes for pattern {pattern}. Pick E1/G1/B1, then fill the 16 steps. Short 1.2-second samples; the next note fades the previous one. Editing steps pauses playback. Clear pattern also clears its bass notes.",
    velocity: "Bass note strength",
    step: "Step",
    mix: "Bass mix — whole project",
    volume: "Volume",
    pan: "Pan",
    mute: "Mute",
    solo: "Solo",
    credits: "Bass sources & license",
    license: "CC0 license",
    provenance: "Source, changes & sample hashes",
    source: "FreePats source — Bass Guitar YR",
  },
};
export function initBassPanel({
  after,
  current,
  edit,
  engine,
  locked,
  notices,
}) {
  const section = document.createElement("section"),
    life = new AbortController();
  let pitch = "e1";
  section.className = "bass-section kendhang-section";
  section.innerHTML = `<h3 data-b-copy="title"></h3><p data-b-scope></p><div class="v3-note-picks" data-b-picks></div><label><span data-b-copy="velocity"></span><input data-b-velocity type="range" min="0.1" max="1" step="0.1" value="0.7"></label><div class="v3-note-grid" data-b-grid role="group"></div><p data-b-copy="mix"></p><div class="v3-mix" data-b-mix></div><details><summary data-b-copy="credits"></summary><p data-b-credits></p><ul data-b-links></ul></details>`;
  after.after(section);
  const on = (el, event, fn) =>
    el.addEventListener(event, fn, { signal: life.signal });
  for (const id of BASS_PITCHES) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.bassPitch = id;
    b.textContent = id.toUpperCase();
    on(b, "click", () => {
      if (locked()) return;
      pitch = id;
      void engine.composition.pad(id, "bass").catch(() => {
        engine.error = "audio-start";
      });
      update();
    });
    section.querySelector("[data-b-picks]").append(b);
  }
  for (let i = 0; i < 16; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.bassStep = i;
    on(b, "click", () => {
      if (locked()) return;
      edit((p) => {
        const a = p.patterns.find((a) => a.id === p.activePattern);
        a.bassNotes[i] =
          a.bassNotes[i]?.pitch === pitch
            ? null
            : {
                pitch,
                velocity: Number(
                  section.querySelector("[data-b-velocity]").value,
                ),
              };
      });
      update();
    });
    section.querySelector("[data-b-grid]").append(b);
  }
  for (const field of ["volume", "pan", "mute", "solo"]) {
    const label = document.createElement("label"),
      span = document.createElement("span"),
      input = document.createElement("input");
    span.dataset.bCopy = field;
    input.dataset.bField = field;
    input.type = ["volume", "pan"].includes(field) ? "range" : "checkbox";
    if (input.type === "range") {
      input.min = field === "pan" ? "-1" : "0";
      input.max = "1";
      input.step = ".05";
    }
    on(input, input.type === "range" ? "input" : "change", () => {
      if (!locked())
        edit((p) => {
          p.bass[field] =
            input.type === "checkbox" ? input.checked : Number(input.value);
        });
      update();
    });
    label.append(span, input);
    section.querySelector("[data-b-mix]").append(label);
  }
  section.querySelector("[data-b-credits]").textContent = BASS_CREDITS;
  for (const [key, url] of Object.entries(notices)) {
    const li = document.createElement("li"),
      a = document.createElement("a");
    a.href = url;
    a.dataset.bCopy = key;
    li.append(a);
    section.querySelector("[data-b-links]").append(li);
  }
  function update() {
    const p = current(),
      a = p.patterns.find((a) => a.id === p.activePattern),
      c = copy[document.documentElement.lang === "en" ? "en" : "id"];
    section
      .querySelectorAll("[data-b-copy]")
      .forEach((el) => (el.textContent = c[el.dataset.bCopy]));
    section.querySelector("[data-b-scope]").textContent = c.scope.replace(
      "{pattern}",
      a.name,
    );
    section
      .querySelector("[data-b-grid]")
      .setAttribute("aria-label", c.title + " " + a.name);
    for (const b of section.querySelectorAll("[data-bass-pitch]")) {
      b.setAttribute("aria-pressed", String(b.dataset.bassPitch === pitch));
      b.disabled = locked();
    }
    for (const b of section.querySelectorAll("[data-bass-step]")) {
      const i = Number(b.dataset.bassStep),
        n = a.bassNotes[i];
      b.textContent = n ? n.pitch.toUpperCase() : i + 1;
      b.setAttribute("aria-pressed", String(!!n));
      b.setAttribute(
        "aria-label",
        `Bass ${c.step} ${i + 1} ${n ? n.pitch.toUpperCase() : "-"}`,
      );
      b.disabled = locked();
    }
    for (const input of section.querySelectorAll("[data-b-field]")) {
      const field = input.dataset.bField;
      input.type === "checkbox"
        ? (input.checked = p.bass[field])
        : (input.value = p.bass[field]);
      input.setAttribute("aria-label", `Bass ${c[field]}`);
      input.disabled = locked();
    }
    section.querySelector("[data-b-velocity]").disabled = locked();
  }
  return {
    update,
    dispose() {
      life.abort();
      section.remove();
    },
  };
}
