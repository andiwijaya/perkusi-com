import { KENDHANG_STROKES, KENDHANG_CREDITS } from "../project/kendhang.js";
const words = {
  id: {
    title: "Kendhang Ciblon",
    scope:
      "Pukulan untuk pola {pattern}. Isi dua baris 16 langkah. Mengubah langkah menjeda musik; tekan Putar lagi. Kosongkan pola juga menghapus pukulan kendhang.",
    velocity: "Kekuatan pukulan",
    step: "Langkah",
    pad: "Dengarkan",
    mix: "Mix Kendhang — seluruh proyek",
    volume: "Volume",
    pan: "Pan",
    mute: "Bisukan",
    solo: "Solo",
    credits: "Sumber & lisensi",
    takSource: "Sumber asli TAK",
    thungSource: "Sumber asli THUNG",
    recordingLicense: "Lisensi rekaman CC BY 3.0",
    packageLicense: "Lisensi paket Artistic 2.0",
    notice: "Pemberitahuan perubahan paket",
  },
  en: {
    title: "Kendhang Ciblon",
    scope:
      "Hits for pattern {pattern}. Fill the two 16-step rows. Editing steps pauses playback; press Play again. Clear pattern also clears its kendhang hits.",
    velocity: "Hit strength",
    step: "Step",
    pad: "Audition",
    mix: "Kendhang mix — whole project",
    volume: "Volume",
    pan: "Pan",
    mute: "Mute",
    solo: "Solo",
    credits: "Sources & licenses",
    takSource: "Original TAK source",
    thungSource: "Original THUNG source",
    recordingLicense: "CC BY 3.0 recording license",
    packageLicense: "Artistic 2.0 package license",
    notice: "Package modification notice",
  },
};
export function initKendhangPanel({
  after,
  current,
  edit,
  engine,
  locked,
  notices,
}) {
  const section = document.createElement("section"),
    life = new AbortController();
  section.className = "kendhang-section";
  section.innerHTML = `<h3 data-k-copy="title"></h3><p data-k-scope></p><label><span data-k-copy="velocity"></span><input data-k-velocity type="range" min="0.1" max="1" step="0.1" value="0.7"></label><div data-k-rows></div><p data-k-copy="mix"></p><div class="v3-mix" data-k-mix></div><details><summary data-k-copy="credits"></summary><p data-k-credits></p><ul data-k-links></ul></details>`;
  after.after(section);
  const on = (node, event, fn) =>
    node.addEventListener(event, fn, { signal: life.signal });
  for (const id of KENDHANG_STROKES) {
    const row = document.createElement("div"),
      pad = document.createElement("button"),
      grid = document.createElement("div");
    row.dataset.kRow = id;
    pad.type = "button";
    pad.dataset.kPad = id;
    grid.className = "v3-note-grid";
    grid.role = "group";
    on(pad, "click", () => {
      if (!locked())
        void engine.composition.pad(id, "kendhang").catch(() => {
          engine.error = "audio-start";
        });
    });
    row.append(pad, grid);
    section.querySelector("[data-k-rows]").append(row);
    for (let i = 0; i < 16; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.kendhangStep = id + ":" + i;
      on(b, "click", () => {
        if (locked()) return;
        edit((p) => {
          const a = p.patterns.find((a) => a.id === p.activePattern);
          a.kendhang[id][i] = a.kendhang[id][i]
            ? 0
            : Number(section.querySelector("[data-k-velocity]").value);
        });
        update();
      });
      grid.append(b);
    }
  }
  for (const field of ["volume", "pan", "mute", "solo"]) {
    const label = document.createElement("label"),
      span = document.createElement("span"),
      input = document.createElement("input");
    span.dataset.kCopy = field;
    input.dataset.kField = field;
    input.type = ["volume", "pan"].includes(field) ? "range" : "checkbox";
    if (input.type === "range") {
      input.min = field === "pan" ? "-1" : "0";
      input.max = "1";
      input.step = ".05";
    }
    on(input, input.type === "range" ? "input" : "change", () => {
      if (!locked())
        edit((p) => {
          p.kendhang[field] =
            input.type === "checkbox" ? input.checked : Number(input.value);
        });
      update();
    });
    label.append(span, input);
    section.querySelector("[data-k-mix]").append(label);
  }
  section.querySelector("[data-k-credits]").textContent = KENDHANG_CREDITS;
  for (const [key, url] of Object.entries(notices)) {
    const li = document.createElement("li"),
      a = document.createElement("a");
    a.href = url;
    a.dataset.kCopy = key;
    li.append(a);
    section.querySelector("[data-k-links]").append(li);
  }
  function update() {
    const p = current(),
      a = p.patterns.find((a) => a.id === p.activePattern),
      c = words[document.documentElement.lang === "en" ? "en" : "id"];
    section.querySelectorAll("[data-k-copy]").forEach((el) => {
      el.textContent = c[el.dataset.kCopy];
    });
    section.querySelector("[data-k-scope]").textContent = c.scope.replace(
      "{pattern}",
      a.name,
    );
    for (const id of KENDHANG_STROKES) {
      const row = section.querySelector(`[data-k-row="${id}"]`),
        pad = row.querySelector("button");
      pad.textContent = c.pad + " " + id.toUpperCase();
      pad.disabled = locked();
      row
        .querySelector("[role=group]")
        .setAttribute("aria-label", id.toUpperCase() + " " + a.name);
    }
    for (const b of section.querySelectorAll("[data-kendhang-step]")) {
      const [id, n] = b.dataset.kendhangStep.split(":"),
        value = a.kendhang[id][Number(n)];
      b.textContent = Number(n) + 1;
      b.setAttribute("aria-pressed", String(value > 0));
      b.setAttribute(
        "aria-label",
        `${id.toUpperCase()} ${c.step} ${Number(n) + 1}, ${value}`,
      );
      b.disabled = locked();
    }
    for (const input of section.querySelectorAll("[data-k-field]")) {
      const key = input.dataset.kField;
      input.type === "checkbox"
        ? (input.checked = p.kendhang[key])
        : (input.value = p.kendhang[key]);
      input.setAttribute("aria-label", `Kendhang ${c[key]}`);
      input.disabled = locked();
    }
    section.querySelector("[data-k-velocity]").disabled = locked();
  }
  return {
    update,
    dispose() {
      life.abort();
      section.remove();
    },
  };
}
