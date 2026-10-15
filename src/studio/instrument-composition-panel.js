import { STUDIO_ROLES } from "../project/studio-model.js";
import {
  CLIP_ROLES,
  PITCHES,
  editCompositionClip,
} from "../project/composition-model.js";
import { instrumentGroups } from "../project/instrument-mix.js";
import { instrumentNames } from "../gamelan/instrument-focus.js";
import { focusKeeper } from "../gamelan/accessible-focus.js";

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
    select(
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
    node(
      "p",
      t.chain +
        ": " +
        p.chain
          .map((id) => p.patterns.find((a) => a.id === id).name)
          .join(" → "),
    );
    node("h4", t.steps);
    const pattern = p.patterns.find((a) => a.id === p.activePattern),
      grid = node("div");
    grid.className = "combined-grid";
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
    for (let i = 0; i < 16; i++) {
      const group = node("div", "", notes),
        note = pattern.notes[i];
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
    focus.restore(focused);
  }
  return { render };
}
