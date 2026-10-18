import { STUDIO_ROLES } from "../project/studio-model.js";
import {
  CLIP_ROLES,
  PITCHES,
  editCompositionClip,
} from "../project/composition-model.js";
import { instrumentGroups } from "../project/instrument-mix.js";
import { instrumentNames } from "../gamelan/instrument-focus.js";
import { focusKeeper } from "../gamelan/accessible-focus.js";
import { stepIndexAtBeat } from "../audio/sequencing.js";

export const combinedMessages = {
  id: {
    score: "Skor & mixer",
    master: "Volume utama",
    tempo: "Tempo",
    swing: "Swing",
    kit: "Kit perkusi",
    pattern: "Pola",
    clone: "Salin pola",
    append: "Tambah ke rangkaian",
    remove: "Hapus bar terakhir",
    chain: "Rangkaian",
    steps: "16 langkah — klik untuk 0 / 0,65 / 1",
    notes: "Bilah (D minor)",
    pitch: "Nada",
    clips: "Loop beatbox 96 BPM",
    enabled: "Aktif",
    variant: "Variasi",
    volume: "Volume",
    pan: "Pan",
    mute: "Mute",
    solo: "Solo",
    groups: "Grup instrumen",
    consent:
      "Saya memilih campuran Bilah/loop D-minor dengan laras rekaman ini; penyeteman keduanya berbeda.",
    resume: "Lanjut dari jeda",
    hint: "Edit hanya saat berhenti. Mixer grup hanya berlaku pada event proyek. Solo legacy dan solo instrumen berlaku pada keluarga masing-masing. Jeda/Lanjut mempertahankan posisi dan sisa tail; Putar dari awal mengulang skor.",
  },
  en: {
    score: "Score & mixer",
    master: "Master volume",
    tempo: "Tempo",
    swing: "Swing",
    kit: "Percussion kit",
    pattern: "Pattern",
    clone: "Clone pattern",
    append: "Append to chain",
    remove: "Remove last bar",
    chain: "Chain",
    steps: "16 steps — click for 0 / 0.65 / 1",
    notes: "Bilah (D minor)",
    pitch: "Pitch",
    clips: "Beatbox loops at 96 BPM",
    enabled: "Enabled",
    variant: "Variation",
    volume: "Volume",
    pan: "Pan",
    mute: "Mute",
    solo: "Solo",
    groups: "Instrument groups",
    consent:
      "I choose to mix Bilah/D-minor loops with this recorded tuning bank; their tunings differ.",
    resume: "Continue from pause",
    hint: "Edit while stopped. Group mixing applies to project events. Legacy and instrument solos apply within their respective families. Pause/Continue preserves the position and remaining tails; Play from start restarts the score.",
  },
};
export function compositionPanel({
  host,
  locale,
  session,
  transact,
  getBridge,
}) {
  let signature = "";
  let reconcileRejected = false;
  let playbackView = null,
    positionKey = "";
  function renderPosition(position) {
    if (!playbackView) return;
    const v = playbackView,
      p = v.project.composition,
      active = position.state === "playing" && position.bar < p.chain.length,
      pattern = p.patterns.find(
        (a) => a.id === (active ? p.chain[position.bar] : p.activePattern),
      ),
      step = active ? stepIndexAtBeat(position.beat, p.timing.swing) % 16 : -1,
      key = [position.state, position.bar, step, pattern.id].join("/");
    if (key === positionKey) return;
    positionKey = key;
    v.patternSelect.value = pattern.id;
    v.chain.forEach((span, i) =>
      span.classList.toggle("st-playhead", active && i === position.bar),
    );
    v.headers.forEach((span, i) => {
      span.classList.toggle("st-playhead", i === step);
      if (i === step) span.setAttribute("aria-current", "step");
      else span.removeAttribute("aria-current");
    });
    for (const b of v.grid.querySelectorAll("[data-step]")) {
      const [role, i] = b.dataset.step.split("/"),
        value = pattern.steps[role][i];
      b.classList.toggle("st-playhead", Number(i) === step);
      b.setAttribute("aria-pressed", String(value > 0));
      b.setAttribute(
        "aria-label",
        role + ", " + (Number(i) + 1) + ", " + value,
      );
    }
    v.notes.forEach((group, i) => {
      group.classList.toggle("st-playhead", i === step);
      const note = pattern.notes[i];
      group.querySelector("select").value = note?.pitch ?? "";
      group.querySelector("input").value = note?.velocity ?? 0.5;
    });
  }
  const focus = focusKeeper(host);
  const commit = (change) =>
    transact(() => {
      try {
        return change();
      } catch (error) {
        reconcileRejected = true;
        throw error;
      }
    });
  function render(busy) {
    const bridge = getBridge();
    if (!bridge) return;
    const project = bridge.project,
      p = project.composition,
      lang = locale(),
      t = combinedMessages[lang];
    const next = JSON.stringify(project) + lang + busy;
    if (signature === next && !reconcileRejected) return;
    const firstRender = !signature,
      openSections = new Set(
        [...host.querySelectorAll("details[open]")].map(
          (d) => d.dataset.section,
        ),
      );
    signature = next;
    reconcileRejected = false;
    const focused = focus.capture();
    host.replaceChildren();
    positionKey = "";
    const node = (tag, text, parent = host) => {
      const e = document.createElement(tag);
      if (text) e.textContent = text;
      parent.append(e);
      return e;
    };
    const section = (id, title, initiallyOpen = false) => {
      const e = node("details");
      e.dataset.section = id;
      e.open = openSections.has(id) || (firstRender && initiallyOpen);
      node("summary", title, e);
      return e;
    };
    const button = (label, fn, parent = host) => {
      const e = node("button", label, parent);
      e.type = "button";
      e.disabled = busy;
      e.onclick = () => commit(fn);
      return e;
    };
    const input = (label, value, type, fn, parent = host, props = {}) => {
      const l = node("label", label, parent),
        e = node("input", "", l);
      e.type = type;
      e.setAttribute("aria-describedby", "if-notice");
      if (type === "checkbox") e.checked = value;
      else e.value = value;
      Object.assign(e, props);
      // These numeric fields share the schema's continuous finite domains.
      // A step lattice must not reject generated or imported project values.
      if (type === "number") e.step = "any";
      e.disabled = busy;
      e.onchange = () => {
        const value = type === "checkbox" ? e.checked : e.valueAsNumber;
        if (
          !e.checkValidity() ||
          (type === "number" && !Number.isFinite(value))
        ) {
          commit(() => {
            throw Object.assign(Error("Invalid composition control"), {
              code: "invalidCompositionEdit",
            });
          });
          return;
        }
        commit(() => fn(value));
      };
      return e;
    };
    const select = (label, value, options, fn, parent = host) => {
      const l = node("label", label, parent),
        e = node("select", "", l);
      e.setAttribute("aria-describedby", "if-notice");
      for (const [v, text] of options) {
        const o = node("option", text, e);
        o.value = v;
      }
      e.value = value;
      e.disabled = busy;
      e.onchange = () => commit(() => fn(e.value));
      return e;
    };
    const edit = (fn) => bridge.editComposition(fn);
    const mixControls = (m, change, parent) => {
      input(t.volume, m.volume, "number", (v) => change("volume", v), parent, {
        min: 0,
        max: 1,
        required: true,
      });
      input(t.pan, m.pan, "number", (v) => change("pan", v), parent, {
        min: -1,
        max: 1,
        required: true,
      });
      for (const field of ["mute", "solo"])
        input(t[field], m[field], "checkbox", (v) => change(field, v), parent);
    };
    node("h3", t.score);
    node("p", t.hint);
    const controls = node("div");
    controls.className = "combined-controls";
    input(
      t.master,
      p.master.volume,
      "number",
      (v) =>
        edit((p) => {
          p.master.volume = v;
        }),
      controls,
      { min: 0, max: 0.75, required: true },
    );
    input(
      t.tempo,
      p.timing.bpm,
      "number",
      (v) =>
        edit((p) => {
          p.timing.bpm = v;
        }),
      controls,
      { min: 60, max: 180, required: true },
    );
    input(
      t.swing,
      p.timing.swing,
      "number",
      (v) =>
        edit((p) => {
          p.timing.swing = v;
        }),
      controls,
      { min: 0, max: 0.5, required: true },
    );
    select(
      t.kit,
      p.pack.id,
      [
        ["ruang", "Ruang"],
        ["arus", "Arus"],
        ["fusion", "Nusantara Fusion"],
      ],
      (v) =>
        edit((p) => {
          p.pack.id = v;
        }),
      controls,
    );
    const patternSelect = select(
      t.pattern,
      p.activePattern,
      p.patterns.map((a) => [a.id, a.name]),
      (v) =>
        edit((p) => {
          p.activePattern = v;
        }),
      controls,
    );
    button(
      t.clone,
      () =>
        edit((p) => {
          if (p.patterns.length >= 16) throw Error("limit");
          let id = "p" + (p.patterns.length + 1);
          while (p.patterns.some((a) => a.id === id)) id += "x";
          const a = structuredClone(
            p.patterns.find((a) => a.id === p.activePattern),
          );
          a.id = id;
          a.name = id;
          p.patterns.push(a);
          p.activePattern = id;
        }),
      controls,
    );
    button(
      t.append,
      () =>
        edit((p) => {
          p.chain.push(p.activePattern);
        }),
      controls,
    );
    button(
      t.remove,
      () =>
        edit((p) => {
          if (p.chain.length > 1) p.chain.pop();
        }),
      controls,
    );
    const chainHost = node("p", t.chain + ": "),
      chain = [];
    chainHost.className = "combined-chain";
    p.chain.forEach((id, i) => {
      const span = node(
        "span",
        p.patterns.find((a) => a.id === id).name,
        chainHost,
      );
      span.dataset.combinedChain = String(i);
      chain.push(span);
      if (i < p.chain.length - 1) node("span", " → ", chainHost);
    });
    node("h4", t.steps);
    const pattern = p.patterns.find((a) => a.id === p.activePattern),
      grid = node("div");
    grid.className = "combined-grid";
    const header = node("div", "", grid),
      headers = [];
    header.className = "step-row combined-head";
    node("span", "", header);
    for (let i = 0; i < 16; i++) {
      const span = node("span", String(i + 1), header);
      span.dataset.combinedHead = String(i);
      headers.push(span);
    }
    for (const role of STUDIO_ROLES) {
      const row = node("div", "", grid);
      row.className = "step-row";
      node("strong", role, row);
      for (let i = 0; i < 16; i++) {
        const value = pattern.steps[role][i],
          b = button(
            String(i + 1),
            () =>
              edit((p) => {
                p.patterns.find((a) => a.id === p.activePattern).steps[role][
                  i
                ] = value === 0 ? 0.65 : value < 1 ? 1 : 0;
              }),
            row,
          );
        b.dataset.step = role + "/" + i;
        b.setAttribute("aria-label", role + ", " + (i + 1) + ", " + value);
        b.setAttribute("aria-pressed", String(value > 0));
      }
    }
    const mixer = node(
      "div",
      "",
      section("tracks", lang === "id" ? "Mixer perkusi" : "Percussion mixer"),
    );
    mixer.className = "combined-mix";
    for (const track of p.tracks) {
      const group = node("fieldset", "", mixer);
      node("legend", track.role, group);
      mixControls(
        track,
        (field, value) =>
          edit((p) => {
            p.tracks.find((m) => m.role === track.role)[field] = value;
          }),
        group,
      );
    }
    const bilahSection = section("bilah", t.notes);
    const notes = node("div", "", bilahSection);
    notes.className = "combined-mix";
    const noteGroups = [];
    for (let i = 0; i < 16; i++) {
      const group = node("div", "", notes),
        note = pattern.notes[i];
      group.classList.add("combined-note");
      group.dataset.combinedNote = String(i);
      noteGroups.push(group);
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", t.notes + " - " + (i + 1));
      select(
        t.pitch + " " + (i + 1),
        note?.pitch ?? "",
        [["", "—"], ...PITCHES.map((n) => [n, n])],
        (v) =>
          edit((p) => {
            p.patterns.find((a) => a.id === p.activePattern).notes[i] = v
              ? { pitch: v, velocity: note?.velocity ?? 0.5 }
              : null;
          }),
        group,
      );
      const v = input(
        t.volume,
        note?.velocity ?? 0.5,
        "number",
        (v) =>
          edit((p) => {
            const n = p.patterns.find((a) => a.id === p.activePattern).notes[i];
            if (n) n.velocity = v;
          }),
        group,
        { min: Number.MIN_VALUE, max: 1, required: true },
      );
      v.disabled ||= !note;
    }
    const bilah = node("fieldset", "", bilahSection);
    node("legend", "Bilah", bilah);
    mixControls(
      p.instrument,
      (f, v) =>
        edit((p) => {
          p.instrument[f] = v;
        }),
      bilah,
    );
    const clips = node("div", "", section("clips", t.clips));
    clips.className = "combined-mix";
    for (const role of CLIP_ROLES) {
      const c = p.clips.find((c) => c.role === role) ?? {
        enabled: false,
        variant: 1,
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
      };
      const group = node("fieldset", "", clips);
      node("legend", role, group);
      const change = (f, v) => edit((p) => editCompositionClip(p, role, f, v));
      input(
        t.enabled,
        c.enabled,
        "checkbox",
        (v) => change("enabled", v),
        group,
      );
      select(
        t.variant,
        String(c.variant),
        [
          ["1", "1"],
          ["2", "2"],
        ],
        (v) => change("variant", Number(v)),
        group,
      );
      mixControls(c, change, group);
    }
    node("h4", t.groups);
    const groups = node("div");
    groups.className = "combined-mix";
    for (const g of instrumentGroups(project, session.registry)) {
      const group = node("fieldset", "", groups);
      group.dataset.group = g.bankId + "/" + g.instrumentId;
      node(
        "legend",
        (instrumentNames[g.instrumentId] ?? g.instrumentId) + " · " + g.bankId,
        group,
      );
      mixControls(g, (f, v) => bridge.editGroup({ ...g, [f]: v }), group);
    }
    input(t.consent, project.tuningConsent === true, "checkbox", (v) =>
      bridge.acknowledgeTuning(v),
    );
    playbackView = {
      project,
      grid,
      headers,
      notes: noteGroups,
      patternSelect,
      chain,
    };
    focus.restore(focused);
  }
  return { render, renderPosition };
}
