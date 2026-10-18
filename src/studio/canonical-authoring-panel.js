import {
  startSongChain,
  cloneSongPattern,
  newSongPattern,
  selectSongPattern,
  renameSongPattern,
  setSongLength,
  setSongPlacement,
  deleteSongPattern,
  appendSongPattern,
  editSongChain,
  newRhythmPattern,
  deleteRhythmPattern,
  moveSongPattern,
  moveRhythmPattern,
} from "../project/canonical-authoring.js";
import { PPQ } from "../project/instrument-project.js";

export function initCanonicalAuthoringPanel({
  root,
  editor,
  mutate,
  locale,
  readView,
  readSource,
  signal,
}) {
  const en = locale === "en",
    say = (id, english) => (en ? english : id);
  const el = (tag, text = "", attrs = {}) => {
    const e = document.createElement(tag);
    e.textContent = text;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const box = el("section", "", {
    class: "st-panel can-authoring",
    "data-canonical-authoring": "",
  });
  root.querySelector(".studio-workspace").before(box);
  const command = (fn) => mutate(() => editor.edit(fn));
  const button = (label, action, disabled = false, attrs = {}) => {
    const b = el("button", label, { type: "button", ...attrs });
    b.dataset.authoringBlocked = String(disabled);
    b.disabled = disabled;
    b.onclick = action;
    return b;
  };
  const label = (text, input) => {
    const l = el("label", text);
    l.append(input);
    return l;
  };
  const field = (type, value, attrs = {}) => {
    const input = el("input", "", { type, ...attrs });
    if (type === "checkbox") input.checked = value;
    else input.value = value;
    return input;
  };
  function render() {
    const p = editor.snapshot().project,
      s = p.sections.find((s) => s.id === p.activeSection),
      finite = p.transport.kind === "chain";
    box.replaceChildren(
      el("h2", say("Pola lagu & Rantai Pola", "Song patterns & Pattern Chain")),
    );
    box.append(
      el(
        "p",
        say(
          "Pilih pola lagu untuk mengedit. Putar mengikuti rantai di bawah.",
          "Select a song pattern to edit. Play follows the chain below.",
        ),
      ),
      el(
        "p",
        say(
          "Duplikat pola lagu menyalin irama, not, dan pengaturan Loop secara mandiri. Mixer sumber berlaku bersama untuk seluruh lagu; track overdub hasil duplikasi memiliki mixer sendiri.",
          "Duplicate song pattern copies rhythms, notes and Loop settings independently. Source mixers apply across the song; duplicated overdub tracks have their own mixer.",
        ),
      ),
    );
    if (!finite) {
      const bars = el("select", "", {
        "data-song-window": "",
        "aria-label": say("Jendela rantai Loop", "Loop chain window"),
      });
      for (const n of [4, 8]) bars.add(new Option(n + say(" bar", " bars"), n));
      if (p.transport.kind === "legacy-continuous")
        box.append(
          label(
            say("Jendela Loop untuk rantai", "Loop window for chain"),
            bars,
          ),
        );
      box.append(
        button(
          say("Mulai Rantai Pola lagu", "Start song Pattern Chain"),
          () => command((p) => startSongChain(p, Number(bars.value))),
          false,
          { "data-song-start": "" },
        ),
      );
      box.append(
        el(
          "p",
          say(
            "Pilih tindakan ini untuk memakai durasi pola lagu sebagai urutan terbatas. Sumber asli tetap tersimpan.",
            "Choose this action to use song-pattern durations as a finite arrangement. Original sources remain preserved.",
          ),
        ),
      );
    }
    const select = el("select", "", {
      "data-song-select": "",
      "aria-label": say("Pola lagu aktif", "Active song pattern"),
    });
    for (const row of p.sections) select.add(new Option(row.name, row.id));
    select.value = s.id;
    select.onchange = () => command((p) => selectSongPattern(p, select.value));
    box.append(label(say("Pola lagu aktif", "Active song pattern"), select));
    const name = field("text", s.name, { "data-song-name": "", maxlength: 80 });
    box.append(
      label(say("Nama pola lagu", "Song-pattern name"), name),
      button(
        say("Ganti nama", "Rename"),
        () => command((p) => renameSongPattern(p, name.value)),
        false,
        { "data-song-rename": "" },
      ),
    );
    const operations = el("div", "", { class: "can-authoring-actions" });
    const position = p.sections.findIndex((row) => row.id === s.id);
    operations.append(
      button(
        say("Pola lebih awal", "Pattern earlier"),
        () => command((p) => moveSongPattern(p, -1)),
        !finite || position === 0,
        { "data-song-pattern-up": "" },
      ),
      button(
        say("Pola lebih akhir", "Pattern later"),
        () => command((p) => moveSongPattern(p, 1)),
        !finite || position === p.sections.length - 1,
        { "data-song-pattern-down": "" },
      ),
    );
    operations.append(
      button(
        say("Pola lagu baru", "New song pattern"),
        () =>
          command((p) =>
            newSongPattern(
              p,
              say("Pola kosong ", "Empty pattern ") + (p.sections.length + 1),
            ),
          ),
        !finite || p.sections.length >= 16,
        { "data-song-new": "" },
      ),
      button(
        say("Duplikat pola lagu", "Duplicate song pattern"),
        () =>
          command((p) =>
            cloneSongPattern(p, s.name + say(" salinan", " copy")),
          ),
        !finite || p.sections.length >= 16,
        { "data-song-duplicate": "" },
      ),
      button(
        say(
          "Hapus pola lagu & urutannya",
          "Delete song pattern & its occurrences",
        ),
        () => command(deleteSongPattern),
        !finite || p.sections.length <= 1,
        { "data-song-delete": "" },
      ),
    );
    box.append(operations);
    const beats = field("number", s.lengthTicks / PPQ, {
      min: 1,
      step: "any",
      "data-song-beats": "",
    });
    beats.dataset.authoringBlocked = String(!finite);
    box.append(
      label(
        say("Durasi pola lagu (beat)", "Song-pattern duration (beats)"),
        beats,
      ),
      button(
        say("Terapkan durasi pola", "Apply pattern duration"),
        () =>
          command((p) =>
            setSongLength(p, Math.round(Number(beats.value) * PPQ)),
          ),
        !finite,
        { "data-song-length": "" },
      ),
    );
    const placements = el("div", "", { "data-song-placements": "" });
    for (const a of s.placements) {
      const bus = p.tracks.find((t) => t.id === a.trackId),
        row = el("fieldset", "", { "data-song-placement": a.id });
      row.append(el("legend", bus.name + " / " + a.sourceRef.kind));
      row.append(
        el(
          "p",
          `${say("Awal", "Start")}: ${a.startTick / PPQ} · ${say("Periode sumber", "Source period")}: ${a.lengthTicks / PPQ} beat`,
        ),
      );
      const loop = field("checkbox", a.loop, { "data-song-loop": "" });
      loop.dataset.authoringBlocked = String(!finite || a.alignment !== null);
      if (a.alignment !== null)
        loop.title = say(
          "Rekaman dengan alignment mempertahankan periode Loop aslinya",
          "Aligned recording retains its original Loop period",
        );
      loop.onchange = () =>
        command((p) => setSongPlacement(p, a.id, "loop", loop.checked));
      const phase = el("select", "", { "data-song-phase": "" });
      phase.dataset.authoringBlocked = String(!finite);
      for (const [value, text] of [
        ["continuous", say("Lanjut fase sumber", "Continue source phase")],
        ["restart-on-entry", say("Mulai ulang saat masuk", "Restart on entry")],
      ])
        phase.add(new Option(text, value));
      phase.value = a.phasePolicy;
      phase.onchange = () =>
        command((p) => setSongPlacement(p, a.id, "phasePolicy", phase.value));
      row.append(
        label(
          say("Loop sepanjang pola lagu", "Loop through song pattern"),
          loop,
        ),
      );
      if (a.sourceRef.kind === "working")
        row.append(label(say("Fase saat masuk", "Entry phase"), phase));
      placements.append(row);
    }
    if (!s.placements.length)
      placements.append(
        el(
          "p",
          say(
            "Pola kosong. Gunakan Tambah materi ke Studio untuk mengisinya.",
            "Empty pattern. Use Add material to Studio to fill it.",
          ),
        ),
      );
    box.append(
      placements,
      el("h3", say("Rantai pola lagu", "Song-pattern chain")),
    );
    const count = p.chain.reduce((n, r) => n + r.repeats, 0);
    box.append(
      el(
        "p",
        `${count}/8 ${say("urutan termasuk pengulangan", "occurrences including repeats")}`,
      ),
    );
    box.append(
      button(
        say("Tambah pola lagu aktif ke rantai", "Append active song pattern"),
        () => command(appendSongPattern),
        !finite || count >= 8,
        { "data-song-append": "" },
      ),
    );
    const chain = el("ol", "", { "data-song-chain": "" });
    p.chain.forEach((r, index) => {
      const row = el("li", "", { "data-song-entry": index }),
        section = p.sections.find((s) => s.id === r.sectionId);
      const repeats = field("number", r.repeats, {
        min: 1,
        max: 8 - count + r.repeats,
        step: 1,
        "data-song-repeats": "",
        "aria-label": say("Pengulangan", "Repeats"),
      });
      repeats.onchange = () =>
        command((p) =>
          editSongChain(p, index, "repeats", Number(repeats.value)),
        );
      row.append(
        button(
          section.name,
          () => command((p) => selectSongPattern(p, section.id)),
          false,
          { "data-song-entry-select": "" },
        ),
        label(say("Ulang", "Repeats"), repeats),
        button(
          "↑",
          () => command((p) => editSongChain(p, index, "move", -1)),
          index === 0,
          {
            "data-song-up": "",
            "aria-label": say("Geser lebih awal", "Move earlier"),
          },
        ),
        button(
          "↓",
          () => command((p) => editSongChain(p, index, "move", 1)),
          index === p.chain.length - 1,
          {
            "data-song-down": "",
            "aria-label": say("Geser lebih akhir", "Move later"),
          },
        ),
        button(
          say("Hapus urutan", "Remove occurrence"),
          () => command((p) => editSongChain(p, index, "remove")),
          p.chain.length <= 1,
          { "data-song-remove": "" },
        ),
      );
      chain.append(row);
    });
    box.append(chain);
    renderRhythm();
  }
  function renderRhythm() {
    const sourceId = readSource();
    if (!sourceId) return;
    const view = readView(),
      list = root.querySelector("#st-chain-list");
    const chain = el("ol", "", { class: "can-rhythm-chain" });
    view.chain.forEach((id, index) => {
      const row = el("li"),
        a = view.patterns.find((a) => a.id === id);
      const update = (direction) => {
        const ids = [...view.chain];
        [ids[index], ids[index + direction]] = [
          ids[index + direction],
          ids[index],
        ];
        return mutate(() => editor.setChain(sourceId, ids));
      };
      row.append(
        button(
          a.name,
          () => mutate(() => editor.selectPattern(sourceId, id)),
          false,
          { "data-rhythm-select": index },
        ),
        button("↑", () => update(-1), index === 0, {
          "data-rhythm-up": index,
          "aria-label": say("Geser irama lebih awal", "Move rhythm earlier"),
        }),
        button("↓", () => update(1), index === view.chain.length - 1, {
          "data-rhythm-down": index,
          "aria-label": say("Geser irama lebih akhir", "Move rhythm later"),
        }),
        button(
          say("Hapus urutan", "Remove occurrence"),
          () =>
            mutate(() =>
              editor.setChain(
                sourceId,
                view.chain.filter((_, i) => i !== index),
              ),
            ),
          view.chain.length <= 1,
          { "data-rhythm-remove": index },
        ),
      );
      chain.append(row);
    });
    list.replaceChildren(
      el(
        "h4",
        say(
          "Rantai pola irama · 1 bar per urutan",
          "Rhythm-pattern chain · 1 bar per occurrence",
        ),
      ),
      chain,
    );
    list.dataset.canonicalAuthoring = "";
    list.append(
      el(
        "p",
        say(
          "Untuk menghapus definisi pola irama, hapus semua urutannya dari rantai dahulu.",
          "To delete a rhythm-pattern definition, remove all its chain occurrences first.",
        ),
      ),
    );
    const index = view.patterns.findIndex((a) => a.id === view.activePattern);
    list.append(
      button(
        say("Pola irama lebih awal", "Rhythm pattern earlier"),
        () => command((p) => moveRhythmPattern(p, sourceId, -1)),
        index === 0,
        { "data-rhythm-pattern-up": "" },
      ),
      button(
        say("Pola irama lebih akhir", "Rhythm pattern later"),
        () => command((p) => moveRhythmPattern(p, sourceId, 1)),
        index === view.patterns.length - 1,
        { "data-rhythm-pattern-down": "" },
      ),
    );
  }
  const rhythmNew = root.querySelector("#st-new"),
    rhythmDelete = root.querySelector("#st-delete-pattern");
  root.querySelector("#st-duplicate").textContent = say(
    "Duplikat pola irama",
    "Duplicate rhythm pattern",
  );
  root.querySelector("#st-rename").textContent = say(
    "Ganti nama irama",
    "Rename rhythm",
  );
  root.querySelector("#st-add-chain").textContent = say(
    "Tambah irama ke rantai",
    "Append rhythm to chain",
  );
  root
    .querySelector("#st-pattern")
    .setAttribute(
      "aria-label",
      say("Pola irama aktif", "Active rhythm pattern"),
    );
  rhythmNew.textContent = say("Pola irama baru", "New rhythm pattern");
  rhythmDelete.textContent = say("Hapus pola irama", "Delete rhythm pattern");
  rhythmDelete.title = say(
    "Hapus semua urutannya dari rantai terlebih dahulu",
    "Remove all its chain occurrences first",
  );
  rhythmNew.addEventListener(
    "click",
    () => {
      const view = readView();
      let i = 1;
      while (view.patterns.some((a) => a.id === "rhythm-" + i)) i++;
      return command((p) =>
        newRhythmPattern(
          p,
          readSource(),
          "rhythm-" + i,
          say("Irama ", "Rhythm ") + (view.patterns.length + 1),
        ),
      );
    },
    { signal },
  );
  rhythmDelete.addEventListener(
    "click",
    () => command((p) => deleteRhythmPattern(p, readSource())),
    { signal },
  );
  return {
    render,
    locks(locked) {
      root
        .querySelectorAll(
          "[data-canonical-authoring] button,[data-canonical-authoring] input,[data-canonical-authoring] select",
        )
        .forEach((e) => {
          e.disabled = locked || e.dataset.authoringBlocked === "true";
        });
      const view = readSource() ? readView() : null;
      rhythmNew.disabled = locked || !view || view.patterns.length >= 16;
      rhythmDelete.disabled =
        locked ||
        !view ||
        view.patterns.length <= 1 ||
        view.chain.includes(view.activePattern);
    },
  };
}
