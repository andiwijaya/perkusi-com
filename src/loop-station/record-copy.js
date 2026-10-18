export const recordCopy = {
  id: {
    title: "Rekam ke track",
    jsonGuard:
      "Take sesi belum ikut proyek. Tambahkan take penuh ke proyek + simpan audio, atau unduh WAV. Tinjau lalu buang salinan sesi sebelum mengunduh proyek.",
    intro: "Pilih track kosong dan instrumen, lalu siapkan, mainkan dan rekam.",
    prepare: "Siapkan instrumen",
    instrument: "Instrumen untuk disiapkan",
    instruments: {
      "saron-barung": "Saron Preview",
      slenthem: "Slenthem Preview",
      "drum-ruang": "Drum sintetis · Ruang",
      "drum-arus": "Drum sintetis · Arus",
      "electric-bass": "Bass petik rekaman - Preview",
      "classical-guitar": "Gitar klasik rekaman - Preview",
    },
    sulingPending:
      "Suling ditunda dari cakupan V5 dan belum tersedia di aplikasi.",
    melodicSource: "3 nada rekaman asli",
    melodicKeys:
      "A S D: E1/G1/B1 pada bass atau B2/E3/G3 pada gitar. Tahan untuk mendengar decay rekaman; lepaskan untuk fade release. Maksimum 2 suara bass / 3 suara gitar termasuk release. Tidak ada transpose atau stretch.",
    notes: {
      "bass-e1": "E1",
      "bass-g1": "G1",
      "bass-b1": "B1",
      "guitar-b2": "B2",
      "guitar-e3": "E3",
      "guitar-g3": "G3",
    },
    drums: {
      kick: "Kick",
      snare: "Snare",
      "closed-hat": "Hi-hat tertutup",
      "open-hat": "Hi-hat terbuka",
      clap: "Tepuk",
      tom: "Tom",
      rim: "Rim",
      shaker: "Shaker",
    },
    drumSource: "8 pad · maksimum 4 bunyi bersamaan",
    drumKeys:
      "Ketuk A S D F G H J K atau pad. Bunyi selesai alami saat dilepas. Hi-hat tertutup meredam hi-hat terbuka. Maksimum 4 bunyi bersamaan; pukulan berikutnya ditolak saat penuh.",
    source: "2 nada",
    noSource: "Belum ada instrumen siap",
    monitor: "Monitor mengikuti mixer track: volume, mute, solo, dan pan.",
    keys: "Tahan A / S atau pad untuk memainkan; lepaskan untuk meredam.",
    pad: "Nada",
    bars: "Panjang loop",
    bar: "bar",
    barsPlural: "bar",
    countIn: "Hitungan masuk: 1 bar",
    record: "Rekam",
    preview: "Mulai pratinjau sumber 4 bar",
    previewHint:
      "Putar pratinjau terbatas, lalu tekan Rekam. Setelah sumber selesai, monitor dan rekaman tetap berjalan.",
    sourcePlaying: "Pratinjau sumber sedang berjalan.",
    sourceFinished:
      "Pratinjau sumber selesai. Monitor dan take sesi mengikuti kontrol rekaman.",
    partialEnd: "Audio dipertahankan sampai posisi",
    retainedFrames: "Frame dalam take",
    receivedFrames: "Frame diterima",
    intendedFrames: "Target frame",
    recoveredFrames: "Frame tambahan dalam take saat penutupan",
    unknownCount: "tidak tersedia",
    suspended:
      "Audio terjeda. Take dapat menyertakan paket yang diterima saat penutupan. Bagian rekaman yang tidak tersimpan tidak direkonstruksi.",
    interrupted:
      "Audio terputus. Tinjau take parsial sebelum mengunduh atau membuangnya.",
    recover: "Tutup audio bermasalah, pertahankan take",
    stop: "Hentikan rekaman / replay",
    cancel: "Batalkan rekaman",
    save: "Simpan take sesi",
    play: "Putar take aktif",
    undo: "Urungkan take",
    redo: "Ulangi take",
    wav: "Unduh WAV",
    discardCurrent: "Buang take ini",
    discardAll: "Buang audio sesi",
    confirm: "Ya, buang audio",
    keep: "Tetap simpan",
    discardWarning:
      "Salinan audio sesi yang dibuang tidak dapat dipulihkan. Unduh WAV atau tambahkan ke proyek dahulu jika perlu. Audio yang sudah disalin ke proyek tetap tersimpan.",
    warning:
      "Audio take sesi hanya di memori tab ini. Unduh WAV atau tambahkan take penuh ke proyek + simpan audio sebelum keluar. JSON saja tidak membawa audio.",
    pending:
      "Hentikan replay untuk menyimpan take penuh. Take parsial hanya dapat diunduh atau dibuang.",
    library: "Take sesi",
    empty: "Belum ada take. Rekaman selesai akan berulang otomatis.",
    active: "Aktif",
    archive: "Arsip",
    partial: "Parsial",
    track: "Track",
    take: "Take",
    seconds: "dtk",
    states: {
      idle: "Siapkan instrumen pada track kosong.",
      preparing: "Menyiapkan audio…",
      ready: "Siap dimainkan dan direkam",
      "other-track": "Siapkan instrumen untuk track tujuan yang dipilih",
      armed: "Menunggu bar berikutnya",
      counting: "Hitungan masuk",
      recording: "Merekam",
      looping: "Rekaman selesai · berulang",
      partial: "Take parsial · unduh atau buang",
      stopped: "Take siap ditinjau",
      saved: "Take tersimpan di sesi ini",
      cancelled: "Rekaman dibatalkan",
      closing: "Menghentikan audio…",
      "closing-error": "Pelepasan audio perlu ditinjau",
      error: "Audio perlu ditinjau; take tetap dipertahankan",
    },
    errors: {
      audioRecovered:
        "Audio ditutup. Take parsial tetap tersedia untuk diunduh atau ditinjau. Buang salinan sesi setelah selesai sebelum menyiapkan audio kembali.",
      takeRateMismatch:
        "Instrumen kandidat ini memerlukan sesi 48 kHz. Proyek tetap dipertahankan.",
      recorderEmptyTarget:
        "Pilih track kosong untuk instrumen. Track berisi sumber tetap dipertahankan.",
      captureTakeNeedsReview:
        "Unduh WAV lalu buang audio sesi sebelum mengganti proyek atau keluar.",
      instrumentNotReady:
        "Siapkan instrumen pada track yang dipilih terlebih dahulu.",
      captureTakeHeld: "Hentikan rekaman / replay dahulu untuk meninjau take.",
      partialTakeNeedsReview:
        "Take parsial dipertahankan. Unduh WAV atau buang take ini.",
    },
  },
  en: {
    title: "Record to track",
    jsonGuard:
      "Session takes are not in the project yet. Add a complete take to the project + save audio, or download WAV. Review, then discard session copies before downloading the project.",
    intro:
      "Choose an empty track and instrument, then prepare, play and record.",
    prepare: "Prepare instrument",
    instrument: "Instrument to prepare",
    instruments: {
      "saron-barung": "Saron Preview",
      slenthem: "Slenthem Preview",
      "drum-ruang": "Synthetic drums · Ruang",
      "drum-arus": "Synthetic drums · Arus",
      "electric-bass": "Recorded picked bass - Preview",
      "classical-guitar": "Recorded classical guitar - Preview",
    },
    sulingPending:
      "Suling is deferred from the V5 scope and is not available in the app.",
    melodicSource: "3 original recorded notes",
    melodicKeys:
      "A S D: E1/G1/B1 on bass or B2/E3/G3 on guitar. Hold for the recorded decay, then release to fade. Maximum 2 bass / 3 guitar voices including release. No transpose or stretch.",
    notes: {
      "bass-e1": "E1",
      "bass-g1": "G1",
      "bass-b1": "B1",
      "guitar-b2": "B2",
      "guitar-e3": "E3",
      "guitar-g3": "G3",
    },
    drums: {
      kick: "Kick",
      snare: "Snare",
      "closed-hat": "Closed hi-hat",
      "open-hat": "Open hi-hat",
      clap: "Clap",
      tom: "Tom",
      rim: "Rim",
      shaker: "Shaker",
    },
    drumSource: "8 pads · maximum 4 simultaneous voices",
    drumKeys:
      "Tap A S D F G H J K or a pad. Release lets the sound finish naturally. Closed hi-hat chokes open hi-hat. Maximum 4 simultaneous voices; another hit is refused while full.",
    source: "2 notes",
    noSource: "No instrument ready",
    monitor: "Monitoring follows the track mixer: volume, mute, solo and pan.",
    keys: "Hold A / S or a pad to play; release to damp.",
    pad: "Note",
    bars: "Loop length",
    bar: "bar",
    barsPlural: "bars",
    countIn: "Count-in: 1 bar",
    record: "Record",
    preview: "Start 4-bar source preview",
    previewHint:
      "Start the finite preview, then press Record. Monitoring and recording continue after the source finishes.",
    sourcePlaying: "Source preview is playing.",
    sourceFinished:
      "Source preview finished. Monitoring and session takes follow the recording controls.",
    partialEnd: "Audio retained through position",
    retainedFrames: "Frames in take",
    receivedFrames: "Frames received",
    intendedFrames: "Intended frames",
    recoveredFrames: "Additional frames retained during closure",
    unknownCount: "unavailable",
    suspended:
      "Audio was suspended. The take may include packets received during closure. Missing recording time was not reconstructed.",
    interrupted:
      "Audio was interrupted. Review the partial take before downloading or discarding it.",
    recover: "Close interrupted audio, keep take",
    stop: "Stop recording / replay",
    cancel: "Cancel recording",
    save: "Save session take",
    play: "Play active take",
    undo: "Undo take",
    redo: "Redo take",
    wav: "Download WAV",
    discardCurrent: "Discard this take",
    discardAll: "Discard session audio",
    confirm: "Yes, discard audio",
    keep: "Keep audio",
    discardWarning:
      "Discarded session copies cannot be recovered. Download WAV or add to the project first if needed. Audio already copied to the project stays saved.",
    warning:
      "Session take audio lives only in this tab's memory. Download WAV or add a complete take to the project + save audio before leaving. JSON alone does not include audio.",
    pending:
      "Stop replay to save a complete take. Partial takes can only be downloaded or discarded.",
    library: "Session takes",
    empty: "No take yet. A completed recording repeats automatically.",
    active: "Active",
    archive: "Archive",
    partial: "Partial",
    track: "Track",
    take: "Take",
    seconds: "s",
    states: {
      idle: "Prepare an instrument on an empty track.",
      preparing: "Preparing audio…",
      ready: "Ready to play and record",
      "other-track": "Prepare an instrument for the selected target track",
      armed: "Waiting for the next bar",
      counting: "Count-in",
      recording: "Recording",
      looping: "Recording complete · repeating",
      partial: "Partial take · download or discard",
      stopped: "Take ready to review",
      saved: "Take saved in this session",
      cancelled: "Recording cancelled",
      closing: "Stopping audio…",
      "closing-error": "Audio cleanup needs review",
      error: "Audio needs review; your take is retained",
    },
    errors: {
      audioRecovered:
        "Audio closed. Your partial take remains available for download or review. Discard session copies after reviewing them before preparing audio again.",
      takeRateMismatch:
        "This instrument candidate requires a 48 kHz session. Your project is retained.",
      recorderEmptyTarget:
        "Choose an empty track for the instrument. Tracks with sources are retained.",
      captureTakeNeedsReview:
        "Download WAV and discard session audio before replacing the project or leaving.",
      instrumentNotReady: "Prepare an instrument on the selected track first.",
      captureTakeHeld: "Stop recording / replay first to review the take.",
      partialTakeNeedsReview:
        "Your partial take is retained. Download WAV or discard this take.",
    },
  },
};

