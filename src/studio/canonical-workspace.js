import "./canonical-workspace.css";
import { initCanonicalStudioPanel } from "./canonical-panel.js";
import {
  createCanonicalEditor,
  canonicalEditorView,
} from "./canonical-editor.js";
import { createCanonicalWorkflow } from "./canonical-workflow.js";
import { CanonicalStorage } from "../project/canonical-storage.js";
import { newComposition } from "../project/composition-model.js";
import { PPQ } from "../project/instrument-project.js";
import { beatboxMessages } from "../beatbox/messages.js";
import { canonicalDocumentCredits } from "../project/canonical-credits.js";
import { studioMessages, studioRoleNames } from "./messages.js";
import { compositionRegistry } from "../project/studio-registry.js";
const text = {
  id: {
    note: "Studio terpadu Preview: edit pola, susun rantai, lalu Putar untuk menyiapkan perubahan.",
    source: "Sumber irama · pola lagu aktif",
    beatbox: "Beatbox per pola",
    on: "Aktif",
    variant: "Variasi",
    volume: "Level",
    pan: "Pan",
    mute: "Bisukan",
    solo: "Solo",
    phase: "Fase",
    continue: "Lanjut sumber",
    restart: "Mulai ulang",
    bilah: "Bilah: pilih nada lalu ketuk langkah",
    native: "Not instrumen",
    position: "Beat absolut",
    velocity: "Kekuatan",
    apply: "Terapkan not",
    reset: "Mulai rantai irama dari pola ini",
    saved: "Tersimpan lokal",
    loaded: "Proyek dipulihkan",
    imported: "Impor selesai",
    saving: "Menyimpan…",
    loading: "Memulihkan…",
    importing: "Memeriksa berkas…",
    idle: "Siap",
    error: "Gagal; proyek sebelumnya tetap tersedia",
    original: "Unduh sumber asli",
    input: "Unduh berkas impor",
    ready: "WAV siap diunduh",
    download: "Unduh proyek lengkap",
    load: "Pulihkan proyek lokal",
    add: "Tambah materi ke Studio",
    buses: "Mixer sumber · seluruh lagu",
    length: "Durasi instrumen (beat)",
    lengthApply: "Terapkan durasi",
    archive: "Berkas sumber tersimpan",
    archiveDownload: "Unduh berkas sumber",
    window: "Jendela Loop",
    hubNote:
      "Tambah materi menyalin track berisi ke bagian aktif dengan BPM sama. Loop mengikuti durasi bagian; sumber lengkap disimpan untuk diunduh kembali.",
    unsaved: "Sesi berubah. Simpan sebelum memuat ulang atau menutup tab.",
    sound: "Rekaman sumber",
    action: "Tindakan",
    strike: "Pukul",
    damp: "Redam",
    addEvent: "Tambah not",
    deleteEvent: "Hapus not terpilih",
    capture:
      "Rekam permainan atau mic di Loop Station, atau buat skor di Gamelan, lalu gunakan Lanjutkan ke Studio utama. Sumber dan take disalin melalui transfer yang aman.",
  },
  en: {
    note: "Unified Studio Preview: edit patterns, build a chain, then Play to prepare the changes.",
    source: "Rhythm source · active song pattern",
    beatbox: "Beatbox per pattern",
    on: "Enabled",
    variant: "Variant",
    volume: "Level",
    pan: "Pan",
    mute: "Mute",
    solo: "Solo",
    phase: "Phase",
    continue: "Continue source",
    restart: "Restart on entry",
    bilah: "Bilah: choose a pitch, then tap a step",
    native: "Instrument events",
    position: "Absolute beat",
    velocity: "Velocity",
    apply: "Apply event",
    reset: "Start rhythm chain from this pattern",
    saved: "Saved locally",
    loaded: "Project recovered",
    imported: "Import complete",
    saving: "Saving…",
    loading: "Recovering…",
    importing: "Checking file…",
    idle: "Ready",
    error: "Failed; previous project remains available",
    original: "Download original source",
    input: "Download imported file",
    ready: "WAV ready to download",
    download: "Download complete project",
    load: "Recover local project",
    add: "Add material to Studio",
    buses: "Source mixer · whole song",
    length: "Instrument duration (beats)",
    lengthApply: "Apply duration",
    archive: "Preserved source files",
    archiveDownload: "Download source file",
    window: "Loop window",
    hubNote:
      "Add material copies nonempty tracks into the active section at the same BPM. Loops follow section duration; the complete source file remains available to download.",
    unsaved: "The session changed. Save before reloading or closing this tab.",
    sound: "Source recording",
    action: "Action",
    strike: "Strike",
    damp: "Damp",
    addEvent: "Add event",
    deleteEvent: "Delete selected event",
    capture:
      "Record instruments or mic in Loop Station, or author a Gamelan score, then Continue to main Studio. Sources and takes use the acknowledged transfer.",
  },
};
const safe = (title, ext) =>
  (String(title)
    .normalize("NFKD")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .slice(0, 60) || "perkusi") +
  "." +
  ext;
