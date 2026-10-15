export const routeCopy = {
  id: {
    studioTitle: "Studio Gamelan — Preview lokal",
    toStudio: "Buka halaman Studio",
    toGamelan: "Kembali ke halaman Gamelan",
    title: "Pindah workspace di tab ini",
    explain:
      "Proyek lengkap tetap editable, termasuk event, timing, bank, mix dan score legacy. Audio berhenti dan halaman tujuan dibuka dalam keadaan jeda. Draft Studio/Beatbox legacy tidak diubah.",
    session:
      "Draft ini mengikuti tab yang sama. Simpan proyek atau unduh backup sebelum menutup tab; tab lain punya draft terpisah. Undo/redo editor dimulai ulang setelah navigasi.",
    continue: "Simpan dan pindah",
    cancel: "Batal",
    raw: "Unduh data draft tab asli",
    original: "Unduh sumber sebelum perpindahan",
    restore: "Muat draft tab terbaru",
    fresh: "Buka workspace di tab baru",
    shared: "Muat draft Gamelan browser sebelumnya",
    restoreConfirm:
      "Muat draft tab terbaru akan mengganti proyek di halaman ini. Unduh proyek saat ini sebagai backup dahulu. Lanjutkan?",
    errors: {
      routeCorrupt:
        "Draft tab tidak valid dan data aslinya tidak ditimpa. Unduh proyek saat ini dan data draft asli; buka tab baru lalu impor backup proyek untuk melanjutkan.",
      routeConflict:
        "Draft tab telah berubah di luar halaman ini. Proyek di halaman ini tetap utuh; unduh backup lalu pilih Muat draft tab terbaru atau reload.",
      routeClosed:
        "Halaman lama sudah ditutup. Reload untuk memakai draft tab terbaru.",
      routeCleanup:
        "Tidak bisa menyelesaikan penutupan audio. Proyek lengkap sudah disimpan di tab ini; unduh backup dan reload sebelum melanjutkan.",
    },
  },
  en: {
    studioTitle: "Gamelan Studio — Local preview",
    toStudio: "Open Studio page",
    toGamelan: "Return to Gamelan page",
    title: "Switch this tab's workspace",
    explain:
      "The complete project stays editable, including events, timing, banks, mix and the legacy score. Audio stops and the destination opens paused. Legacy Studio/Beatbox drafts are untouched.",
    session:
      "This draft follows the same tab. Save a project or download a backup before closing the tab; other tabs have separate drafts. Editor undo/redo starts again after navigation.",
    continue: "Save and switch",
    cancel: "Cancel",
    raw: "Download original tab draft data",
    original: "Download pre-transfer source",
    restore: "Load latest tab draft",
    fresh: "Open workspace in a new tab",
    shared: "Load previous browser Gamelan draft",
    restoreConfirm:
      "Loading the latest tab draft replaces the project on this page. Download your current project backup first. Continue?",
    errors: {
      routeCorrupt:
        "The tab draft is invalid and its original data was not overwritten. Download the current project and original draft data; open a new tab and import the project backup to continue.",
      routeConflict:
        "This tab draft changed outside this page. Your project stays intact; download a backup, then Load latest tab draft or reload.",
      routeClosed:
        "The old page is closed. Reload to use the latest tab draft.",
      routeCleanup:
        "Audio cleanup could not finish. The complete project is saved in this tab; download a backup and reload before continuing.",
    },
  },
};
