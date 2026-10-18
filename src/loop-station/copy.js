export const loopCopy = {
  id: {
    latestBackup: "Unduh draf terbaru",
    loadLatest: "Unduh salinan tab ini dan muat draf terbaru",
    title: "Loop Station",
    preview:
      "Pratinjau: delapan track berbagi satu tempo. Drum Ruang/Arus, bass petik dan gitar klasik rekaman, serta Saron/Slenthem Preview; penyimpanan audio dan overdub tersedia.",
    steps:
      "Muat sumber untuk menyusun track, atau pilih track kosong, siapkan instrumen Preview, lalu mainkan dan rekam.",
    play: "Putar semua",
    pause: "Jeda",
    resume: "Lanjutkan",
    stop: "Berhenti",
    newProject: "Proyek kosong",
    starters: "Mulai dari groove",
    starterHint:
      "1. Muat starter. 2. Putar semua. 3. Pilih track kosong untuk merekam. Bass/gitar memakai nada rekaman asli; starter memerlukan sesi48 kHz. Listening dan suling masih menunggu verifikasi.",
    starterKey: "E minor - rekaman nada asli",
    loadStarter: "Muat starter",
    demo: "Contoh delapan track",
    save: "Unduh proyek",
    load: "Muat proyek / sumber",
    target: "Track tujuan",
    incoming: "Gunakan sumber Gamelan",
    undo: "Urungkan",
    redo: "Ulangi",
    clear: "Kosongkan track",
    clone: "Salin ke track kosong",
    repeat: "Ulang sumber lengkap",
    gain: "Volume",
    masterVolume: "Volume master",
    masterHint:
      "Atur volume perangkat rendah dahulu, lalu sesuaikan master. Tidak mengubah rekaman asli.",
    pan: "Kiri / kanan",
    mute: "Bisukan",
    solo: "Solo",
    track: "Track",
    empty: "Belum ada sumber",
    stopTrack: "Hentikan track",
    resumeTrack: "Masuk di bar berikutnya",
    view: "Tampilan Studio",
    simple: "Tampilan ringkas",
    page: "Track yang ditampilkan",
    consent:
      "Saya memilih mencampur laras / materi bernada yang berbeda tanpa menyetem ulang sumber.",
    options: "Pengaturan track",
    tuning: "Campuran laras",
    culture:
      "Sampel asli Preview. Penilaian budaya dan listening pada perangkat fisik belum selesai.",
    recovery:
      "Draf tidak bisa dibuka. Salinan asal dipertahankan; unduh sebelum memulai proyek baru.",
    raw: "Unduh draf asal",
    new: "Simpan salinan pemulihan dan mulai baru",
    state: {
      finished: "Selesai",
      stopped: "Berhenti",
      playing: "Memutar",
      paused: "Dijeda",
      loading: "Memuat",
      error: "Perlu tindakan",
      closed: "Audio ditutup",
    },
    errors: {
      captureTakeNeedsReview:
        "Take rekaman masih dipertahankan di memori. Selesaikan peninjauan take sebelum mengganti proyek atau meninggalkan halaman.",
      draftConflict:
        "Draf tersimpan telah berubah di tab lain. Perubahan tab ini tetap dapat diedit dan diunduh. Unduh salinan sebelum memuat draf terbaru.",
      draftLockUnavailable:
        "Penyimpanan antar-tab tidak tersedia. Proyek tetap dapat diedit dan diunduh di tab ini.",
      legacyRepeatNeedsTailAdapter:
        "Repeat mempertahankan resonansi lintas siklus. Preview dan WAV menyertakan tail akhir.",
      legacyLoopClockUnsupported:
        "Periode sumber ini belum mendukung Repeat tepat pada frame bersama. Gunakan putar sekali; sumber tetap utuh.",
      legacyRegionUnsupported:
        "Repeat pola lama memerlukan panjang score lengkap. Sumber tetap utuh.",
      loopSourceLimit:
        "Batas delapan arsip sumber tercapai. Unduh proyek atau mulai proyek kosong; sumber asal tetap utuh.",
      projectTooLarge:
        "Ukuran proyek atau sumber melebihi batas yang didukung. Proyek aktif tetap utuh.",
      generic: "Tindakan belum berhasil. Proyek tetap dipertahankan.",
      loopTempoLocked:
        "Tempo sumber berbeda dari track yang sudah ada. Proyek asal tetap utuh.",
      voiceLimit:
        "Pola ini memerlukan terlalu banyak suara bersamaan. Kurangi lapisan atau panjang resonansi.",
      voiceHeadroom:
        "Gabungan level terlalu tinggi. Turunkan volume track sebelum memutar.",
      micHeadphonesRequired:
        "Gunakan headphone berkabel dengan volume rendah, lalu centang konfirmasi sebelum mengaktifkan monitoring.",
      invalidPhaseAlignment:
        "Posisi loop memerlukan rekaman periode lengkap dan nilai antara −250 hingga 250 ms. Audio asli tetap utuh.",
      missingRecording:
        "Proyek merujuk rekaman yang belum tersedia. Sumber dan metadata tetap disimpan.",
      loopPeriodMismatch:
        "Panjang rekaman tidak cocok dengan periode bersama. Audio asal tetap utuh.",
      takeRateMismatch:
        "Sample rate rekaman berbeda dari sesi ini. Proyek tetap utuh.",
      mixProgramLate:
        "Perubahan mixer terlambat. Coba lagi; proyek tetap utuh.",
      replayLate:
        "Pemutaran berhenti karena browser terlambat menjadwalkan audio. Coba lagi; proyek tetap utuh.",
      recordingLoopEnded:
        "Replay rekaman berhenti tanpa perintah. Take asli tetap dipertahankan.",
      recordingLoopCompletionUnverified:
        "Replay rekaman berakhir, tetapi pemutaran lengkapnya belum dapat dipastikan. Pemutaran dihentikan; take asli tetap utuh.",
      tuningConsentRequired:
        "Materi bernada berbeda memerlukan persetujuan campuran. Pilih opsi persetujuan bila memang diinginkan.",
      routeConflict:
        "Draf belum dapat disimpan. Unduh proyek sebelum meninggalkan halaman.",
      loopClosePending:
        "Audio masih menyelesaikan pelepasan. Coba lagi setelah berhenti.",
      combinedMemoryLimit:
        "Memori audio tidak cukup untuk pola ini. Kurangi lapisan atau durasi.",
      draftRecoveryRequired: "Selesaikan pemulihan draf sebelum menggantinya.",
      trackLimit:
        "Delapan track sudah terisi. Kosongkan salah satu track terlebih dahulu.",
      recordBusy: "Tunggu audio berhenti atau selesai memuat, lalu coba lagi.",
    },
  },
  en: {
    latestBackup: "Download latest saved draft",
    loadLatest: "Back up this tab and load latest draft",
    title: "Loop Station",
    preview:
      "Preview: eight tracks share one tempo. Ruang/Arus drums, recorded picked bass and classical guitar, Saron/Slenthem Preview, saved audio and overdub are available.",
    steps:
      "Load a source to arrange tracks, or choose an empty track, prepare a Preview instrument, then play and record.",
    play: "Play all",
    pause: "Pause",
    resume: "Continue",
    stop: "Stop",
    newProject: "Blank project",
    starters: "Start with a groove",
    starterHint:
      "1. Load a starter. 2. Play all. 3. Choose an empty track to record. Bass/guitar use original recorded notes; starters require48 kHz. Listening and suling remain pending.",
    starterKey: "E minor - original recorded notes",
    loadStarter: "Load starter",
    demo: "Eight-track example",
    save: "Download project",
    load: "Load project / source",
    target: "Target track",
    incoming: "Use Gamelan source",
    undo: "Undo",
    redo: "Redo",
    clear: "Clear track",
    clone: "Copy to empty track",
    repeat: "Repeat complete source",
    gain: "Volume",
    masterVolume: "Master volume",
    masterHint:
      "Start with low device volume, then adjust the master. Original recordings stay unchanged.",
    pan: "Left / right",
    mute: "Mute",
    solo: "Solo",
    track: "Track",
    empty: "No source yet",
    stopTrack: "Stop track",
    resumeTrack: "Join at next bar",
    view: "Studio view",
    simple: "Compact view",
    page: "Visible tracks",
    consent:
      "I choose to mix different tuning / pitched material without retuning the sources.",
    options: "Track options",
    tuning: "Tuning mix",
    culture:
      "Original Preview samples. Cultural and physical-device listening review remain open.",
    recovery:
      "The draft cannot be opened. Its original text is retained; download it before starting a new project.",
    raw: "Download original draft",
    new: "Save recovery copy and start fresh",
    state: {
      finished: "Finished",
      stopped: "Stopped",
      playing: "Playing",
      paused: "Paused",
      loading: "Loading",
      error: "Action needed",
      closed: "Audio closed",
    },
    errors: {
      captureTakeNeedsReview:
        "The recorded take is retained in memory. Review the take before replacing the project or leaving this page.",
      draftConflict:
        "Another tab changed the saved draft. This tab remains editable and downloadable. Back up your copy before loading the latest draft.",
      draftLockUnavailable:
        "Safe shared saving is unavailable. You can still edit and download this tab project.",
      legacyRepeatNeedsTailAdapter:
        "Repeat preserves resonance across cycles. Preview and WAV include the final tail.",
      legacyLoopClockUnsupported:
        "This source period does not yet support exact shared-frame Repeat. Use one-shot playback; your source is retained.",
      legacyRegionUnsupported:
        "Legacy Repeat requires the complete score region. Your source is retained.",
      loopSourceLimit:
        "The eight-source archive limit is reached. Download the project or start a blank project; originals are retained.",
      projectTooLarge:
        "The project or source exceeds the supported size. Your current project is retained.",
      generic: "This action could not complete. Your project is retained.",
      loopTempoLocked:
        "The source tempo differs from existing tracks. Original projects are retained.",
      voiceLimit:
        "This pattern needs too many simultaneous voices. Reduce layers or resonance length.",
      voiceHeadroom:
        "Combined levels are too high. Lower track volumes before playback.",
      micHeadphonesRequired:
        "Use wired headphones at low volume and check the confirmation before enabling monitoring.",
      invalidPhaseAlignment:
        "Loop alignment requires a complete recorded period and a value between −250 and 250 ms. Original audio remains intact.",
      missingRecording:
        "The project references recording bytes that are not available yet. Sources and metadata are retained.",
      loopPeriodMismatch:
        "The recording length does not match the shared period. Original audio is retained.",
      takeRateMismatch:
        "The recording sample rate differs from this session. Your project is retained.",
      mixProgramLate:
        "The mixer change missed its schedule. Try again; your project is retained.",
      replayLate:
        "Playback stopped because the browser could not schedule audio in time. Try again; your project is retained.",
      recordingLoopEnded:
        "Recorded playback ended unexpectedly. Your original take is retained.",
      recordingLoopCompletionUnverified:
        "Recorded playback ended, but complete playback could not be verified. Playback stopped; your original take is retained.",
      tuningConsentRequired:
        "Mixing different pitched material requires deliberate consent. Select the mix consent option if intended.",
      routeConflict:
        "The draft could not be saved. Download your project before leaving.",
      loopClosePending:
        "Audio is still releasing its resources. Try again after it stops.",
      combinedMemoryLimit:
        "There is not enough audio memory for this pattern. Reduce layers or duration.",
      draftRecoveryRequired: "Complete draft recovery before replacing it.",
      trackLimit: "All eight tracks are filled. Clear a track first.",
      recordBusy: "Wait for playback or loading to stop, then try again.",
    },
  },
};
