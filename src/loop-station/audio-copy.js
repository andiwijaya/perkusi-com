export const audioCopy = {
  id: {
    adopt: "Tambahkan ke proyek + simpan audio",
    save: "Simpan proyek di browser",
    download: "Unduh proyek + audio",
    load: "Buka proyek / paket audio",
    cancel: "Batalkan penyimpanan / impor",
    restoring: "Memulihkan proyek dan memeriksa audio…",
    working:
      "Memeriksa / menyimpan audio… Proyek sebelumnya tetap tersedia sampai selesai.",
    saved:
      "Proyek dan audio tersimpan di browser ini. Unduh paket proyek sebagai cadangan; data browser dapat terhapus.",
    unavailable:
      "Penyimpanan audio browser tidak tersedia. Take sesi dan WAV tetap dapat digunakan.",
    adopted:
      "Take telah disalin ke track proyek dan disimpan bersama audio. Salinan sesi tetap utuh; buang salinan sesi bila selesai meninjaunya, lalu unduh paket proyek.",
    recording: "Rekaman",
    errors: {
      audioStorageUnavailable:
        "Penyimpanan audio tidak tersedia. Data sebelumnya dan take sesi tetap dipertahankan.",
      audioStorageWriteFailed:
        "Audio belum tersimpan. Data sebelumnya dan take sesi tetap dipertahankan; coba lagi atau unduh WAV.",
      audioStorageFull:
        "Ruang penyimpanan tidak cukup. Proyek sebelumnya dan take sesi tetap utuh. Unduh WAV atau paket cadangan.",
      missingRecording:
        "Audio proyek tidak lengkap. Buka paket proyek lengkap; metadata JSON saja tidak cukup.",
      recordingHashMismatch:
        "Pemeriksaan integritas audio/paket gagal. Proyek sebelumnya tetap dipertahankan.",
      invalidAudioBundle:
        "Paket proyek tidak valid atau terpotong. Proyek sebelumnya tetap dipertahankan.",
      invalidRecordingPCM:
        "Data audio tidak valid. Proyek sebelumnya tetap dipertahankan.",
      recordingCreditsRequired:
        "Kredit sumber audio hilang atau terlalu besar. Proyek sebelumnya tetap dipertahankan.",
      recordingPackageTooLarge:
        "Paket melampaui batas lokal: audio 16 MiB, manifest 3 MiB. Data sebelumnya tetap utuh.",
      recordingOffsetUnsupported:
        "Posisi atau periode rekaman ini belum didukung. Proyek sebelumnya tetap dipertahankan.",
      audioStorageMissing:
        "Data audio browser tidak ditemukan. Buka paket cadangan lengkap untuk memulihkan; metadata lama tidak digunakan otomatis.",
    },
  },
  en: {
    adopt: "Add to project + save audio",
    save: "Save project in browser",
    download: "Download project + audio",
    load: "Open project / audio bundle",
    cancel: "Cancel save / import",
    restoring: "Restoring project and checking audio…",
    working:
      "Checking / saving audio… The previous project stays available until completion.",
    saved:
      "Project and audio saved in this browser. Download a project bundle as a backup; browser data can be cleared.",
    unavailable:
      "Browser audio storage is unavailable. Session takes and WAV downloads remain usable.",
    adopted:
      "Take copied to a project track and saved with audio. The session copy is intact; discard session copies after review, then download the project bundle.",
    recording: "Recording",
    errors: {
      audioStorageUnavailable:
        "Audio storage is unavailable. The previous data and session takes are preserved.",
      audioStorageWriteFailed:
        "Audio was not saved. The previous data and session takes are preserved; retry or download WAV.",
      audioStorageFull:
        "Storage is full. The previous project and session takes are intact. Download WAV or a backup bundle.",
      missingRecording:
        "Project audio is incomplete. Open a complete project bundle; JSON metadata alone is insufficient.",
      recordingHashMismatch:
        "Audio/bundle integrity check failed. The previous project is preserved.",
      invalidAudioBundle:
        "The project bundle is invalid or truncated. The previous project is preserved.",
      invalidRecordingPCM:
        "Invalid audio data. The previous project is preserved.",
      recordingCreditsRequired:
        "Audio source credits are missing or too large. The previous project is preserved.",
      recordingPackageTooLarge:
        "Local package limit exceeded: 16 MiB audio, 3 MiB manifest. Previous data is intact.",
      recordingOffsetUnsupported:
        "This recording offset or period is not supported yet. The previous project is preserved.",
      audioStorageMissing:
        "Browser audio data is missing. Open a complete backup bundle to recover; old metadata is not loaded automatically.",
    },
  },
};
