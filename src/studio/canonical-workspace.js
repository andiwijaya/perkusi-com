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
import { canonicalPadDocument } from "./canonical-pad-document.js";
import { createFreshCanonicalProject } from "./canonical-fresh-project.js";
import { initCanonicalProjectLibrary } from "./canonical-project-library.js";
import { initCanonicalCapturePanel } from "./canonical-capture-panel.js";
import { initCanonicalRecordingTools } from "./canonical-recording-tools.js";
import { fail } from "../project/instrument-contract.js";
import { retainCanonicalInputBlob } from "../project/canonical-blob-owner.js";
import {
  createCanonicalGamelanMaterial,
  createCanonicalRackMaterial,
} from "./canonical-source-material.js";
import { recordSource } from "../loop-station/record-sources.js";
import { starterContent } from "../loop-station/starters.js";
import { exportCanonicalPackage } from "../project/canonical-package.js";
import { projectMessages } from "../project/messages.js";
import { CanonicalWavDelivery } from "./canonical-wav-delivery.js";
import { createCanonicalEventReporter } from "./canonical-analytics.js";
import {
  initCanonicalPositionMarkers,
  canonicalSourceLabel,
} from "./canonical-position-markers.js";
import {
  CORPUS_INSTRUMENTS,
  instrumentNames,
} from "../gamelan/instrument-focus.js";
const text = {
  id: {
    note: "Rhythm Studio: edit pola, mainkan pad, susun rantai, lalu Putar.",
    padsHint:
      "Pad 1-8 memainkan suara lewat engine Studio yang sama, tanpa mengubah pola. Saat dijeda, lanjutkan atau kembali ke awal sebelum memainkan pad.",
    chainAlways:
      "Rantai irama mengikuti urutan di bawah. Gunakan Ulang terus di transport untuk mengulang seluruh lagu.",
    mobile:
      "Grid dapat digeser di HP. Ketuk pad untuk memainkan suara di Studio ini.",
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
    note: "Rhythm Studio: edit patterns, play pads, build a chain, then Play.",
    padsHint:
      "Pads 1-8 play through the same Studio engine without changing the pattern. While paused, resume or return to the start before playing pads.",
    chainAlways:
      "The rhythm chain follows the order below. Use Repeat continuously in the transport to repeat the whole song.",
    mobile:
      "Scroll the grid on your phone. Tap pads to audition sounds in this Studio.",
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
    positionMarkers,
    projectLibrary,
    captureTools,
    recordingTools,
    authoring,
    tuningControl,
    editor,
    workflow,
    sourceId =
      bundle.project.sourceDefs.find((d) => d.kind === "composition")?.id ??
      null,
    busy = 0,
    errorRevision = 0,
    disposed = false,
    cloneIndex = 0,
    quantizePads = true,
    selectedPitch = "d4",
    checkpointRevision = 0;
  const analytics = createCanonicalEventReporter(),
    fileCopy = projectMessages[locale] ?? projectMessages.id,
    wavDelivery = new CanonicalWavDelivery({
      memory,
      readRevision: () => editor?.snapshot().revision,
    });
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
  // Pads use the canonical owner below; never initialize the legacy engine.
  const padSection = root.querySelector(".st-pads").closest("section");
  padSection.dataset.canPads = "";
  padSection.querySelector('[data-st-copy="padsHint"]').textContent =
    c.padsHint;
  $("quantize").checked = quantizePads;
  $("chain-mode").closest("label").hidden = true;
  root
    .querySelector(".st-chain .st-panel-top")
    .after(ui("p", { class: "st-hint" }, c.chainAlways));
  root.querySelector('[data-st-copy="desktop"]').textContent = c.mobile;
  root.querySelector('[data-st-copy="shortcuts"]').textContent =
    locale === "en"
      ? "1-8: live pads. Space outside controls: Play/Pause. Ctrl/Cmd+Z: Undo; Ctrl/Cmd+Shift+Z: Redo. Text inputs retain native editing shortcuts."
      : "1-8: pad langsung. Spasi di luar kontrol: Putar/Jeda. Ctrl/Cmd+Z: Undo; Ctrl/Cmd+Shift+Z: Redo. Input teks memakai pintasan normal.";
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
    errorRevision++;
    const reasons =
      locale === "en"
        ? {
            canonicalStorageFull:
              "Browser storage is full; this project has not been saved. Your draft and previous saves are intact. Download the complete project as a backup, free device space, then retry saving. Remove from list does not free audio storage.",
            voiceHeadroom:
              "This pad would exceed combined output headroom. The song continues unchanged; wait for its decay or stop before auditioning the pad.",
            voiceLimit:
              "The active voices are at the safe limit. Wait for their natural decay before trying another pad.",
            combinedMemoryLimit:
              "Audio memory is at its safe limit. The project is intact; stop playback before trying again.",
            hubTempoConflict: "Match the source BPM before adding material.",
            clipTempo:
              "Beatbox loops use 96 BPM. Set the project tempo to 96 before enabling a loop; its original timing is preserved.",
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
            canonicalStorageFull:
              "Penyimpanan browser penuh; proyek ini belum tersimpan. Sesi dan simpanan sebelumnya tetap utuh. Unduh proyek lengkap sebagai cadangan, kosongkan ruang perangkat, lalu coba simpan lagi. Hapus dari daftar tidak membebaskan ruang audio.",
            voiceHeadroom:
              "Pad ini akan melampaui batas gabungan output. Lagu tetap berjalan; tunggu decay atau hentikan sebelum memainkan pad.",
            voiceLimit:
              "Jumlah suara aktif mencapai batas aman. Tunggu decay alami sebelum memainkan pad berikutnya.",
            combinedMemoryLimit:
              "Memori audio mencapai batas aman. Proyek tetap utuh; hentikan pemutaran sebelum mencoba lagi.",
            hubTempoConflict: "Samakan BPM sumber sebelum menambahkan materi.",
            clipTempo:
              "Loop Beatbox memakai 96 BPM. Atur tempo proyek ke 96 sebelum mengaktifkan Loop; timing aslinya dipertahankan.",
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
      if (captureTools?.blocked() && !captureTools.applying)
        fail("captureTakeNeedsReview");
      busy++;
      locks();
      try {
        await fn();
      } finally {
        busy--;
        render();
      }
    });
  const mutate = (fn) => {
    const priorError = root.dataset.canonicalError,
      priorMessage = $("project-status").textContent,
      priorErrorRevision = errorRevision;
    return transaction(fn)
      .then(() => {
        if (priorError && errorRevision === priorErrorRevision) {
          delete root.dataset.canonicalError;
          if ($("project-status").textContent === priorMessage) status(c.idle);
        }
      })
      .catch(showError);
  };
  const deliverBlob = async (blob, name) => {
    if (disposed) throw Error("cancelled");
    const held = retainCanonicalInputBlob(
      blob,
      memory,
      "canonical/file-delivery",
    );
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
      edited: () => {
        if (captureTools?.blocked() && !captureTools.applying)
          fail("captureTakeNeedsReview");
        wavDelivery.clear();
        return panel?.controller.edited();
      },
      stop: () => panel?.controller.stop(),
    },
    onChange: () => render(),
  });
  panel = initCanonicalStudioPanel({
    root,
    locale,
    readDocument: () => editor.snapshot().project,
    readRevision: () => editor.snapshot().revision,
    readView,
    readPlaybackView: (id) =>
      canonicalEditorView(editor.snapshot().project, id),
    onPosition: (p, state) => {
      recordingTools?.position(p, state);
      positionMarkers?.position(p, state);
      analytics.position(p, state, panel.controller.snapshot());
    },
    command: (p) =>
      p.transport.kind === "legacy-continuous"
        ? {
            kind: "window",
            bars: Number(root.querySelector("[data-song-window]")?.value ?? 4),
            cycles: 1,
          }
        : undefined,
    createOwner: (options) =>
      createOwner({ ...options, bundle: editor.snapshot().bundle }),
    onExportStart: () => wavDelivery.clear(),
    onExportResult: (error) => analytics.exported(error),
    onWav: async (wav, request) => {
      const name = safe(
        request?.title ?? editor.snapshot().project.title,
        "wav",
      );
      await deliverBlob(wav.output.blob, name);
      try {
        wavDelivery.remember(wav.output.blob, name, request.revision);
      } catch {
        /* The successful download remains usable when a ready-file reservation cannot fit. */
      }
    },
    wavReadyText: c.ready,
    onTransport: () => locks(),
  });
  positionMarkers = initCanonicalPositionMarkers({
    root,
    locale,
    readDocument: () => editor.snapshot().project,
    nativeLabel: (source, event) => {
      if (!event) return "";
      const version = source.programme.banks.find(
          (b) => b.id === event.bankId,
        ).version,
        sample = registry.sample(event.bankId, version, event.sampleId);
      return (
        (instrumentNames[sample.instrumentId] ?? sample.instrumentId) +
        " " +
        sample.pitchId
      );
    },
  });
  const extras = ui("section", { class: "st-panel canonical-material" }),
    sourceLabel = ui("label", {}, c.source),
    source = ui("select", { "data-can-source": "", "data-can-edit": "" });
  sourceLabel.append(source);
  extras.append(sourceLabel);
  const newSource = ui("fieldset", { "data-can-new-source": "" }),
    instrumentLabel = ui(
      "label",
      {},
      locale === "en" ? "Gamelan instrument" : "Instrumen Gamelan",
    ),
    instrumentChoice = ui("select", {
      "data-can-new-instrument": "",
      "data-can-edit": "",
      "data-can-global": "",
    }),
    larasLabel = ui("label", {}, "Laras"),
    larasChoice = ui("select", {
      "data-can-new-laras": "",
      "data-can-edit": "",
      "data-can-global": "",
    });
  for (const name of CORPUS_INSTRUMENTS)
    instrumentChoice.add(new Option(instrumentNames[name], name));
  instrumentChoice.value = "saron-barung";
  for (const laras of ["pelog", "slendro"])
    larasChoice.add(new Option(laras === "pelog" ? "Pelog" : "Slendro", laras));
  instrumentLabel.append(instrumentChoice);
  larasLabel.append(larasChoice);
  newSource.append(
    ui(
      "legend",
      {},
      locale === "en" ? "Add an instrument" : "Tambah instrumen",
    ),
    instrumentLabel,
    larasLabel,
    ui(
      "button",
      {
        type: "button",
        "data-can-create-gamelan": "",
        "data-can-edit": "",
        "data-can-global": "",
      },
      locale === "en" ? "Add Gamelan" : "Tambah Gamelan",
    ),
    ui(
      "p",
      { class: "st-hint" },
      locale === "en"
        ? "Starts with one strike. Choose its pitch and add or edit notes below; Undo removes the addition."
        : "Dimulai dengan satu pukulan. Pilih nada lalu tambah atau edit not di bawah; Urung membatalkan penambahan.",
    ),
  );
  extras.append(newSource);
  const rack = ui("fieldset", { "data-can-rack": "" }),
    rackInstrument = ui("select", {
      "data-can-rack-instrument": "",
      "data-can-edit": "",
      "data-can-global": "",
    }),
    rackNote = ui("select", {
      "data-can-rack-note": "",
      "data-can-edit": "",
      "data-can-global": "",
    }),
    rackInstrumentLabel = ui(
      "label",
      {},
      locale === "en" ? "Instrument" : "Instrumen",
    ),
    rackNoteLabel = ui(
      "label",
      {},
      locale === "en" ? "Original recording" : "Rekaman asli",
    );
  for (const [id, label] of [
    ["drum-ruang", "Drum Ruang"],
    ["drum-arus", "Drum Arus"],
    ["electric-bass", "Bass"],
    ["classical-guitar", locale === "en" ? "Guitar" : "Gitar"],
  ])
    rackInstrument.add(new Option(label, id));
  const rackNotes = () => {
    const s = recordSource(rackInstrument.value);
    rackNote.replaceChildren(
      ...s.sampleIds.map((id) => {
        const d = registry.sample(s.bankId, s.bankVersion, id);
        return new Option(d.pitchId + " / " + d.id, id);
      }),
    );
  };
  rackInstrument.addEventListener("change", rackNotes, { signal: life.signal });
  rackNotes();
  rackInstrumentLabel.append(rackInstrument);
  rackNoteLabel.append(rackNote);
  rack.append(
    ui(
      "legend",
      {},
      locale === "en" ? "Prepared clip rack" : "Rak klip siap pakai",
    ),
    rackInstrumentLabel,
    rackNoteLabel,
    ui(
      "button",
      {
        type: "button",
        "data-can-rack-add": "",
        "data-can-edit": "",
        "data-can-global": "",
      },
      locale === "en" ? "Add instrument clip" : "Tambah klip instrumen",
    ),
    ui(
      "p",
      {},
      locale === "en"
        ? "Starts with one original strike. Edit its notes below; Undo removes the clip."
        : "Dimulai dengan satu pukulan asli. Edit not di bawah; Urung membatalkan klip.",
    ),
  );
  extras.append(rack);
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
    captureHint = ui(
      "p",
      { class: "st-hint" },
      import.meta.env.CANONICAL_FINAL_STUDIO
        ? locale === "en"
          ? "Create Gamelan notes or record instruments and mic in this Studio. Apply a take to add it to the same song."
          : "Buat not Gamelan atau rekam instrumen dan mic di Studio ini. Terapkan take untuk menambahkannya ke lagu yang sama."
        : c.capture,
    );
  extras.prepend(captureHint);
  for (const [path, label, data] of import.meta.env.CANONICAL_FINAL_STUDIO
    ? []
    : [
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
      ...[
        ["Nusantara Fusion", "fusion"],
        ["Bumi dan Tangan", "bumi"],
        ["Malam Bilah", "malam"],
        [shell.ruang, "ruang"],
        [shell.arus, "arus"],
      ].map(([label, id]) => new Option(label, id)),
      ...starterContent.map(
        (s) => new Option(s.name[locale] ?? s.name.id, "starter:" + s.id),
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
    library: true,
    onChange: (s) => {
      analytics.workflow(s);
      if (
        (s.status === "saved" || s.status === "loaded") &&
        s.checkpointRevision !== null
      )
        checkpointRevision = s.checkpointRevision;
      if (s.status === "removed" && s.removedActive) checkpointRevision = -1;
      if (s.status === "error") showError({ code: s.error });
      else {
        delete root.dataset.canonicalError;
        status(
          c[s.status] ??
            (s.status === "cancelled"
              ? cancelled
              : s.status === "cancelling"
                ? cancelling
                : c.idle),
        );
      }
      locks();
    },
  });
  const isDirty = () =>
    captureTools?.hasWork() ||
    editor.snapshot().revision !== checkpointRevision ||
    workflow.snapshot().needsCheckpoint;
  projectLibrary = initCanonicalProjectLibrary({
    root,
    workflow,
    transaction,
    isDirty,
    locale,
    signal: life.signal,
    makeFresh: () =>
      createFreshCanonicalProject({
        registry,
        memory,
        title: locale === "en" ? "New project" : "Proyek baru",
      }),
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
      locked =
        disposed ||
        busy > 0 ||
        s.status === "cleanup-pending" ||
        !!captureTools?.blocked();
    const dirty = isDirty();
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
      "clear",
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
    $("stop").disabled =
      disposed || captureTools?.blocked() || s.pendingOwners === 0;
    $("dismiss").disabled = false;
    $("quantize").disabled = locked || !sourceId;
    $("quantize").checked = quantizePads;
    for (const el of root.querySelectorAll("[data-st-pad]"))
      el.disabled =
        locked ||
        !sourceId ||
        s.finishing ||
        s.status === "paused" ||
        s.status === "preparing";
    panel.setTransportLocked(locked);
    original.disabled = locked;
    addMaterial.disabled = locked;
    windowSelect.disabled = locked;
    archiveSelect.disabled = locked;
    archiveDownload.disabled = locked || !archiveSelect.options.length;
    inputBackup.disabled = locked || !workflow?.snapshot().inputBackup;
    $("render").disabled =
      locked || panel.exporting || s.closed || s.status === "preparing";
    const share = wavDelivery.snapshot();
    $("result").hidden = !share.ready;
    $("filename").textContent = share.name;
    $("wav-download").disabled = locked || !share.ready || share.sharing;
    $("share").hidden = !share.ready;
    $("share").disabled =
      locked || panel.exporting || !share.ready || share.sharing;
    $("share").textContent = share.native
      ? fileCopy.share
      : fileCopy.shareDownload;
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
    projectLibrary?.locks(locked);
    recordingTools?.locks(locked);
    if (captureTools?.blocked())
      for (const el of root.querySelectorAll(
        "[data-can-transport-control],#st-render",
      ))
        el.disabled = true;
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
      const eq = ui("fieldset", { "data-can-eq": "" });
      eq.append(ui("legend", {}, locale === "en" ? "Track EQ" : "EQ track"));
      for (const [field, label] of [
        ["bypass", locale === "en" ? "Bypass EQ" : "Lewati EQ"],
        ["lowDb", locale === "en" ? "Low (dB)" : "Rendah (dB)"],
        ["midDb", locale === "en" ? "Mid (dB)" : "Tengah (dB)"],
        ["highDb", locale === "en" ? "High (dB)" : "Tinggi (dB)"],
      ]) {
        const l = ui("label", {}, label),
          n = ui("input", {
            type: field === "bypass" ? "checkbox" : "number",
            "data-can-eq-field": field,
            "data-can-edit": "",
            "data-can-global": "",
          });
        if (field === "bypass") n.checked = bus.fx.eq.bypass;
        else {
          n.min = -6;
          n.max = 6;
          n.step = 0.1;
          n.value = bus.fx.eq[field];
        }
        l.append(n);
        eq.append(l);
      }
      row.append(eq);
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
      box.append(
        ui("legend", {}, canonicalSourceLabel(current.project, d, locale)),
      );
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
              (instrumentNames[sample.instrumentId] ?? sample.instrumentId) +
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
                (instrumentNames[sample.instrumentId] ?? sample.instrumentId) +
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
        ui("p", {
          "data-can-native-position": "",
          hidden: "",
          class: "st-hint",
        }),
        ui("progress", {
          "data-can-native-cursor": "",
          max: 1,
          value: 0,
          hidden: "",
          "aria-label":
            locale === "en"
              ? "Native part playback position"
              : "Posisi pemutaran bagian instrumen",
        }),
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
    recordingTools?.render();
    captureTools?.render();
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
  const auditionPad = (role) =>
    transaction(async () => {
      const document = editor.snapshot().project;
      const pad = await canonicalPadDocument(
        document,
        sourceId,
        role,
        registry,
      );
      if (!panel.controller.snapshot().capability)
        await panel.controller.play(document, { prepareOnly: true });
      await panel.controller.audition(pad, {
        quantize: quantizePads,
        swing: readView().timing.swing,
      });
    });
  listen($("dismiss"), "click", () => {
    $("desktop").hidden = true;
  });
  listen($("share"), "click", async () => {
    const task = wavDelivery.share();
    busy++;
    locks();
    try {
      const outcome = await withTask(() => task);
      status(fileCopy[outcome] ?? fileCopy.downloaded);
    } finally {
      busy--;
      locks();
    }
  });
  listen($("wav-download"), "click", () => {
    wavDelivery.download();
    status(fileCopy.downloaded);
  });
  root.addEventListener(
    "click",
    (e) => {
      if (
        e.target.closest("[data-cap-prepare]") &&
        !e.target.closest("button").disabled
      )
        wavDelivery.clear();
    },
    { capture: true, signal: life.signal },
  );
  listen($("clear"), "click", () =>
    mutate(() =>
      editor.edit((p) => {
        const g = p.sourceDefs.find((d) => d.id === sourceId).programme;
        const a = g.patterns.find((a) => a.id === g.activePattern);
        for (const role of Object.keys(a.steps)) a.steps[role].fill(0);
        a.notes.fill(null);
        for (const voice of a.beatbox) voice.enabled = false;
      }),
    ),
  );
  // The unified entry owns these grids; the legacy page's keyboard handler
  // is not initialized here. Keep focus movement separate from song edits.
  listen(root, "keydown", (e) => {
    const cell = e.target.closest("[data-st-step],[data-can-note]");
    if (
      e.defaultPrevented ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      !cell ||
      cell.disabled ||
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
    const drums = cell.hasAttribute("data-st-step"),
      [role, index] = drums
        ? cell.dataset.stStep.split(":")
        : [null, cell.dataset.canNote];
    let row = drums ? compositionRegistry.roleOrder.indexOf(role) : 0,
      step = Number(index);
    if (e.key === "ArrowLeft") step = Math.max(0, step - 1);
    if (e.key === "ArrowRight") step = Math.min(15, step + 1);
    if (e.key === "ArrowUp") row = Math.max(0, row - 1);
    if (e.key === "ArrowDown")
      row = Math.min(
        drums ? compositionRegistry.roleOrder.length - 1 : 0,
        row + 1,
      );
    if (e.key === "Home") step = 0;
    if (e.key === "End") step = 15;
    const selector = drums ? "[data-st-step]" : "[data-can-note]",
      next = root.querySelector(
        drums
          ? `[data-st-step="${compositionRegistry.roleOrder[row]}:${step}"]`
          : `[data-can-note="${step}"]`,
      );
    if (!next || next.disabled) return;
    e.preventDefault();
    for (const button of root.querySelectorAll(selector)) button.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  });
  listen(document, "keydown", (e) => {
    if (
      e.defaultPrevented ||
      e.repeat ||
      e.target.closest("input,textarea,select,button,a,[contenteditable]")
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const button = $(e.shiftKey ? "redo" : "undo");
      if (!button.disabled) button.click();
      return;
    }
    if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      $(
        panel.controller.snapshot().status === "playing" ? "pause" : "play",
      ).click();
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-8]$/.test(e.key)) {
      const button = root.querySelectorAll("[data-st-pad]")[Number(e.key) - 1];
      if (!button.disabled) {
        e.preventDefault();
        button.click();
      }
    }
  });
  listen(source, "change", () => {
    sourceId = source.value;
    return panel.controller.edited().then(render);
  });
  listen(root, "change", (e) => {
    const t = e.target;
    if (t.id === "st-quantize") {
      quantizePads = t.checked;
      return;
    }
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
    if (t.dataset.canEqField !== undefined) {
      const id = t.closest("[data-can-bus]").dataset.canBus,
        field = t.dataset.canEqField,
        value = t.type === "checkbox" ? t.checked : Number(t.value);
      return mutate(() =>
        editor.edit((p) => {
          p.tracks.find((t) => t.id === id).fx.eq[field] = value;
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
    if (t.dataset.canCreateGamelan !== undefined && !t.disabled) {
      const instrument = instrumentChoice.value,
        laras = larasChoice.value;
      return mutate(async () => {
        let material, output;
        try {
          material = await createCanonicalGamelanMaterial({
            project: editor.snapshot().project,
            registry,
            memory,
            instrument,
            laras,
          });
          output = await exportCanonicalPackage(material, { memory });
          await workflow.importFile(output.blob, { mode: "add" });
        } finally {
          output?.release();
          material?.dispose();
        }
      });
    }
    if (t.dataset.canRackAdd !== undefined && !t.disabled) {
      const instrument = rackInstrument.value,
        sampleId = rackNote.value;
      return mutate(async () => {
        let material, output;
        try {
          material = await createCanonicalRackMaterial({
            project: editor.snapshot().project,
            registry,
            memory,
            instrument,
            sampleId,
          });
          output = await exportCanonicalPackage(material, { memory });
          await workflow.importFile(output.blob, { mode: "add" });
        } finally {
          output?.release();
          material?.dispose();
        }
      });
    }
    if (t.dataset.stPad !== undefined && !t.disabled)
      return auditionPad(t.dataset.stPad);
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
      projectLibrary.guarded(async () => {
        const candidate = await loadDemo($("demo-kind").value);
        try {
          await workflow.replaceProject(candidate);
        } finally {
          candidate.dispose();
        }
        await projectLibrary.refresh({ reset: true });
      }),
  );
  listen($("cancel"), "click", () => {
    workflow.cancel();
    panel.cancelExport();
  });
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
      return mode === "replace"
        ? projectLibrary.guarded(() =>
            workflow.importFile(file, { mode, bars }),
          )
        : mutate(() => workflow.importFile(file, { mode, bars }));
    }
  });
  root.dataset.canonicalEditable = "true";
  $("master").max = 1;
  if (
    import.meta.env.DEV ||
    import.meta.env.CANONICAL_LOCAL_REVIEW ||
    import.meta.env.CANONICAL_FINAL_STUDIO ||
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
  if (!import.meta.env.CANONICAL_PUBLIC_PREVIEW)
    captureTools = initCanonicalCapturePanel({
      root,
      editor,
      workflow,
      registry,
      memory,
      locale,
      signal: life.signal,
      stopPlayback: () => panel.controller.stop(),
      applyTransaction: transaction,
      deliver: deliverBlob,
      onChange: () => locks(),
    });
  recordingTools = initCanonicalRecordingTools({
    root,
    editor,
    registry,
    memory,
    locale,
    mutate,
    signal: life.signal,
    preview: (make) =>
      mutate(() => {
        const p = make();
        return panel.controller.play(p, {
          command:
            p.transport.kind === "legacy-continuous"
              ? { kind: "window", bars: 4, cycles: 1 }
              : undefined,
        });
      }),
  });
  render();
  if (recover)
    try {
      await workflow.load({ allowMissing: true });
    } catch (e) {
      if (e.code === "missingProject") status(c.idle);
      else showError(e);
    }
  render();
  try {
    await projectLibrary.refresh();
  } catch (e) {
    showError(e);
  }
  analytics.open();
  return Object.freeze({
    editor,
    controller: panel.controller,
    workflow,
    storage,
    transaction,
    deliver: deliverBlob,
    readSource: chooseSource,
    subscribe(fn) {
      observers.add(fn);
      return () => observers.delete(fn);
    },
    snapshot: () => ({
      editor: editor.snapshot(),
      workflow: workflow.snapshot(),
      memory: memory.snapshot(),
      pendingTasks: pending.size + (captureTools?.blocked() ? 1 : 0),
    }),
    isDirty,
    async dispose() {
      disposed = true;
      const fileClose = wavDelivery.dispose();
      life.abort();
      projectLibrary.dispose();
      observers.clear();
      root
        .querySelectorAll("button,input,select")
        .forEach((el) => (el.disabled = true));
      for (const row of urls.values()) row.done();
      await captureTools?.dispose();
      await recordingTools.dispose();
      const audioClose = panel.dispose(),
        editorClose = editor.dispose();
      audioClose.catch(() => {});
      editorClose.catch(() => {});
      await workflow.dispose();
      await Promise.allSettled([...pending]);
      const closed = await Promise.allSettled([
        audioClose,
        editorClose,
        fileClose,
      ]);
      const failed = closed.find((r) => r.status === "rejected");
      if (failed) throw failed.reason;
    },
  });
}
