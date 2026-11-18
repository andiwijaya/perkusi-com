export function copySaveErrorCode(code) {
  if (code === "storageUnavailable") return "copySaveUnavailable";
  if (code === "storageFull") return "copySaveFull";
  return code;
}

export const projectMessages = {
  id: {
    heading: "Simpan iramamu. Bawa pulang musiknya.",
    intro: "1. Beri nama  2. Simpan proyek  3. Buat WAV untuk dibagikan.",
    localNote:
      "Proyek disimpan di browser ini. Unduh file proyek sebagai cadangan; penyimpanan browser bisa dihapus perangkat.",
    title: "Nama proyek",
    untitled: "Iramaku",
    save: "Simpan proyek baru",
    savedList: "Proyek di browser ini",
    savedListUnavailable:
      "Daftar proyek belum bisa dibaca. Coba lagi setelah akses penyimpanan browser pulih.",
    reloadSavedList: "Muat ulang daftar proyek",
    choose: "Pilih proyek tersimpan",
    load: "Muat proyek",
    openSeparate: "Buka terpisah",
    separateLabel: "Salinan terpisah",
    separateLoadConfirm:
      "Buka “{title}” di tab ini? Proyek aktif di tab ini akan diganti. Draft bersama di browser tetap aman.",
    separateDraft:
      "Kamu sedang mengedit salinan di tab ini. Simpan proyek baru agar edit bisa dibuka lagi setelah tab ditutup.",
    copySaveUnavailable:
      "Salinan belum tersimpan. Edit masih ada di tab ini. Biarkan tab tetap terbuka, periksa ruang dan izin penyimpanan browser, lalu coba Simpan proyek baru lagi.",
    copySaveFull:
      "Penyimpanan proyek penuh. Salinan belum tersimpan dan edit masih ada di tab ini. Biarkan tab tetap terbuka. Coba Simpan proyek baru lagi setelah ada ruang.",
    returnToDraft: "Buka draft terbaru",
    returnToDraftConfirm:
      "Buka draft terbaru di tab ini? Jika lanjut, edit salinan yang belum disimpan sebagai proyek akan hilang. Untuk menyimpannya, batalkan lalu pilih Simpan proyek baru.",
    loadConfirm:
      "Muat simpanan “{title}” dan ganti proyek aktif beserta editnya? Simpan atau unduh proyek aktif lebih dulu jika ingin mempertahankannya.",
    loadCancelled: "Pemuatan dibatalkan. Proyek aktif dan editnya tetap ada.",
    remove: "Hapus proyek",
    deleteConfirm:
      "Hapus simpanan “{title}” dari browser? Proyek aktif, simpanan lainnya, dan file yang telah diunduh tetap ada.",
    exportProject: "Unduh proyek",
    importProject: "Impor proyek",
    fileLabel: "Pilih file .perkusi.json",
    fileHint:
      "Hanya file proyek .perkusi.json, maksimal 64 KB. Dibaca lokal; audio atau kode dari file tidak dimuat.",
    audioHeading: "Unduh audio",
    bars: "Panjang WAV",
    bars4: "4 bar · 10 detik",
    bars8: "8 bar · 20 detik",
    render: "Buat WAV",
    cancel: "Batalkan",
    download: "Unduh WAV",
    share: "Bagikan beat",
    shareDownload: "Unduh untuk berbagi",
    exportHint:
      "WAV memakai suara, variasi, dan volume pilihanmu saat dibuat, mulai dari bar pertama. Ini bukan rekaman perubahan selama bermain.",
    ready: "Proyek dan audio tetap di perangkatmu.",
    saved: "Proyek disimpan. Kamu bisa memuatnya setelah refresh.",
    loaded: "Proyek dimuat dan dijeda. Ketuk Putar untuk mulai.",
    deleted:
      "Simpanan terpilih dihapus. Proyek aktif dan simpanan lainnya tetap ada.",
    projectChanged:
      "Simpanan berubah atau sudah dihapus di tab lain. Daftar diperbarui; periksa pilihan sebelum melanjutkan. Proyek aktif tetap ada.",
    imported: "File proyek dimuat dan dijeda. Ketuk Putar untuk mulai.",
    projectDownloaded: "File proyek siap diunduh. Simpan sebagai cadangan.",
    recovered: "Edit terakhir dipulihkan. Ketuk Putar untuk mulai.",
    loading: "Menyiapkan suara untuk WAV…",
    rendering: "Menyusun audio…",
    encoding: "Menyiapkan file WAV…",
    cancelling: "Membatalkan; menunggu pekerjaan audio selesai…",
    cancelled: "Ekspor dibatalkan. Iramamu tetap ada.",
    exportReady: "WAV siap. Unduh atau bagikan file di bawah.",
    wavChanged:
      "Beat berubah. Tekan Buat WAV lagi untuk mengunduh versi terbaru.",
    fileSnapshot: "File ini memakai pilihan saat dibuat:",
    downloaded: "WAV siap diunduh.",
    shared: "File diserahkan ke menu berbagi perangkat.",
    shareCancelled: "Berbagi dibatalkan. WAV tetap tersedia.",
    shareFallback:
      "WAV siap diunduh. Buka file hasil unduhan dan bagikan lewat aplikasi pilihanmu.",
    invalidProject: "File proyek tidak valid. Iramamu tidak diubah.",
    invalidTitle: "Isi nama proyek dengan 1–80 karakter.",
    unsupportedVersion:
      "Versi proyek ini belum didukung. Iramamu tidak diubah.",
    unsupportedMode: "Proyek ini membutuhkan mode yang belum tersedia.",
    unknownPack:
      "Pack atau versi suara proyek ini belum tersedia. Iramamu tidak diubah.",
    projectTooLarge: "File proyek kosong atau lebih besar dari 64 KB.",
    fileReadFailed: "File belum bisa dibaca. Pilih lagi file proyeknya.",
    storageUnavailable:
      "Penyimpanan browser tidak tersedia atau datanya tidak valid. Kamu tetap bisa bermain dan mengunduh proyek/WAV.",
    draftConflict:
      "Draft sudah berubah di tab lain. Simpan edit dari tab ini sebagai proyek terpisah sebelum memuat ulang untuk membuka draft terbaru.",
    draftAutosaveUnavailable:
      "Autosave antar tab tidak tersedia di browser ini. Simpan edit sebagai proyek sebelum meninggalkan halaman.",
    storageFull:
      "Penyimpanan penuh (maksimal 30 proyek). Unduh cadangan, lalu hapus proyek yang tidak diperlukan.",
    missingProject: "Pilih proyek tersimpan terlebih dahulu.",
    emptyMix:
      "Aktifkan setidaknya satu suara dan naikkan volume sebelum membuat WAV.",
    exportLimit:
      "Memori untuk ekspor belum cukup. Coba 4 bar, tutup tab lain, atau gunakan perangkat lain.",
    exportBusy: "Tunggu ekspor yang sedang berjalan selesai.",
    assetFailed:
      "Suara belum bisa dimuat untuk ekspor. Periksa koneksi lalu coba lagi.",
    unsafeOutput:
      "Audio hasil ekspor tidak lolos pemeriksaan. Iramamu tetap ada; coba ulang.",
    exportFailed:
      "WAV belum bisa dibuat di browser ini. Coba lagi atau gunakan browser lain.",
    deliveryFailed: "Unduhan belum bisa dimulai. Coba lagi lewat tombol Unduh.",
  },
  en: {
    heading: "Keep your groove. Take the music with you.",
    intro: "1. Name it  2. Save the project  3. Make a WAV to share.",
    localNote:
      "Projects stay in this browser. Download a project file for backup; your device may clear browser storage.",
    title: "Project name",
    untitled: "My beat",
    save: "Save a new project",
    savedList: "Projects in this browser",
    savedListUnavailable:
      "The saved project list couldn't be read. Try again when browser storage is available.",
    reloadSavedList: "Reload project list",
    choose: "Choose a saved project",
    load: "Load project",
    openSeparate: "Open separately",
    separateLabel: "Separate copy",
    separateLoadConfirm:
      "Open “{title}” in this tab? It will replace this tab's active project. The shared browser draft stays safe.",
    separateDraft:
      "You're editing a copy in this tab. Use Save a new project to keep your changes after closing the tab.",
    copySaveUnavailable:
      "The copy could not be saved. Your edits are still in this tab. Keep it open, check available browser storage and site permissions, then try Save a new project again.",
    copySaveFull:
      "Project storage is full. The copy was not saved and your edits are still in this tab. Keep it open and try Save a new project again when there is room.",
    returnToDraft: "Open latest draft",
    returnToDraftConfirm:
      "Open the latest draft in this tab? If you continue, edits to this copy that you haven't saved as a project will be lost. To keep them, cancel and choose Save a new project.",
    loadConfirm:
      "Load saved project “{title}” and replace your active project and edits? Save or download your active project first if you want to keep it.",
    loadCancelled: "Loading cancelled. Your active project and edits remain.",
    remove: "Delete project",
    deleteConfirm:
      "Delete saved project “{title}” from this browser? Your active project, other saved projects and downloaded files remain.",
    exportProject: "Download project",
    importProject: "Import project",
    fileLabel: "Choose a .perkusi.json file",
    fileHint:
      "Project files only, up to 64 KB. Read locally; audio or code from the file is never loaded.",
    audioHeading: "Download audio",
    bars: "WAV length",
    bars4: "4 bars · 10 seconds",
    bars8: "8 bars · 20 seconds",
    render: "Make WAV",
    cancel: "Cancel",
    download: "Download WAV",
    share: "Share beat",
    shareDownload: "Download to share",
    exportHint:
      "WAV uses your selected sounds, variations and volume when you make it, starting at bar one. It does not record changes during playback.",
    ready: "Projects and audio stay on your device.",
    saved: "Project saved. Load it again after a refresh.",
    loaded: "Project loaded and paused. Tap Play to start.",
    deleted:
      "Selected saved project deleted. Your active project and other saves remain.",
    projectChanged:
      "The saved project changed or was deleted in another tab. The list has been refreshed; review your choice before continuing. Your active project remains.",
    imported: "Project file loaded and paused. Tap Play to start.",
    projectDownloaded:
      "Project file is ready to download. Keep it as a backup.",
    recovered: "Your last edits were restored. Tap Play to start.",
    loading: "Preparing sounds for WAV…",
    rendering: "Rendering audio…",
    encoding: "Preparing the WAV file…",
    cancelling: "Cancelling; waiting for audio work to finish…",
    cancelled: "Export cancelled. Your groove stays here.",
    exportReady: "WAV is ready. Download or share the file below.",
    wavChanged:
      "The beat changed. Press Make WAV again to download the latest version.",
    fileSnapshot: "This file uses the selection when it was made:",
    downloaded: "WAV is ready to download.",
    shared: "File handed to your device's share menu.",
    shareCancelled: "Sharing cancelled. Your WAV is still available.",
    shareFallback:
      "WAV is ready to download. Open the downloaded file and share it with your preferred app.",
    invalidProject: "Invalid project file. Your groove was not changed.",
    invalidTitle: "Enter a project name with 1–80 characters.",
    unsupportedVersion:
      "This project version is not supported yet. Your groove was not changed.",
    unsupportedMode: "This project needs a mode that is not available yet.",
    unknownPack:
      "This project's sound pack or version is not available. Your groove was not changed.",
    projectTooLarge: "The project file is empty or larger than 64 KB.",
    fileReadFailed:
      "The file could not be read. Choose the project file again.",
    storageUnavailable:
      "Browser storage is unavailable or its data is invalid. You can still play and download projects/WAV files.",
    draftConflict:
      "The draft changed in another tab. Save the edits in this tab as a separate project before reloading to open the latest draft.",
    draftAutosaveUnavailable:
      "Autosave across tabs is unavailable in this browser. Save your edits as a project before leaving this page.",
    storageFull:
      "Storage is full (up to 30 projects). Download a backup, then delete projects you no longer need.",
    missingProject: "Choose a saved project first.",
    emptyMix:
      "Enable at least one sound and turn up the volume before making a WAV.",
    exportLimit:
      "Not enough memory for export. Try 4 bars, close other tabs, or use another device.",
    exportBusy: "Wait for the current export to finish.",
    assetFailed:
      "Sounds could not load for export. Check your connection and try again.",
    unsafeOutput:
      "Exported audio did not pass checks. Your groove stays here; try again.",
    exportFailed:
      "This browser could not make the WAV. Try again or use another browser.",
    deliveryFailed:
      "The download could not start. Try the Download button again.",
  },
};