export async function initCanonicalEditableStudio({
  root,
  bundle,
  registry,
  memory,
  createOwner,
  storage = new CanonicalStorage({ registry, memory }),
  recover = false,
  deliver = null,
  locale = document.documentElement.lang,
  noticeSuffix = "",
  loadDemo = null,
  sourceRights = [],
} = {}) {
  const c = text[locale] ?? text.id,
    $ = (id) => root.querySelector("#st-" + id),
    life = new AbortController(),
    pending = new Set(),
    urls = new Map(),
    observers = new Set();
  const cancelled = locale === "en" ? "Cancelled" : "Dibatalkan",
    cancelling = locale === "en" ? "Cancelling…" : "Membatalkan…";
  let panel,
    authoring,
    tuningControl,
    editor,
    workflow,
    sourceId =
      bundle.project.sourceDefs.find((d) => d.kind === "composition")?.id ??
      null,
    busy = 0,
    disposed = false,
    cloneIndex = 0,
    selectedPitch = "d4",
    checkpointRevision = 0;
  let importMode = "replace";
  // The canonical branch returns before the legacy engine initializer. Localize
  // its shared HTML shell here too, including explicit ?lang= on the ID route.
  const shell = studioMessages[locale] ?? studioMessages.id;
  for (const el of root.querySelectorAll("[data-st-copy]"))
    if (typeof shell[el.dataset.stCopy] === "string")
      el.textContent = shell[el.dataset.stCopy];
  for (const el of root.querySelectorAll("[data-st-role]"))
    el.textContent =
      studioRoleNames[locale === "en" ? "en" : "id"][Number(el.dataset.stRole)];
  $("kit").replaceChildren(
    ...compositionRegistry.kits.map(
      (k) => new Option(shell[k.id] ?? k.name ?? k.id, k.id),
    ),
  );
  root.querySelector(".st-guide").setAttribute("aria-label", shell.quick);
  root
    .querySelector(".st-grid-scroll")
    .setAttribute("aria-label", shell.sequencer);
  root.querySelector(".st-transport").setAttribute("aria-label", shell.tempo);
  for (const el of root.querySelectorAll("[data-st-step]")) {
    const [role, step] = el.dataset.stStep.split(":"),
      i = compositionRegistry.roleOrder.indexOf(role);
    el.setAttribute(
      "aria-label",
      studioRoleNames[locale === "en" ? "en" : "id"][i] +
        " / " +
        shell.step +
        " " +
        (Number(step) + 1),
    );
  }
  const status = (s, error = false) => {
    $("project-status").textContent = s;
    $("project-status").setAttribute("role", error ? "alert" : "status");
  };
  const ui = (tag, attrs = {}, value = "") => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else el.setAttribute(k, v);
    }
    el.textContent = value;
    return el;
  };
  const chooseSource = () => {
    const rows = workingSources().filter((d) => d.kind === "composition");
    if (!rows.some((d) => d.id === sourceId)) sourceId = rows[0]?.id ?? null;
    return sourceId;
  };
  function workingSources() {
    const p = editor.snapshot().project,
      ids = new Set(
        p.sections
          .filter((s) => s.id === p.activeSection)
          .flatMap((s) =>
            s.placements
              .filter((p) => p.sourceRef.kind !== "asset")
              .map((p) => p.sourceRef.id),
          ),
      );
    for (const d of p.sourceDefs)
      if (ids.has(d.id) && d.kind === "instrument-events")
        ids.add(d.programme.accompanimentRef);
    return p.sourceDefs.filter((d) => ids.has(d.id));
  }
  const readView = () => {
    const p = editor.snapshot().project;
    if (chooseSource()) return canonicalEditorView(p, sourceId);
    const view = newComposition();
    return {
      ...view,
        title: p.title,
      timing: { ...view.timing, bpm: p.timing.bpm, meter: p.timing.meter },
      master: p.master,
    };
  };
  const withTask = (fn) => {
    const task = Promise.resolve().then(fn);
    pending.add(task);
    task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  };
  const showError = (e) => {
    const reasons =
      locale === "en"
        ? {
            hubTempoConflict: "Match the source BPM before adding material.",
            hubLimiterUnsupported:
              "The source limiter is active. Open the source, explicitly bypass its limiter, export it, then add that copy.",
            hubClockConflict:
              "Source clocks differ; the original timing is preserved.",
            hubRegionUnsupported:
              "Extend the native duration to cover its accompaniment before adding material.",
            hubTrackLimit: "The combined project exceeds eight source tracks.",
            takeRateMismatch:
              "This recording requires its original sample rate.",
            songChainRequired: "Start the song Pattern Chain first.",
            songWindowTooShort:
              "Extend this song pattern to contain its complete material.",
            patternInChain:
              "Remove this rhythm pattern from its chain before deleting it.",
            songSourceLimit:
              "Independent pattern copies exceed the 32 source-definition limit.",
            loopPeriodMismatch:
              "The Loop window must contain whole original recording periods.",
            legacyRegionUnsupported:
              "Loop the complete source period; its original timing is preserved.",
            chainLimit:
              "A chain supports up to eight occurrences including repeats.",
            alignedLoopRequired:
              "An aligned recording retains its original Loop period.",
            sharedPatternSource:
              "This imported source is shared by song patterns. Duplicate the song pattern to edit an independent copy.",
            recordedTempoLocked:
              "Recorded clips and Beatbox phrases keep their original tempo. Tempo editing is available for musical-clock scores without these sources.",
            invalidNativeEdit:
              "Choose an existing source recording and an event within the score duration.",
            nativeEventCollision:
              "That source/action already exists at this beat. Choose another position or edit the selected event.",
          }
        : {
            hubTempoConflict: "Samakan BPM sumber sebelum menambahkan materi.",
            hubLimiterUnsupported:
              "Limiter sumber aktif. Buka sumber, pilih lewati limiter, ekspor, lalu tambahkan salinan itu.",
            hubClockConflict:
              "Clock sumber berbeda; timing asli tetap dipertahankan.",
            hubRegionUnsupported:
              "Perpanjang durasi instrumen agar mencakup pengiring sebelum menambahkan materi.",
            hubTrackLimit: "Gabungan melebihi delapan track sumber.",
            takeRateMismatch: "Rekaman ini memerlukan sample rate aslinya.",
            songChainRequired: "Mulai Rantai Pola lagu terlebih dahulu.",
            songWindowTooShort:
              "Perpanjang pola lagu agar seluruh materinya termuat.",
            patternInChain:
              "Hapus pola irama dari rantainya sebelum menghapus pola.",
            songSourceLimit:
              "Salinan pola mandiri melampaui batas 32 definisi sumber.",
            loopPeriodMismatch:
              "Jendela Loop harus memuat periode rekaman asli secara utuh.",
            legacyRegionUnsupported:
              "Loop harus memakai periode sumber lengkap; timing asli dipertahankan.",
            chainLimit:
              "Rantai mendukung hingga delapan urutan termasuk pengulangan.",
            alignedLoopRequired:
              "Rekaman dengan alignment mempertahankan periode Loop aslinya.",
            sharedPatternSource:
              "Sumber impor ini dipakai bersama oleh beberapa pola lagu. Duplikat pola lagu untuk mengedit salinan mandiri.",
            recordedTempoLocked:
              "Klip rekaman dan phrase Beatbox mempertahankan tempo aslinya. Tempo dapat diedit untuk skor dengan clock musikal tanpa sumber tersebut.",
            invalidNativeEdit:
              "Pilih rekaman sumber yang tersedia dan not dalam durasi skor.",
            nativeEventCollision:
              "Sumber/tindakan itu sudah ada pada beat ini. Pilih posisi lain atau edit not terpilih.",
          };
    root.dataset.canonicalError = e.code ?? e.message;
    status(
      e.code === "cancelled"
        ? locale === "en"
          ? "Cancelled"
          : "Dibatalkan"
        : (reasons[e.code] ?? c.error),
      e.code !== "cancelled",
    );
  };
  const transaction = (fn) =>
    withTask(async () => {
      busy++;
      locks();
      try {
        await fn();
      } finally {
        busy--;
        render();
      }
    });
  const mutate = (fn) => transaction(fn).catch(showError);
  const deliverBlob = async (blob, name) => {
    if (disposed) throw Error("cancelled");
    const held = memory.reserve(blob.size + 4096, "canonical/file-delivery");
    try {
      if (deliver) return await deliver(blob, name);
      await new Promise((resolve, reject) => {
        let url;
        try {
          url = URL.createObjectURL(blob);
          const a = ui("a", { href: url, download: name });
          document.body.append(a);
          a.click();
          a.remove();
          const done = () => {
            clearTimeout(urls.get(url)?.timer);
            URL.revokeObjectURL(url);
            urls.delete(url);
            resolve();
          };
          urls.set(url, { done, timer: setTimeout(done, 1200) });
        } catch (e) {
          if (url) URL.revokeObjectURL(url);
          reject(e);
        }
      });
    } finally {
      held.release();
    }
  };
  editor = await createCanonicalEditor(bundle, {
    registry,
    memory,
    controller: {
      edited: () => panel?.controller.edited(),
      stop: () => panel?.controller.stop(),
    },
    onChange: () => render(),
  });
  panel = initCanonicalStudioPanel({
    root,
    locale,
    readDocument: () => editor.snapshot().project,
    readView,
    createOwner: (options) =>
      createOwner({ ...options, bundle: editor.snapshot().bundle }),
    onWav: (wav, request) =>
      deliverBlob(
        wav.output.blob,
        safe(request?.title ?? editor.snapshot().project.title, "wav"),
      ),
    wavReadyText: c.ready,
    onTransport: () => locks(),
  });
  const extras = ui("section", { class: "st-panel canonical-material" }),
    sourceLabel = ui("label", {}, c.source),
    source = ui("select", { "data-can-source": "", "data-can-edit": "" });
  sourceLabel.append(source);
  extras.append(sourceLabel);
  const beatbox = ui("div", { "data-can-beatbox": "" }),
    bilah = ui("div", { "data-can-bilah": "" }),
    native = ui("div", { "data-can-native": "" });
  extras.append(
    ui("h3", {}, c.beatbox),
    beatbox,
    ui("h3", {}, c.bilah),
    bilah,
    ui("h3", {}, c.native),
    native,
  );
  const buses = ui("div", { "data-can-buses": "" });
  extras.append(ui("h3", {}, c.buses), buses);
  root.querySelector(".studio-workspace").after(extras);
  const unsaved = ui(
      "p",
      { "data-can-unsaved": "", role: "status" },
      c.unsaved,
    ),
    captureHint = ui("p", { class: "st-hint" }, c.capture);
  extras.prepend(captureHint);
  for (const [path, label, data] of [
    ["loop-station", "Loop Station", "data-loop-link"],
    ["gamelan", "Gamelan", "data-gamelan-link"],
  ]) {
    captureHint.append(
      " ",
      ui(
        "a",
        {
          href:
            (locale === "en" ? "/en" : "") +
            "/" +
            path +
            "/?candidate=canonical&lang=" +
            locale,
          [data]: "",
        },
        label,
      ),
    );
  }
  $("project-status").after(unsaved);
  const credits = ui("details", { class: "st-panel", "data-can-credits": "" }),
    creditList = ui("ul");
  credits.append(
    ui(
      "summary",
      {},
      locale === "en" ? "Sources and licenses" : "Sumber dan lisensi",
    ),
    creditList,
  );
  extras.after(credits);
  const reset = ui(
    "button",
    { type: "button", "data-can-reset": "", "data-can-edit": "" },
    c.reset,
  );
  $("chain-list").after(reset);
  const original = ui(
      "button",
      { type: "button", "data-can-original": "" },
      c.original,
    ),
    inputBackup = ui(
      "button",
      { type: "button", "data-can-input": "" },
      c.input,
    );
  $("project-download").after(original, inputBackup);
  const addMaterial = ui(
      "button",
      { type: "button", "data-can-add": "" },
      c.add,
    ),
    windowSelect = ui("select", { "data-can-window": "" }),
    archiveSelect = ui("select", { "data-can-archive": "" }),
    archiveDownload = ui(
      "button",
      { type: "button", "data-can-archive-download": "" },
      c.archiveDownload,
    );
  for (const n of [4, 8])
    windowSelect.add(
      new Option(n + (locale === "en" ? " bars" : " bar"), String(n)),
    );
  const windowLabel = ui("label", {}, c.window),
    archiveLabel = ui("label", {}, c.archive);
  windowLabel.append(windowSelect);
  archiveLabel.append(archiveSelect);
  const limiterLabel = ui(
      "label",
      {},
      locale === "en" ? "Bypass shared limiter" : "Lewati limiter bersama",
    ),
    limiter = ui("input", {
      type: "checkbox",
      "data-can-limiter": "",
      "data-can-edit": "",
      "data-can-global": "",
    });
  limiterLabel.append(limiter);
  $("import").after(
    addMaterial,
    windowLabel,
    archiveLabel,
    archiveDownload,
    limiterLabel,
    ui("p", {}, c.hubNote),
  );
  $("project-download").textContent = c.download;
  if (loadDemo) {
    $("demo-kind").replaceChildren(
      new Option(
        locale === "en" ? "Evening Conversation" : "Percakapan Senja",
        "flagship",
      ),
    );
  }
  $("load").textContent = c.load;
  $("saved").replaceChildren(new Option(c.load, "current"));
  $("file").accept = ".perkusi,.json,application/octet-stream,application/json";
  root.querySelector('[data-st-copy="fileHint"]').textContent =
    locale === "en"
      ? "Open an older project or a complete .perkusi file. Original sources and timing are preserved."
      : "Buka proyek lama atau berkas .perkusi lengkap. Sumber asli dan timing tetap disimpan.";
  workflow = createCanonicalWorkflow({
    editor,
    storage,
    registry,
    memory,
    onChange: (s) => {
      if (s.status === "saved" || s.status === "loaded")
        checkpointRevision = editor.snapshot().revision;
      if (s.status === "error") showError({ code: s.error });
      else
        status(
          c[s.status] ??
            (s.status === "cancelled"
              ? cancelled
              : s.status === "cancelling"
                ? cancelling
                : c.idle),
        );
      locks();
    },
  });
  function locks() {
    if (!panel || !editor) return;
    if (disposed) {
      root
        .querySelectorAll("button,input,select")
        .forEach((el) => (el.disabled = true));
      return;
    }
    const s = panel.controller.snapshot(),
      locked = disposed || busy > 0 || s.status === "cleanup-pending";
    const dirty = editor.snapshot().revision !== checkpointRevision;
    root.dataset.canonicalDirty = String(dirty);
    unsaved.hidden = !dirty;
    for (const el of root.querySelectorAll("[data-can-edit]"))
      el.disabled =
        locked || (!sourceId && !el.hasAttribute("data-can-global"));
    for (const id of [
      "title",
      "master",
      "pattern",
      "pattern-name",
      "rename",
      "duplicate",
      "add-chain",
      "undo",
      "redo",
      "save",
      "load",
      "project-download",
      "import",
      "file",
      "bpm",
    ])
      $(id).disabled = locked;
    $("undo").disabled = locked || !editor.snapshot().canUndo;
    $("redo").disabled = locked || !editor.snapshot().canRedo;
    $("demo-kind").disabled = locked || !loadDemo;
    $("demo").disabled = locked || !loadDemo;
    for (const el of root.querySelectorAll(
      "[data-st-step], [data-st-volume], [data-st-pan], [data-st-mute], [data-st-solo]",
    ))
      el.disabled = locked || !sourceId;
    $("play").disabled = locked || s.closed || s.status === "preparing";
    $("pause").disabled = locked || s.status !== "playing";
    $("stop").disabled = disposed || s.pendingOwners === 0;
    original.disabled = locked;
    addMaterial.disabled = locked;
    windowSelect.disabled = locked;
    archiveSelect.disabled = locked;
    archiveDownload.disabled = locked || !archiveSelect.options.length;
    inputBackup.disabled = locked || !workflow?.snapshot().inputBackup;
    $("render").disabled = locked || panel.exporting || !s.capability;
    $("cancel").hidden = !(workflow?.snapshot().pending || panel.exporting);
    $("cancel").disabled = disposed || $("cancel").hidden;
    if (sourceId) {
      const view = readView();
      $("duplicate").disabled = locked || view.patterns.length >= 16;
      $("add-chain").disabled = locked || view.chain.length >= 8;
      for (const el of root.querySelectorAll("[data-can-remove-chain]"))
        el.disabled = locked || view.chain.length <= 1;
    } else
      for (const id of [
        "pattern",
        "pattern-name",
        "rename",
        "duplicate",
        "add-chain",
      ])
        $(id).disabled = true;
    $("swing").disabled = locked || !sourceId;
    $("kit").disabled = locked || !sourceId;
    for (const box of root.querySelectorAll("[data-can-native-source]")) {
      const empty = !box.querySelector("[data-can-event]").options.length;
      box.querySelector("[data-can-apply-native]").disabled = locked || empty;
      box.querySelector("[data-can-delete-native]").disabled = locked || empty;
      box.querySelector("[data-can-add-native]").disabled =
        locked || !box.querySelector("[data-can-event-sound]").options.length;
    }
    authoring?.locks(locked);
    tuningControl?.sync({ locked, error: s.error });
  }
  function render() {
    if (!panel || disposed) return;
    root.dataset.canonicalRevision = String(editor.snapshot().revision);
    panel.refresh();
    chooseSource();
    const document = editor.snapshot().project;
    if (document.transport.kind === "chain") {
      const ticks = document.chain.reduce(
        (n, item) =>
          n +
          document.sections.find((s) => s.id === item.sectionId).lengthTicks *
            item.repeats,
        0,
      );
      $("duration").textContent =
        (((ticks / PPQ) * 60) / document.timing.bpm).toFixed(2) + " s";
    }
    root.querySelector("[data-canonical-notice]").textContent =
      c.note + noticeSuffix;
    source.replaceChildren(
      ...workingSources()
        .filter((d) => d.kind === "composition")
        .map((d) => new Option(d.programme.title, d.id)),
    );
    source.value = sourceId ?? "";
    beatbox.replaceChildren();
    bilah.replaceChildren();
    native.replaceChildren();
    buses.replaceChildren();
    const current = editor.snapshot().bundle;
    creditList.replaceChildren();
    for (const row of canonicalDocumentCredits(current.project, sourceRights)) {
      const r = row.request,
        rights = row.rights,
        attribution = rights.attribution,
        label =
          r.kind === "instrument"
            ? r.bankId + " / " + r.sampleId
            : (r.pack?.id ?? r.kind) + " / " + (r.role ?? r.pitch),
        item = ui(
          "li",
          { "data-can-credit": rights.sourceWorkId },
          (attribution?.title ?? label) +
            " — " +
            (rights.author ?? attribution?.creator ?? rights.sourceWorkId) +
            " — " +
            rights.licenseId +
            " ",
        );
      if (attribution?.changes)
        item.append(ui("span", {}, " · " + attribution.changes + " "));
      if (attribution?.recording?.length)
        item.append(
          ui(
            "span",
            {},
            " · " +
              (locale === "en" ? "Recording: " : "Rekaman: ") +
              attribution.recording.join(", ") +
              " ",
          ),
        );
      for (const [href, label] of [
        [
          rights.sourceURL ?? attribution?.sourcePage,
          locale === "en" ? "Source" : "Sumber",
        ],
        [rights.licenseURL, locale === "en" ? "License" : "Lisensi"],
      ]) {
        if (!href) continue;
        const link = ui(
          "a",
          { href, target: "_blank", rel: "noopener noreferrer" },
          label,
        );
        item.append(link, root.ownerDocument.createTextNode(" "));
      }
      creditList.append(item);
    }
    limiter.checked = current.project.master.limiter.bypass;
    archiveSelect.replaceChildren();
    for (const o of current.project.origins.filter((o) => o.kind === "file"))
      archiveSelect.add(new Option(o.id, "original:" + o.sha256));
    for (const ref of current.backupRefs)
      archiveSelect.add(new Option(ref.name, "backup:" + ref.sha256));
    for (const bus of current.project.tracks) {
      const row = ui("fieldset", { "data-can-bus": bus.id });
      row.append(ui("legend", {}, bus.name));
      for (const field of ["volume", "pan", "mute", "solo"]) {
        const label = ui("label", {}, c[field]),
          input = ui("input", {
            type: ["mute", "solo"].includes(field) ? "checkbox" : "number",
            "data-can-bus-field": field,
            "data-can-edit": "",
            "data-can-global": "",
          });
        if (input.type === "checkbox") input.checked = bus.mix[field];
        else {
          input.min = field === "pan" ? -1 : 0;
          input.max = 1;
          input.step = 0.01;
          input.value = bus.mix[field];
        }
        label.append(input);
        row.append(label);
      }
      buses.append(row);
    }
    if (sourceId) {
      const view = readView();
      for (const b of view.clips) {
        const row = ui("div", {
          class: "can-beatbox-row",
          "data-can-role": b.role,
        });
        row.append(
          ui(
            "strong",
            {},
            (beatboxMessages[locale] ?? beatboxMessages.id).roles[b.role],
          ),
        );
        for (const field of [
          "enabled",
          "variant",
          "volume",
          "pan",
          "mute",
          "solo",
          "phasePolicy",
        ]) {
          const label = ui(
            "label",
            {},
            c[{ enabled: "on", phasePolicy: "phase" }[field] ?? field],
          );
          let el;
          if (field === "phasePolicy" || field === "variant") {
            el = ui("select", { "data-can-edit": "", "data-can-field": field });
            for (const v of field === "variant"
              ? [1, 2]
              : ["continue-source", "restart-on-entry"])
              el.add(
                new Option(
                  field === "variant"
                    ? String(v)
                    : c[v === "continue-source" ? "continue" : "restart"],
                  v,
                ),
              );
            el.value = String(b[field]);
          } else {
            const checkbox = ["enabled", "mute", "solo"].includes(field);
            el = ui("input", {
              "data-can-edit": "",
              "data-can-field": field,
              type: checkbox ? "checkbox" : "number",
            });
            if (checkbox) el.checked = b[field];
            else {
              el.min = field === "pan" ? -1 : 0;
              el.max = 1;
              el.step = 0.01;
              el.value = b[field];
            }
          }
          label.append(el);
          row.append(label);
        }
        beatbox.append(row);
      }
      const pitch = ui("select", { "data-can-pitch": "", "data-can-edit": "" });
      for (const p of ["d4", "f4", "g4", "a4", "c5"])
        pitch.add(new Option(p, p));
      pitch.value = selectedPitch;
      bilah.append(pitch);
      const pattern = view.patterns.find((p) => p.id === view.activePattern);
      for (let i = 0; i < 16; i++)
        bilah.append(
          ui(
            "button",
            {
              type: "button",
              "data-can-note": i,
              "data-can-edit": "",
              "aria-pressed": String(Boolean(pattern.notes[i])),
            },
            pattern.notes[i]?.pitch ?? String(i + 1),
          ),
        );
      const chain = ui("div", { class: "can-chain" });
      view.chain.forEach((id, i) =>
        chain.append(
          ui(
            "button",
            {
              type: "button",
              "data-can-remove-chain": i,
              "data-can-edit": "",
              title: locale === "en" ? "Remove occurrence" : "Hapus urutan",
            },
            view.patterns.find((p) => p.id === id).name,
          ),
        ),
      );
      $("chain-list").replaceChildren(chain);
    }
    for (const d of workingSources().filter(
      (d) => d.kind === "instrument-events",
    )) {
      const box = ui("fieldset", { "data-can-native-source": d.id }),
        select = ui("select", { "data-can-event": "", "data-can-edit": "" });
      for (const e of d.programme.events) {
        const version = d.programme.banks.find(
            (b) => b.id === e.bankId,
          ).version,
          sample = registry.sample(e.bankId, version, e.sampleId);
        select.add(
          new Option(
            (e.action === "strike"
              ? locale === "en"
                ? "Strike"
                : "Pukul"
              : locale === "en"
                ? "Damp"
                : "Redam") +
              " " +
              sample.instrumentId +
              " " +
              sample.pitchId +
              " @ " +
              e.tick / PPQ,
            e.id,
          ),
        );
      }
      const beat = ui("input", {
          type: "number",
          step: "any",
          min: 0,
          "data-can-event-beat": "",
          "data-can-edit": "",
        }),
        velocity = ui("input", {
          type: "number",
          min: 0,
          max: 1,
          step: 0.01,
          "data-can-event-velocity": "",
          "data-can-edit": "",
        });
      const sound = ui("select", {
          "data-can-event-sound": "",
          "data-can-edit": "",
        }),
        action = ui("select", {
          "data-can-event-action": "",
          "data-can-edit": "",
        });
      for (const bank of d.programme.banks)
        for (const sample of registry.bank(bank.id, bank.version).samples)
          sound.add(
            new Option(
              bank.id +
                " / " +
                sample.instrumentId +
                " / " +
                sample.pitchId +
                " / " +
                sample.articulation,
              bank.id + "|" + sample.id,
            ),
          );
      action.add(new Option(c.strike, "strike"));
      action.add(new Option(c.damp, "damp"));
      const fill = () => {
        const e = d.programme.events.find((e) => e.id === select.value);
        beat.value = e ? e.tick / PPQ : 0;
        velocity.value = e?.velocity ?? 0.65;
        if (e) {
          sound.value = e.bankId + "|" + e.sampleId;
          action.value = e.action;
        }
      };
      select.onchange = fill;
      fill();
      const soundLabel = ui("label", {}, c.sound),
        actionLabel = ui("label", {}, c.action),
        positionLabel = ui("label", {}, c.position),
        velocityLabel = ui("label", {}, c.velocity);
      soundLabel.append(sound);
      actionLabel.append(action);
      positionLabel.append(beat);
      velocityLabel.append(velocity);
      box.append(
        select,
        soundLabel,
        actionLabel,
        positionLabel,
        velocityLabel,
        ui(
          "button",
          { type: "button", "data-can-apply-native": "", "data-can-edit": "" },
          c.apply,
        ),
        ui(
          "button",
          { type: "button", "data-can-add-native": "", "data-can-edit": "" },
          c.addEvent,
        ),
        ui(
          "button",
          { type: "button", "data-can-delete-native": "", "data-can-edit": "" },
          c.deleteEvent,
        ),
      );
      const lengthLabel = ui("label", {}, c.length),
        length = ui("input", {
          type: "number",
          min: 1,
          step: "any",
          "data-can-native-length": "",
          "data-can-edit": "",
          "data-can-global": "",
        });
      length.value = d.programme.clock.lengthTicks / PPQ;
      lengthLabel.append(length);
      box.append(
        lengthLabel,
        ui(
          "button",
          {
            type: "button",
            "data-can-apply-length": "",
            "data-can-edit": "",
            "data-can-global": "",
          },
          c.lengthApply,
        ),
      );
      native.append(box);
    }
    authoring?.render();
    locks();
    notify();
  }
  const notify = () => {
    for (const fn of observers) {
      try {
        fn();
      } catch {
        /* Observer only. */
      }
    }
  };
  const listen = (el, type, fn) =>
    el.addEventListener(
      type,
      (e) => {
        Promise.resolve(fn(e)).catch(showError);
      },
      { signal: life.signal },
    );
  listen(source, "change", () => {
    sourceId = source.value;
    return panel.controller.edited().then(render);
  });
  listen(root, "change", (e) => {
    const t = e.target;
    if (t.id === "st-bpm") {
      const bpm = Number(t.value);
      return mutate(() => editor.setTempo(bpm));
    }
    if (t.id === "st-swing") {
      const swing = Number(t.value);
      return mutate(() => editor.setSwing(sourceId, swing));
    }
    if (t.id === "st-kit") {
      const kit = t.value;
      return mutate(() => editor.setKit(sourceId, kit));
    }
    if (t.dataset.canLimiter !== undefined) {
      const value = t.checked;
      return mutate(() =>
        editor.edit((p) => {
          p.master.limiter.bypass = value;
        }),
      );
    }
    if (t.dataset.canBusField !== undefined) {
      const id = t.closest("[data-can-bus]").dataset.canBus,
        field = t.dataset.canBusField,
        value = t.type === "checkbox" ? t.checked : Number(t.value);
      return mutate(() =>
        editor.edit((p) => {
          p.tracks.find((t) => t.id === id).mix[field] = value;
        }),
      );
    }
    if (t.dataset.canPitch !== undefined) {
      selectedPitch = t.value;
      return;
    }
    if (t.dataset.canField !== undefined) {
      const role = t.closest("[data-can-role]").dataset.canRole,
        field = t.dataset.canField,
        value =
          t.type === "checkbox"
            ? t.checked
            : ["variant", "volume", "pan"].includes(field)
              ? Number(t.value)
              : t.value;
      return mutate(() => editor.setBeatbox(sourceId, role, field, value));
    }
    if (t.id === "st-pattern")
      return mutate(() => editor.selectPattern(sourceId, t.value));
    if (t.id === "st-title") {
      const value = t.value;
      return mutate(() => editor.edit((p) => (p.title = value)));
    }
    if (t.id === "st-master") {
      const value = Number(t.value);
      return mutate(() => editor.edit((p) => (p.master.volume = value)));
    }
    for (const field of ["volume", "pan"])
      if (t.hasAttribute("data-st-" + field)) {
        const role = t.getAttribute("data-st-" + field);
        return mutate(() =>
          editor.edit(
            (p) =>
              (p.sourceDefs
                .find((d) => d.id === sourceId)
                .programme.percussion.find((r) => r.role === role)[field] =
                Number(t.value)),
          ),
        );
      }
  });
  listen(root, "click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (
      t.dataset.canAddNative !== undefined ||
      t.dataset.canDeleteNative !== undefined
    ) {
      const box = t.closest("[data-can-native-source]"),
        id = box.dataset.canNativeSource;
      if (t.dataset.canDeleteNative !== undefined)
        return mutate(() =>
          editor.deleteNative(id, box.querySelector("[data-can-event]").value),
        );
      const [bankId, sampleId] = box
          .querySelector("[data-can-event-sound]")
          .value.split("|"),
        action = box.querySelector("[data-can-event-action]").value,
        tick = Math.round(
          Number(box.querySelector("[data-can-event-beat]").value) * PPQ,
        ),
        velocity = Number(box.querySelector("[data-can-event-velocity]").value);
      return mutate(() =>
        editor.addNative(id, { bankId, sampleId, action, tick, velocity }),
      );
    }
    if (t.dataset.canApplyLength !== undefined) {
      const box = t.closest("[data-can-native-source]"),
        ticks = Math.round(
          Number(box.querySelector("[data-can-native-length]").value) * PPQ,
        );
      return mutate(() =>
        editor.setNativeLength(box.dataset.canNativeSource, ticks),
      );
    }
    if (t.hasAttribute("data-st-step")) {
      const [role, index] = t.dataset.stStep.split(":"),
        pattern = readView().patterns.find(
          (p) => p.id === readView().activePattern,
        );
      return mutate(() =>
        editor.setStep(
          sourceId,
          role,
          Number(index),
          pattern.steps[role][index] ? 0 : 1,
        ),
      );
    }
    if (t.dataset.canNote !== undefined) {
      const i = Number(t.dataset.canNote),
        pitch = root.querySelector("[data-can-pitch]").value,
        view = readView(),
        note = view.patterns.find((p) => p.id === view.activePattern).notes[i];
      return mutate(() =>
        editor.setNote(
          sourceId,
          i,
          note?.pitch === pitch ? null : { pitch, velocity: 0.6 },
        ),
      );
    }
    if (t.dataset.canRemoveChain !== undefined) {
      const chain = [...readView().chain];
      chain.splice(Number(t.dataset.canRemoveChain), 1);
      return mutate(() => editor.setChain(sourceId, chain));
    }
    if (t.dataset.canReset !== undefined)
      return mutate(() =>
        editor.setChain(sourceId, [readView().activePattern]),
      );
    if (t.dataset.canApplyNative !== undefined) {
      const box = t.closest("[data-can-native-source]"),
        id = box.dataset.canNativeSource,
        event = box.querySelector("[data-can-event]").value;
      return mutate(() =>
        editor.editNative(id, event, {
          tick: Math.round(
            Number(box.querySelector("[data-can-event-beat]").value) * PPQ,
          ),
          velocity: Number(
            box.querySelector("[data-can-event-action]").value === "damp"
              ? 0
              : box.querySelector("[data-can-event-velocity]").value,
          ),
          action: box.querySelector("[data-can-event-action]").value,
          bankId: box
            .querySelector("[data-can-event-sound]")
            .value.split("|")[0],
          sampleId: box
            .querySelector("[data-can-event-sound]")
            .value.split("|")[1],
        }),
      );
    }
    for (const field of ["mute", "solo"])
      if (t.hasAttribute("data-st-" + field)) {
        const role = t.getAttribute("data-st-" + field);
        return mutate(() =>
          editor.edit((p) => {
            const row = p.sourceDefs
              .find((d) => d.id === sourceId)
              .programme.percussion.find((r) => r.role === role);
            row[field] = !row[field];
          }),
        );
      }
  });
  listen($("duplicate"), "click", () => {
    let id;
    do {
      id = "owned-" + ++cloneIndex;
    } while (readView().patterns.some((p) => p.id === id));
    return mutate(() =>
      editor.clonePattern(
        sourceId,
        id,
        String.fromCharCode(65 + readView().patterns.length),
      ),
    );
  });
  listen($("rename"), "click", () =>
    mutate(() =>
      editor.edit((p) => {
        const g = p.sourceDefs.find((d) => d.id === sourceId).programme;
        g.patterns.find((a) => a.id === g.activePattern).name =
          $("pattern-name").value;
      }),
    ),
  );
  listen($("add-chain"), "click", () =>
    mutate(() =>
      editor.setChain(sourceId, [
        ...readView().chain,
        readView().activePattern,
      ]),
    ),
  );
  listen($("undo"), "click", () => mutate(() => editor.undo()));
  listen($("redo"), "click", () => mutate(() => editor.redo()));
  listen(
    $("demo"),
    "click",
    () =>
      loadDemo &&
      mutate(async () => {
        const candidate = await loadDemo();
        try {
          await editor.replace(candidate);
        } finally {
          candidate.dispose();
        }
      }),
  );
  listen($("save"), "click", () => mutate(() => workflow.save()));
  listen($("cancel"), "click", () => {
    workflow.cancel();
    panel.cancelExport();
  });
  listen($("load"), "click", () => mutate(() => workflow.load()));
  listen($("project-download"), "click", () =>
    mutate(async () => {
      const out = await workflow.exportProject();
      try {
        await deliverBlob(
          out.blob,
          safe(editor.snapshot().project.title, "perkusi"),
        );
      } finally {
        out.release();
      }
    }),
  );
  listen(original, "click", () =>
    deliverBlob(workflow.original(), "perkusi-original.perkusi"),
  );
  listen(inputBackup, "click", () =>
    deliverBlob(
      workflow.snapshot().inputBackup,
      "perkusi-import-original.perkusi",
    ),
  );
  listen(archiveDownload, "click", () => {
    const b = editor.snapshot().bundle,
      [kind, hash] = archiveSelect.value.split(":");
    return deliverBlob(
      kind === "backup" ? b.backups.get(hash).blob : b.originals.get(hash),
      "perkusi-source.perkusi",
    );
  });
  listen($("import"), "click", () => {
    importMode = "replace";
    $("file").value = "";
    $("file").click();
  });
  listen(addMaterial, "click", () => {
    importMode = "add";
    $("file").value = "";
    $("file").click();
  });
  listen($("file"), "change", () => {
    const file = $("file").files?.[0];
    if (file) {
      const mode = importMode,
        bars = Number(windowSelect.value);
      return mutate(() => workflow.importFile(file, { mode, bars }));
    }
  });
  root.dataset.canonicalEditable = "true";
  $("master").max = 1;
  if (
    import.meta.env.DEV ||
    import.meta.env.CANONICAL_LOCAL_REVIEW ||
    import.meta.env.CANONICAL_PUBLIC_PREVIEW
  ) {
    const { initCanonicalAuthoringPanel } =
      await import("./canonical-authoring-panel.js");
    authoring = initCanonicalAuthoringPanel({
      root,
      editor,
      mutate,
      locale,
      readView,
      readSource: () => sourceId,
      signal: life.signal,
    });
    const { initCanonicalTuningControl } =
      await import("./canonical-tuning-control.js");
    tuningControl = initCanonicalTuningControl({
      root,
      editor,
      mutate,
      locale,
      signal: life.signal,
    });
  }
  render();
  if (recover)
    try {
      await workflow.load();
    } catch (e) {
      if (e.code === "missingProject") status(c.idle);
      else showError(e);
    }
  render();
  return Object.freeze({
    editor,
    controller: panel.controller,
    workflow,
    storage,
    transaction,
    deliver: deliverBlob,
    subscribe(fn) {
      observers.add(fn);
      return () => observers.delete(fn);
    },
    snapshot: () => ({
      editor: editor.snapshot(),
      workflow: workflow.snapshot(),
      memory: memory.snapshot(),
      pendingTasks: pending.size,
    }),
    isDirty: () => editor.snapshot().revision !== checkpointRevision,
    async dispose() {
      disposed = true;
      life.abort();
      observers.clear();
      root
        .querySelectorAll("button,input,select")
        .forEach((el) => (el.disabled = true));
      for (const row of urls.values()) row.done();
      const audioClose = panel.dispose(),
        editorClose = editor.dispose();
      audioClose.catch(() => {});
      editorClose.catch(() => {});
      await workflow.dispose();
      await Promise.allSettled([...pending]);
      const closed = await Promise.allSettled([audioClose, editorClose]);
      const failed = closed.find((r) => r.status === "rejected");
      if (failed) throw failed.reason;
    },
  });
}
