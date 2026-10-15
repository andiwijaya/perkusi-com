export const readinessCopy = {
  id: {
    preview: "Gamelan Preview",
    library: "Proyek di browser",
    save: "Simpan proyek",
    load: "Muat proyek",
    remove: "Hapus simpanan",
    saved: "Proyek tersimpan di browser.",
    storageHelp:
      "Metadata dan event disimpan di browser ini. Data dapat hilang jika browser dibersihkan; unduh proyek sebagai backup. Maksimal 30 proyek, total 4 MiB; audio tidak disimpan dalam JSON.",
    autosaved: "Draft terlindungi di browser.",
    demos: "Main bersama demo",
    playDemo: "Putar demo",
    continue: "Lanjut dari jeda",
    mute: "Bisukan",
    demoHelp:
      "Demo modern, dua per laras. Pilih demo, mainkan pad, bisukan grup, lalu jeda atau lanjutkan. Validasi budaya dan listening belum selesai.",
    replaceDemo:
      "Muat demo akan mengganti proyek saat ini. Simpan atau unduh proyekmu sebelum melanjutkan. Lanjutkan?",
    deleteSaved:
      "Hapus simpanan terpilih? Proyek yang sedang dimainkan dan draft tetap tersedia.",
    share: "Bagikan WAV",
    shareShared: "WAV dibagikan melalui menu perangkat.",
    shareDownload: "Berbagi file tidak tersedia; WAV diunduh sebagai fallback.",
    shareCancelled:
      "Berbagi dibatalkan. WAV tetap tersedia bila belum dilepas.",
    sharing: "Menyiapkan menu berbagi.",
    help: "Cara bermain",
    helpText:
      "1. Aktifkan audio lalu ketuk pad atau gunakan A,S,D,F,G,H,J. Enter/Spasi memainkan pad yang difokuskan. 2. Tahan bilah dan lepas untuk meredam; Gong/Kempul/Kendhang mempertahankan tail sampai selesai. Redam semua memakai fade. 3. Rekam maksimal 32 detik, buka Studio, simpan proyek, atau ekspor WAV. Jeda/Lanjut menjaga posisi; berpindah laras tidak mengubah event sebelumnya. Loop beatbox tetap 96 BPM. WAV hingga 90 detik termasuk tail; skor legacy hingga 32 detik. Mute demo tidak membisukan permainan pad bebas.",
    helpPrivacy:
      "Tidak ada mikrofon, login atau upload rekaman ke Perkusi. Berbagi WAV hanya melalui tindakanmu dan menu perangkat. Listening, perangkat fisik dan asal Jawa Tengah belum terverifikasi.",
    credits: "Kredit, sumber & lisensi",
    home: "Beranda",
    beatbox: "Main Beatbox",
    studio: "Studio Musik",
    privacy: "Privasi",
    review: "Kualitas sumber perlu diperiksa",
    beat: "Beat",
    tail: "Resonansi",
    draftError: "Draft belum tersimpan. Unduh proyek sebagai backup.",
    errors: {
      storageFull:
        "Penyimpanan browser penuh atau batas metadata tercapai. Unduh backup; hapus simpanan yang tidak diperlukan lalu coba lagi.",
      storageUnavailable:
        "Penyimpanan browser tidak tersedia. Proyek tetap ada di halaman ini; unduh backup.",
      storageCorrupt:
        "Simpanan browser tidak valid; data aslinya tidak ditimpa. Proyek di halaman tetap dapat diunduh.",
      missingProject:
        "Simpanan ini tidak ditemukan; proyek saat ini tetap utuh.",
      invalidExportAttribution:
        "Metadata kredit WAV tidak valid; ekspor ditolak dan proyek tetap utuh.",
      outputConsumerLimit:
        "WAV masih digunakan oleh operasi lain. Tunggu operasi berbagi selesai.",
    },
  },
  en: {
    preview: "Gamelan Preview",
    library: "Browser projects",
    save: "Save project",
    load: "Load project",
    remove: "Delete saved copy",
    saved: "Project saved in this browser.",
    storageHelp:
      "Metadata and events stay in this browser. Clearing browser data may remove them; download a project backup. Up to 30 projects, 4 MiB total; audio is not stored in JSON.",
    autosaved: "Draft protected in this browser.",
    demos: "Play with a demo",
    playDemo: "Play demo",
    continue: "Continue from pause",
    mute: "Mute",
    demoHelp:
      "Modern demos, two per tuning bank. Choose a demo, play pads, mute groups, then pause or continue. Culture and listening validation remain pending.",
    replaceDemo:
      "Loading a demo replaces the current project. Save or download your work first. Continue?",
    deleteSaved:
      "Delete the selected saved copy? The current playing project and draft remain available.",
    share: "Share WAV",
    shareShared: "WAV shared through the device menu.",
    shareDownload: "File sharing is unavailable; WAV downloaded as fallback.",
    shareCancelled:
      "Sharing cancelled. The WAV remains available unless released.",
    sharing: "Preparing the share menu.",
    help: "How to play",
    helpText:
      "1. Enable audio and tap pads, or use A,S,D,F,G,H,J. Enter/Space plays the focused pad. 2. Hold and release bars to damp; Gong/Kempul/Kendhang keep their natural tails. Damp all uses a fade. 3. Record up to 32 seconds, open Studio, save a project or export WAV. Pause/Continue keeps the position; changing tuning does not alter earlier events. Beatbox loops stay at 96 BPM. WAVs include full tails up to 90 seconds; the legacy score is limited to 32 seconds. Demo mute does not mute free-play pads.",
    helpPrivacy:
      "No microphone, login or recording upload to Perkusi. WAV sharing requires your action and the device menu. Listening, physical devices and Central-Javanese provenance remain unverified.",
    credits: "Credits, sources & licenses",
    home: "Home",
    beatbox: "Beatbox Playground",
    studio: "Music Studio",
    privacy: "Privacy",
    review: "Source quality review pending",
    beat: "Beat",
    tail: "Resonance",
    draftError: "Draft is not saved. Download a project backup.",
    errors: {
      storageFull:
        "Browser storage or the metadata limit is full. Download a backup, delete unnecessary saved copies and retry.",
      storageUnavailable:
        "Browser storage is unavailable. The project remains on this page; download a backup.",
      storageCorrupt:
        "Browser data is invalid and its original bytes were not overwritten. You can still download the current project.",
      missingProject:
        "The saved copy was not found; the current project remains intact.",
      invalidExportAttribution:
        "WAV attribution metadata is invalid; export refused and the project remains intact.",
      outputConsumerLimit:
        "The WAV is still in use by another operation. Wait for sharing to finish.",
    },
  },
};
