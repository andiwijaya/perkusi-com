export const focusCopy = {
  id: {
    skip: "Lewati ke isi utama",
    candidate: "Kandidat lokal",
    title: "Mainkan bilah. Rekam iramamu.",
    intro:
      "Pilih satu perangkat rekaman, lalu mainkan nada-nadanya. Validasi budaya dan listening masih tertunda.",
    language: "English",
    enable: "Aktifkan audio",
    resume: "Aktifkan lagi",
    pause: "Jeda",
    instrument: "Instrumen",
    laras: "Laras",
    ensemble: "Tambah Kethuk, Kendhang & Gong",
    ready: "Seluruh bank siap dimainkan",
    starting: "Mengaktifkan audio…",
    paused: "Audio dijeda; bank tetap dimuat",
    preparing: "Menyiapkan take baru…",
    loading: "Memuat seluruh bank…",
    needsAudio: "Aktifkan audio untuk memuat instrumen",
    cancelled: "Pemuatan dibatalkan",
    error: "Instrumen belum siap",
    cancel: "Batalkan",
    retry: "Muat ulang",
    record: "Rekam permainan",
    finish: "Selesai merekam",
    replay: "Putar rekaman",
    clear: "Hapus event",
    damp: "Redam semua",
    guide: "Hat pendamping 96 BPM · sintesis lama",
    tempo: "Tempo",
    events: "Event terekam",
    voices: "Suara aktif",
    memory: "Admission audio",
    profile: "Profil audio",
    export: "Ekspor WAV",
    pauseExport: "Jeda, lepaskan audio & ekspor",
    cancelExport: "Batalkan ekspor",
    project: "Unduh proyek",
    import: "Buka proyek",
    releaseWav: "Lepaskan WAV dari memori",
    step1: "1 · Aktifkan audio",
    step2: "2 · Tahan bilah, lepas untuk meredam",
    step3: "3 · Rekam, lalu ekspor",
    keys: "Fokuskan bilah dengan Tab; A-J mengikuti urutan bilah hanya saat bilah mendapat fokus. Enter/Spasi memainkan bilah yang difokuskan. Gong berbunyi sampai tail selesai; Redam semua menghentikannya dengan fade.",
    recording:
      "Sedang merekam aksi pukul/redam (maks. 32 detik). Resonansi alami ikut ekspor.",
    replaying: "Memutar event dengan jam audio bersama",
    exporting: "Menyiapkan WAV dengan tail penuh…",
    saved: "WAV siap diunduh",
    credit:
      "Rekaman kandidat Digitopia_CdM / Casa da Música. Lisensi individual CC BY 3.0 terdokumentasi; validasi budaya, listening dan kualitas masih menunggu review. Pendamping hat berasal dari sintesis CC0 lama Perkusi.",
    errors: {
      combinedMemoryLimit:
        "Memori audio yang dimiliki saat ini tidak cukup. Gunakan Jeda, lepaskan audio & ekspor; rekamanmu tetap tersimpan.",
      cacheMemoryLimit:
        "Bank ini belum muat dalam batas memori. Hentikan suara/ekspor yang aktif dan coba lagi.",
      audioPaused: "Audio dijeda. Tekan Aktifkan lagi sebelum memainkan nada.",
      instrumentNotReady: "Tunggu seluruh bank siap atau muat ulang.",
      assetFailed: "File audio gagal dimuat. Coba muat ulang.",
      assetHash:
        "File audio tidak cocok dengan sumber terverifikasi. Pemuatan ditolak.",
      cancelled: "Operasi dibatalkan; event tetap tersimpan.",
      voiceHeadroom:
        "Nada baru ditolak untuk menjaga headroom. Redam suara yang masih aktif lalu coba lagi.",
      voiceLimit: "Batas suara aktif tercapai. Redam suara yang masih aktif.",
      eventLimit:
        "Batas event rekaman tercapai. Unduh proyek dan mulai take baru.",
      recordDurationLimit:
        "Rekaman telah mencapai 32 detik. Event yang sudah direkam tetap tersedia.",
      recordedTempoLocked:
        "Tempo dikunci untuk melindungi waktu rekaman. Hapus event sebelum mengganti tempo.",
      legacyTempo:
        "Pendamping ini direkam pada 96 BPM. Pilih 96 BPM sebelum menyalakannya.",
      legacyLayerUnsupported:
        "Lapisan komposisi lama yang aktif belum bisa dimainkan di preview ini. Proyek saat ini tetap utuh; buka proyek itu di Studio lama.",
      exportDurationLimit:
        "Ekspor preview dibatasi 90 detik termasuk seluruh tail. Proyek tetap utuh.",
      emptyMix:
        "Rekam setidaknya satu nada sebelum mengekspor atau memutar take.",
      exportBusy: "Ekspor masih aktif. Tunggu atau batalkan dulu.",
      recordBusy: "Selesaikan operasi rekam/putar yang aktif dulu.",
      audioClosing:
        "Audio sedang menutup resource. Tunggu sebentar lalu coba lagi.",
      unsupportedDecodeProfile:
        "Perangkat memakai sample rate yang belum didukung kandidat ini (44,1/48 kHz).",
      unsafeOutput: "Output melewati batas audio aman; ekspor ditolak.",
      projectTooLarge: "File proyek terlalu besar. Batas preview ini 1 MiB.",
      invalidInstrumentProject:
        "File bukan proyek instrumen yang valid. Proyek saat ini tetap utuh.",
      fallback:
        "Operasi belum berhasil. Rekaman yang ada tetap tersedia; coba kembali setelah menghentikan operasi aktif.",
    },
  },
  en: {
    skip: "Skip to main content",
    candidate: "Local candidate",
    title: "Play the bars. Record your rhythm.",
    intro:
      "Choose one recorded set and play its notes. Cultural validation and listening are pending.",
    language: "Bahasa Indonesia",
    enable: "Enable audio",
    resume: "Enable again",
    pause: "Pause",
    instrument: "Instrument",
    laras: "Laras",
    ensemble: "Add Kethuk, Kendhang & Gong",
    ready: "Complete bank ready to play",
    starting: "Enabling audio…",
    paused: "Audio paused; bank remains loaded",
    preparing: "Preparing a new take…",
    loading: "Loading the complete bank…",
    needsAudio: "Enable audio to load the instrument",
    cancelled: "Loading cancelled",
    error: "Instrument not ready",
    cancel: "Cancel",
    retry: "Reload bank",
    record: "Record performance",
    finish: "Finish recording",
    replay: "Play recording",
    clear: "Clear events",
    damp: "Damp all",
    guide: "96 BPM guide hat · legacy synthesis",
    tempo: "Tempo",
    events: "Recorded events",
    voices: "Active voices",
    memory: "Audio admission",
    profile: "Audio profile",
    export: "Export WAV",
    pauseExport: "Pause, release audio & export",
    cancelExport: "Cancel export",
    project: "Download project",
    import: "Open project",
    releaseWav: "Release WAV from memory",
    step1: "1 · Enable audio",
    step2: "2 · Hold a bar, release to damp",
    step3: "3 · Record, then export",
    keys: "Focus a bar with Tab; A-J follows the bar order only while a bar has focus. Enter/Space plays the focused bar. Gong rings through its full tail; Damp all ends it with a fade.",
    recording:
      "Recording strike/damp actions (up to 32 seconds). Natural tails remain in the export.",
    replaying: "Playing events on the shared audio clock",
    exporting: "Preparing a WAV with full tails…",
    saved: "WAV ready to download",
    credit:
      "Candidate recordings by Digitopia_CdM / Casa da Música. Individual CC BY 3.0 licenses are documented; culture, listening and quality approval remain pending. The guide hat uses Perkusi’s legacy CC0 synthesis.",
    errors: {
      combinedMemoryLimit:
        "Owned audio memory is insufficient. Use Pause, release audio & export; your recorded events remain intact.",
      cacheMemoryLimit:
        "This bank cannot yet fit within the memory budget. Stop active voices/exports and retry.",
      audioPaused: "Audio is paused. Enable again before playing a note.",
      instrumentNotReady: "Wait for the complete bank or reload it.",
      assetFailed: "An audio file could not load. Reload the bank.",
      assetHash:
        "The audio file does not match its verified source. Loading was refused.",
      cancelled: "Operation cancelled; recorded events remain intact.",
      voiceHeadroom:
        "The new note was refused to protect headroom. Damp active voices and retry.",
      voiceLimit: "The active voice limit was reached. Damp active voices.",
      eventLimit:
        "The event limit was reached. Download the project and begin a new take.",
      recordDurationLimit:
        "Recording reached 32 seconds. Existing recorded events remain available.",
      recordedTempoLocked:
        "Tempo is locked to protect recorded timing. Clear events before changing tempo.",
      legacyTempo:
        "This accompaniment was recorded at 96 BPM. Select 96 BPM before enabling it.",
      legacyLayerUnsupported:
        "Active legacy composition layers are not playable in this preview. Your current project remains intact; open that project in the existing Studio.",
      exportDurationLimit:
        "This preview exports up to 90 seconds including full tails. The project remains intact.",
      emptyMix: "Record at least one note before exporting or playing a take.",
      exportBusy: "Export is active. Wait or cancel it first.",
      recordBusy: "Finish the active recording/playback operation first.",
      audioClosing: "Audio resources are closing. Wait briefly and retry.",
      unsupportedDecodeProfile:
        "This device uses a sample rate outside the candidate’s 44.1/48 kHz profiles.",
      unsafeOutput: "Output exceeded the safe audio limit; export was refused.",
      projectTooLarge: "The project file exceeds this preview's 1 MiB limit.",
      invalidInstrumentProject:
        "This is not a valid instrument project. Your current project remains intact.",
      fallback:
        "The operation did not complete. Existing recorded events remain available; stop the active operation and retry.",
    },
  },
};
Object.assign(focusCopy.id, {
  stageTitle: "Panggung rekaman",
  stageHint:
    "Pilih fokus untuk memainkan setiap nada, atau pukul satu rekaman dari panggung. Katalog ini memiliki 12 nama; validasi budaya, listening, dan hak rilis masih terbuka.",
  chooseFocus: "Fokus",
  stageStrike: "Pukul",
  stageNotes: "rekaman",
  stageShared: "sumber bersama",
  toStudio: "Lanjutkan di Studio",
  stageIdle: "Belum dimuat",
  stageActive: "Siap",
  stageLoading: "Memuat",
  stageError: "Muat ulang",
  studioHistoryLimit:
    "Riwayat edit mencapai batas 2 MiB. Unduh proyek untuk backup sebelum memulai riwayat baru.",
});
Object.assign(focusCopy.en, {
  stageTitle: "Recorded instrument stage",
  stageHint:
    "Choose focus to play every note, or strike one recording from the stage. This catalogue has 12 names; cultural, listening and release-rights validation remain open.",
  chooseFocus: "Focus",
  stageStrike: "Strike",
  stageNotes: "recordings",
  stageShared: "shared source",
  toStudio: "Continue in Studio",
  stageIdle: "Not loaded",
  stageActive: "Ready",
  stageLoading: "Loading",
  stageError: "Retry",
  studioHistoryLimit:
    "Edit history reached its 2 MiB limit. Download a project backup before starting new history.",
});
for (const locale of ["id", "en"]) {
  focusCopy[locale].errors.tuningConsentRequired =
    locale === "id"
      ? "Bilah/loop D-minor dan laras rekaman berbeda. Pilih campuran ini secara eksplisit di Studio, atau mute salah satu lapisan. Proyek tetap utuh."
      : "Bilah/D-minor loops and recorded tuning banks differ. Explicitly choose this mix in Studio, or mute one layer. The project remains intact.";
  focusCopy[locale].errors.exportLimit =
    locale === "id"
      ? "Render skor legacy dibatasi 32 detik dan 32 MiB. Perpendek rangkaian; proyek tetap utuh."
      : "Legacy score rendering is bounded to 32 seconds and 32 MiB. Shorten the chain; the project remains intact.";
  focusCopy[locale].errors.studioHistoryLimit =
    focusCopy[locale].studioHistoryLimit;
  focusCopy[locale].errors.invalidStudioEdit =
    locale === "id"
      ? "Posisi atau kuat pukulan tidak valid. Event sebelumnya tetap utuh."
      : "Invalid position or strike strength. Previous events remain intact.";
  focusCopy[locale].errors.invalidCompositionEdit =
    locale === "id"
      ? "Nilai kontrol tidak valid. Nilai proyek yang sudah diterima tetap digunakan."
      : "Invalid control value. The previously accepted project value is restored.";
}