// Describe retained audio separately from received receipts and the intended
// window. Closing a recorder may still receive a final short PCM packet.
export function partialTakeStatus(snapshot, locale) {
  const { take, plan, outcome } = snapshot ?? {};
  if (!take?.partial) return null;
  const t = recordCopy[locale],
    count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null),
    retainedFrames = count(take.frames),
    receivedFrames = count(outcome?.acknowledgedFrames),
    intendedFrames =
      count(take.capacity) ?? count(plan?.endFrame - plan?.startFrame),
    atInterruption = count(outcome?.terminalCause?.acknowledgedFramesAtCancel),
    recoveredFrames =
      retainedFrames !== null &&
      atInterruption !== null &&
      retainedFrames >= atInterruption
        ? retainedFrames - atInterruption
        : null,
    retainedEndFrame = count(take.startFrame + take.frames),
    acknowledgedEndFrame = count(outcome?.acknowledgedEndFrame),
    cause = outcome?.terminalCause?.code ?? outcome?.reason ?? "",
    seconds =
      Number.isFinite(take.sampleRate) && take.sampleRate > 0
        ? (frames) => (frames / take.sampleRate).toFixed(3)
        : () => t.unknownCount,
    display = (v) => v ?? t.unknownCount,
    parts = [
      t.partial,
      `${t.retainedFrames}: ${display(retainedFrames)} / ${t.intendedFrames}: ${display(intendedFrames)}`,
      `${t.receivedFrames}: ${display(receivedFrames)}`,
    ];
  if (retainedFrames !== null)
    parts.push(`${seconds(retainedFrames)} ${t.seconds}`);
  if (retainedEndFrame !== null)
    parts.push(`${t.partialEnd} ${seconds(retainedEndFrame)} ${t.seconds}`);
  if (recoveredFrames > 0)
    parts.push(`${t.recoveredFrames}: ${recoveredFrames}`);
  return {
    retainedFrames,
    receivedFrames,
    intendedFrames,
    recoveredFrames,
    retainedEndFrame,
    acknowledgedEndFrame,
    cause,
    text:
      parts.join(" · ") +
      ". " +
      (cause === "contextSuspended" ? t.suspended : t.interrupted),
  };
}
