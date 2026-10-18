import {
  CORPUS_INSTRUMENTS,
  instrumentNames,
  physicalFocus,
  padLabel,
} from "./instrument-focus.js";
import {
  gamelanBarCount,
  GAMELAN_BAR_TICKS,
  GAMELAN_STEP_TICKS,
  toggleGamelanStep,
  appendGamelanBar,
} from "../project/gamelan-grid.js";
import { legacyAudible } from "../project/instrument-mix.js";
import { focusKeeper } from "./accessible-focus.js";
import { focusCopy } from "./focus-copy.js";
import { playbackDisplay, positionDriver } from "../app/playback-position.js";

const messages = {
  id: {
    title: "Pola Gamelan",
    hint: "Pilih instrumen dan bar, lalu klik langkah untuk menambah atau menghapus pukulan. Nada dan laras asli tetap dipakai.",
    instrument: "Instrumen",
    tuning: "Laras",
    bar: "Bar",
    add: "Tambah bar",
    action: "Tindakan",
    strike: "Pukul",
    damp: "Redam",
    velocity: "Kuat pukulan",
    undo: "Urungkan",
    redo: "Ulangi",
    play: "Putar sekali",
    playPattern: "Putar pola",
    playing: "Memutar",
    looping: "Pola berulang",
    paused: "Dijeda",
    stopped: "Berhenti",
    repeat: "Ulang pola",
    repeatVoices:
      "Tail yang bertumpuk saat pola diulang melampaui batas 16 suara. Panjangkan pola dengan Tambah bar atau tambahkan event Redam, lalu coba lagi. Putar sekali dapat dicoba sekarang; nada dan tail asli tetap utuh.",
    repeatLevel:
      "Tail yang bertumpuk saat pola diulang membuat campuran terlalu kuat. Panjangkan pola dengan Tambah bar atau tambahkan event Redam, lalu coba lagi. Putar sekali dapat dicoba sekarang; nada dan tail asli tetap utuh.",
    onceVoices:
      "Pola ini melewati batas 16 suara yang bertumpuk. Kurangi pukulan yang bertumpuk atau tambahkan event Redam, lalu coba lagi. Proyek tetap disimpan.",
    onceLevel:
      "Pola ini melewati batas aman volume campuran. Kurangi pukulan yang bertumpuk, tambahkan event Redam, atau atur volume mix di Studio, lalu coba lagi. Proyek tetap disimpan.",
    pause: "Jeda",
    resume: "Lanjutkan",
    hybrid:
      "Campuran dengan pola/loop lama memakai Putar sekali; sumber dan proyek lengkap tetap disimpan.",
    stop: "Berhenti",
    grid: "Grid Gamelan 16 langkah",
    scroll:
      "16 langkah per bar. Geser ke samping untuk melihat semua langkah. Tombol panah memindahkan fokus; Spasi/Enter mengubah langkah.",
    step: "langkah",
    total: "Pukul/redam dalam proyek",
    retained: "Pukul/redam antar-langkah pada tampilan ini tetap disimpan",
    empty:
      "Instrumen ini tidak tersedia pada bank terpilih. Pilih instrumen atau laras lain.",
    note: "Instrumen / nada",
  },
  en: {
    title: "Gamelan patterns",
    hint: "Choose an instrument and bar, then click steps to add or remove strikes. Original notes and tuning banks are retained.",
    instrument: "Instrument",
    tuning: "Tuning",
    bar: "Bar",
    add: "Add bar",
    action: "Action",
    strike: "Strike",
    damp: "Damp",
    velocity: "Velocity",
    undo: "Undo",
    redo: "Redo",
    play: "Play once",
    playPattern: "Play pattern",
    playing: "Playing",
    looping: "Pattern repeating",
    paused: "Paused",
    stopped: "Stopped",
    repeat: "Repeat pattern",
    repeatVoices:
      "Overlapping tails exceed the 16-voice limit when this pattern repeats. Extend the pattern with Add bar or add Damp events, then retry. You can try Play once now; original notes and tails stay intact.",
    repeatLevel:
      "Overlapping tails make the repeating mix too loud. Extend the pattern with Add bar or add Damp events, then retry. You can try Play once now; original notes and tails stay intact.",
    onceVoices:
      "This pattern exceeds the 16-voice limit. Reduce overlapping strikes or add Damp events, then retry. Your project is retained.",
    onceLevel:
      "This pattern exceeds the safe mix level. Reduce overlapping strikes, add Damp events, or adjust mix levels in Studio, then retry. Your project is retained.",
    pause: "Pause",
    resume: "Continue",
    hybrid:
      "Projects with legacy patterns/clips use Play once; the complete source and project are retained.",
    stop: "Stop",
    grid: "16-step Gamelan grid",
    scroll:
      "16 steps per bar. Scroll sideways for all steps. Arrow keys move focus; Space/Enter changes a step.",
    step: "step",
    total: "Project strikes/damps",
    retained: "Off-grid strikes/damps in this view are retained",
    empty:
      "This instrument is unavailable in the selected bank. Choose another instrument or tuning.",
    note: "Instrument / note",
  },
};
Object.assign(focusCopy.id.errors, {
  repeatNeedsEventOnly:
    "Pengulangan ini memerlukan skor Gamelan tanpa pola/clip lama yang aktif. Gunakan Putar sekali; proyek tetap utuh.",
  replayLate:
    "Pemutaran dihentikan karena browser terlambat menjadwalkan audio. Proyek tetap utuh; coba lagi.",
  invalidLoopPlan:
    "Panjang pola tidak bisa diulang dengan aman. Proyek tetap utuh.",
});
Object.assign(focusCopy.en.errors, {
  repeatNeedsEventOnly:
    "Repeat currently requires a Gamelan score without active legacy patterns/clips. Use Play once; your project is retained.",
  replayLate:
    "Playback stopped because the browser could not schedule audio in time. Your project is retained; try again.",
  invalidLoopPlan:
    "This pattern length cannot repeat safely. Your project is retained.",
});

export function initSequencePanel({
  host,
  session,
  studio,
  locale,
  act,
  onPosition = () => {},
}) {
  const focus = focusKeeper(host);
  let instrument = session.snapshot().focus.instrument,
    laras = session.snapshot().focus.laras,
    bar = 0,
    action = "strike",
    velocity = 0.65,
    signature = "",
    activeCell = null,
    documentKey = null,
    repeat = false,
    playbackError = null,
    view = null;
  const position = positionDriver(() => session.playhead(), paintPosition);
  function paintPosition(p) {
    onPosition(p);
    if (!view) return;
    view.display(p);
    const following = ["playing", "waiting"].includes(p.state);
    if (following) {
      view.following = true;
      const nextBar = Math.min(p.bar, gamelanBarCount(view.project) - 1);
      if (nextBar !== view.bar) {
        view.bar = nextBar;
        view.barSelect.value = String(nextBar);
        for (const cell of view.cells) {
          const tick =
              nextBar * GAMELAN_BAR_TICKS + cell.step * GAMELAN_STEP_TICKS,
            pressed = view.events.has(
              JSON.stringify([cell.bankId, cell.sampleId, tick, view.action]),
            );
          cell.button.textContent = pressed
            ? view.action === "strike"
              ? "●"
              : "x"
            : "·";
          cell.button.setAttribute("aria-pressed", String(pressed));
          cell.button.dataset.step = [
            cell.bankId,
            cell.sampleId,
            nextBar,
            cell.step,
            view.action,
          ].join("/");
          cell.button.setAttribute(
            "aria-label",
            `${cell.name}, ${view.laras}, ${view.text.bar} ${nextBar + 1}, ${view.text.step} ${cell.step + 1}, ${view.action === "strike" ? view.text.strike : view.text.damp}`,
          );
        }
        view.retained.textContent = `${view.text.total}: ${view.project.events.length}. ${view.text.retained}: ${view.offGrid.get(nextBar) ?? 0}.`;
      }
    }
    const step = p.state === "playing" && p.bar === view.bar ? p.step : null;
    if (step === view.step) return;
    if (view.step !== null) {
      view.headers[view.step].classList.remove("st-playhead");
      view.headers[view.step].removeAttribute("aria-current");
      view.columns[view.step].forEach((b) => b.classList.remove("st-playhead"));
    }
    view.step = step;
    if (step !== null) {
      view.headers[step].classList.add("st-playhead");
      view.headers[step].setAttribute("aria-current", "step");
      view.columns[step].forEach((b) => b.classList.add("st-playhead"));
    }
  }
  function updateControls(s, bridge, t, busy, hardBusy, hybrid) {
    const disabled = (id, value) => {
      const e = host.querySelector("#gs-" + id);
      if (e && e.disabled !== value) e.disabled = value;
    };
    disabled("play", busy || !(bridge.project.events.length || hybrid));
    disabled("stop", hardBusy || s.contextState === "absent");
    disabled("pause", hardBusy || !s.replaying);
    disabled("resume", busy || !s.canResume);
    disabled("undo", busy || !bridge.canUndo);
    disabled("redo", busy || !bridge.canRedo);
    disabled("play-once", busy);
    disabled("repeat", busy || hybrid);
    disabled("add-bar", busy || gamelanBarCount(bridge.project) >= 128);
    for (const id of ["instrument", "laras", "bar", "action"])
      disabled(id, busy);
    disabled("velocity", busy || action === "damp");
    for (const cell of view?.cells ?? [])
      if (cell.button.disabled !== busy) cell.button.disabled = busy;
    const state = host.querySelector("#gs-state"),
      label = s.repeating
        ? t.looping
        : s.replaying
          ? t.playing
          : s.canResume
            ? t.paused
            : t.stopped;
    if (state && state.textContent !== label) state.textContent = label;
    if (view) {
      view.running = s.replaying;
      if (s.replaying) view.lastRepeat = s.repeating;
    }
  }
  host.className = "st-panel gs-panel";
  host.id = "gs-panel";
  host.setAttribute("aria-labelledby", "gs-title");
  host.addEventListener("focusin", (e) => {
    if (e.target.dataset.gsStep !== undefined) {
      host
        .querySelector('[data-gs-step][tabindex="0"]')
        ?.setAttribute("tabindex", "-1");
      e.target.tabIndex = 0;
      activeCell = e.target.dataset.step;
    }
  });
  host.addEventListener("keydown", (e) => {
    const b = e.target.closest("[data-gs-step]");
    if (
      !b ||
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(e.key)
    )
      return;
    const buttons = [...host.querySelectorAll("[data-gs-step]")],
      i = buttons.indexOf(b),
      col = i % 16;
    let next =
      i +
      ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -16, ArrowDown: 16 }[e.key] ??
        0);
    if (e.key === "Home") next = e.ctrlKey ? 0 : i - col;
    if (e.key === "End") next = e.ctrlKey ? buttons.length - 1 : i - col + 15;
    e.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  });
  function render(s = session.snapshot()) {
    if (view?.running && !s.replaying && s.error)
      playbackError = { code: s.error, repeat: view.lastRepeat };
    if (view?.following && !s.replaying) bar = view.bar;
    host.dataset.playback = s.repeating
      ? "repeat"
      : s.replaying
        ? "playing"
        : s.canResume
          ? "paused"
          : "stopped";
    const bridge = studio.historyBridge(),
      project = bridge.project,
      lang = locale(),
      t = messages[lang],
      busy =
        s.recording ||
        s.armingRecord ||
        s.exporting ||
        s.replaying ||
        s.disposing ||
        s.disposed ||
        ["loading", "starting"].includes(s.status),
      hardBusy =
        s.recording ||
        s.armingRecord ||
        s.exporting ||
        s.disposing ||
        s.disposed;
    const incomingKey = project.composition.title + "|" + project.origin.text;
    if (incomingKey !== documentKey) {
      documentKey = incomingKey;
      playbackError = null;
      const first = project.events.find((e) => {
        if (e.action !== "strike") return false;
        const ref = project.banks.find((b) => b.id === e.bankId);
        return CORPUS_INSTRUMENTS.includes(
          session.registry.sample(ref.id, ref.version, e.sampleId).instrumentId,
        );
      });
      if (first) {
        const ref = project.banks.find((b) => b.id === first.bankId),
          bank = session.registry.bank(ref.id, ref.version),
          sample = session.registry.sample(ref.id, ref.version, first.sampleId);
        instrument = sample.instrumentId;
        if (["pelog", "slendro"].includes(bank.laras)) laras = bank.laras;
      }
      bar = 0;
      activeCell = null;
    }
    bar = Math.min(bar, gamelanBarCount(project) - 1);
    const hybrid = legacyAudible(project.composition);
    if (hybrid) repeat = false;
    const next =
      JSON.stringify(project) +
      JSON.stringify([
        lang,
        instrument,
        laras,
        bar,
        action,
        velocity,
        repeat,
        playbackError,
      ]);
    if (signature === next) {
      updateControls(s, bridge, t, busy, hardBusy, hybrid);
      position.update();
      return;
    }
    signature = next;
    const saved = focus.capture();
    host.replaceChildren();
    const node = (tag, text, parent = host) => {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      parent.append(n);
      return n;
    };
    const button = (text, fn, parent, disabled = busy) => {
      const b = node("button", text, parent);
      b.type = "button";
      b.disabled = disabled;
      b.onclick = fn;
      return b;
    };
    const play = (e, repeatMode) =>
      void act(async () => {
        playbackError = null;
        try {
          await session.enable({
            gesture: e.isTrusted,
            focus: { instrument, laras, ensemble: false },
          });
          await session.replay({ repeat: repeatMode });
          const result = session.snapshot();
          if (result.error)
            playbackError = { code: result.error, repeat: repeatMode };
        } catch (error) {
          playbackError = {
            code: error.code ?? "fallback",
            repeat: repeatMode,
          };
          throw error;
        } finally {
          render();
        }
      });
    node("h2", t.title).id = "gs-title";
    node("p", t.hint);
    const toolbar = node("div");
    toolbar.className = "toolbar gs-transport";
    button(
      repeat ? t.playPattern : t.play,
      (e) => play(e, repeat),
      toolbar,
      busy || !(project.events.length || legacyAudible(project.composition)),
    ).id = "gs-play";
    button(
      t.stop,
      () => void act(() => session.stopPlayback()),
      toolbar,
      hardBusy || s.contextState === "absent",
    ).id = "gs-stop";
    button(
      t.pause,
      () => void act(() => session.pause()),
      toolbar,
      hardBusy || !s.replaying,
    ).id = "gs-pause";
    button(
      t.resume,
      (e) =>
        void act(async () => {
          await session.enable({ gesture: e.isTrusted });
          await session.replay({ resume: true });
        }),
      toolbar,
      busy || !s.canResume,
    ).id = "gs-resume";
    button(
      t.undo,
      () => void studio.historyAction("undo"),
      toolbar,
      busy || !bridge.canUndo,
    ).id = "gs-undo";
    button(
      t.redo,
      () => void studio.historyAction("redo"),
      toolbar,
      busy || !bridge.canRedo,
    ).id = "gs-redo";
    const display = playbackDisplay(host, "gs-playhead", locale);
    const controls = node("div");
    const playbackState = node(
      "output",
      s.repeating
        ? t.looping
        : s.replaying
          ? t.playing
          : s.canResume
            ? t.paused
            : t.stopped,
    );
    playbackState.id = "gs-state";
    playbackState.setAttribute("role", "status");
    if (playbackError) {
      const { code, repeat: repeating } = playbackError,
        text =
          code === "voiceLimit"
            ? repeating
              ? t.repeatVoices
              : t.onceVoices
            : code === "voiceHeadroom"
              ? repeating
                ? t.repeatLevel
                : t.onceLevel
              : (focusCopy[lang].errors[code] ??
                focusCopy[lang].errors.fallback);
      const advice = node("p", text, controls);
      advice.id = repeating ? "gs-repeat-error" : "gs-once-error";
      advice.className = "notice error-notice";
      advice.setAttribute("role", "alert");
      if (repeating && ["voiceLimit", "voiceHeadroom"].includes(code))
        button(t.play, (e) => play(e, false), controls).id = "gs-play-once";
    }
    controls.className = "gs-controls";
    const rl = node("label", t.repeat, controls),
      ri = node("input", undefined, rl);
    ri.id = "gs-repeat";
    ri.type = "checkbox";
    ri.checked = repeat;
    ri.disabled = busy || hybrid;
    ri.onchange = () => {
      repeat = ri.checked;
      playbackError = null;
      signature = "";
      render();
    };
    if (hybrid) node("p", t.hybrid);
    const select = (key, label, value, options, change) => {
      const l = node("label", label, controls),
        n = node("select", undefined, l);
      n.id = "gs-" + key;
      for (const [v, text] of options) {
        const o = node("option", text, n);
        o.value = v;
      }
      n.value = value;
      n.disabled = busy;
      n.onchange = () => {
        change(n.value);
        signature = "";
        render();
      };
      return n;
    };
    select(
      "instrument",
      t.instrument,
      instrument,
      CORPUS_INSTRUMENTS.map((i) => [i, instrumentNames[i]]),
      (v) => {
        instrument = v;
        activeCell = null;
      },
    );
    select(
      "laras",
      t.tuning,
      laras,
      [
        ["pelog", "Pelog"],
        ["slendro", "Slendro"],
      ],
      (v) => {
        laras = v;
        activeCell = null;
      },
    );
    const barSelect = select(
      "bar",
      t.bar,
      String(bar),
      Array.from({ length: gamelanBarCount(project) }, (_, i) => [
        String(i),
        String(i + 1),
      ]),
      (v) => {
        bar = Number(v);
        activeCell = null;
      },
    );
    button(
      t.add,
      () =>
        void studio.editProject((p) => appendGamelanBar(p, session.registry)),
      controls,
      busy || gamelanBarCount(project) >= 128,
    ).id = "gs-add-bar";
    select(
      "action",
      t.action,
      action,
      [
        ["strike", t.strike],
        ["damp", t.damp],
      ],
      (v) => {
        action = v;
        activeCell = null;
      },
    );
    const vl = node("label", t.velocity, controls),
      vi = node("input", undefined, vl);
    vi.id = "gs-velocity";
    vi.type = "number";
    vi.min = String(Number.MIN_VALUE);
    vi.max = "1";
    vi.step = "any";
    vi.required = true;
    vi.value = String(velocity);
    vi.disabled = busy || action === "damp";
    vi.onchange = () => {
      if (!vi.checkValidity() || !Number.isFinite(vi.valueAsNumber)) {
        vi.reportValidity();
        return;
      }
      velocity = vi.valueAsNumber;
      signature = "";
      render();
    };
    node(
      "p",
      instrumentNames[instrument] +
        " · " +
        (laras === "pelog" ? "Pelog" : "Slendro"),
    ).className = "gs-selection";
    const notes = physicalFocus(session.registry, instrument, laras),
      samples = new Set(notes.map((n) => n.descriptor.id)),
      bankId = notes[0]?.bank.id;
    const events = new Set(
        project.events.map((e) =>
          JSON.stringify([e.bankId, e.sampleId, e.tick, e.action]),
        ),
      ),
      offGridByBar = new Map();
    for (const e of project.events)
      if (
        e.bankId === bankId &&
        samples.has(e.sampleId) &&
        e.tick % GAMELAN_STEP_TICKS !== 0
      ) {
        const index = Math.floor(e.tick / GAMELAN_BAR_TICKS);
        offGridByBar.set(index, (offGridByBar.get(index) ?? 0) + 1);
      }
    const start = bar * GAMELAN_BAR_TICKS,
      end = start + GAMELAN_BAR_TICKS,
      offGrid = project.events.filter(
        (e) =>
          e.bankId === bankId &&
          samples.has(e.sampleId) &&
          e.tick >= start &&
          e.tick < end &&
          e.tick % GAMELAN_STEP_TICKS !== 0,
      ).length;
    const status = node(
      "p",
      `${t.total}: ${project.events.length}. ${t.retained}: ${offGrid}.`,
    );
    status.id = "gs-retained";
    status.setAttribute("role", "status");
    const hint = node("p", t.scroll);
    hint.id = "gs-grid-hint";
    const scroll = node("div");
    scroll.className = "gs-grid-scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", t.grid);
    scroll.setAttribute("aria-describedby", hint.id);
    const table = node("table", undefined, scroll);
    table.className = "gs-grid";
    const head = node("tr", undefined, node("thead", undefined, table));
    node("th", t.note, head).scope = "col";
    const headers = [],
      columns = Array.from({ length: 16 }, () => []),
      cells = [];
    for (let step = 0; step < 16; step++) {
      const h = node("th", String(step + 1), head);
      h.scope = "col";
      h.dataset.gsHead = String(step);
      headers.push(h);
    }
    const body = node("tbody", undefined, table);
    for (const note of notes) {
      const d = note.descriptor,
        row = node("tr", undefined, body),
        name =
          instrumentNames[instrument] +
          " " +
          padLabel({
            pitch: d.pitchId,
            instrument: d.instrumentId,
            articulation: d.articulation,
          });
      node("th", name, row).scope = "row";
      for (let step = 0; step < 16; step++) {
        const tick = start + step * GAMELAN_STEP_TICKS,
          pressed = project.events.some(
            (e) =>
              e.bankId === note.bank.id &&
              e.sampleId === d.id &&
              e.tick === tick &&
              e.action === action,
          ),
          cell = node("td", undefined, row),
          b = button(
            pressed ? (action === "strike" ? "●" : "×") : "·",
            () =>
              void studio.editProject((p) =>
                toggleGamelanStep(p, session.registry, {
                  bankId: note.bank.id,
                  version: note.bank.version,
                  sampleId: d.id,
                  bar,
                  step,
                  action,
                  velocity,
                }),
              ),
            cell,
          );
        b.dataset.gsStep = String(step);
        b.dataset.sampleId = d.id;
        b.dataset.bank = note.bank.id;
        b.dataset.step = [note.bank.id, d.id, bar, step, action].join("/");
        b.setAttribute("aria-pressed", String(pressed));
        b.setAttribute(
          "aria-label",
          `${name}, ${laras}, ${t.bar} ${bar + 1}, ${t.step} ${step + 1}, ${action === "strike" ? t.strike : t.damp}`,
        );
        b.tabIndex = b.dataset.step === activeCell ? 0 : -1;
        columns[step].push(b);
        cells.push({
          button: b,
          bankId: note.bank.id,
          sampleId: d.id,
          name,
          step,
        });
      }
    }
    if (!host.querySelector('[data-gs-step][tabindex="0"]'))
      host.querySelector("[data-gs-step]")?.setAttribute("tabindex", "0");
    if (!notes.length) node("p", t.empty);
    view = {
      project,
      display,
      barSelect,
      bar,
      action,
      laras,
      text: t,
      events,
      offGrid: offGridByBar,
      retained: status,
      cells,
      headers,
      columns,
      step: null,
      following: false,
      running: s.replaying,
      lastRepeat: s.repeating,
    };
    focus.restore(saved);
    updateControls(s, bridge, t, busy, hardBusy, hybrid);
    position.update();
  }
  return { render, dispose: () => position.dispose() };
}
