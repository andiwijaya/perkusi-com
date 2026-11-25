import { instruments } from "../instruments/catalog.js";
import { tutorialPairs } from "../tutorials/messages.js";
// All user-facing foundation copy, including metadata and accessibility labels.
const pairs = {
  ...tutorialPairs,
  "common.articles": ["Artikel Instrumen", "Instrument Articles"],
  "common.tutorials": ["Tutorial", "Tutorials"],
  "meta.tutorials.title": [
    "Tutorial Beat, Drum Pad, dan Beatbox untuk Pemula | Perkusi.com",
    "Beginner Beat Making, Drum Pad & Beatbox Guides | Perkusi.com",
  ],
  "meta.tutorials.description": [
    "Panduan langkah demi langkah untuk belajar Pad Station, Rhythm Studio, dan Beatbox Playground, dengan tangkapan layar dan pencarian di tiap tutorial.",
    "Learn Pad Station, Rhythm Studio, and Beatbox Playground with step-by-step guides, screenshots, and search in each tutorial.",
  ],
  "tutorialHub.title": ["Tutorial untuk pemula", "Beginner tutorials"],
  "tutorialHub.intro": [
    "Pilih panduan untuk membaca langkahnya, atau cari topik untuk langsung membuka langkah praktik di alat musiknya.",
    "Pick a guide to read the steps, or search for a topic to jump straight to that step in the tool.",
  ],
  "tutorialHub.open": ["Buka panduan", "Open guide"],
  "tutorialHub.pads": [
    "Mainkan Kick dan Snare, coba irama empat hitungan, lalu jelajahi instrumen tambahan.",
    "Play Kick and Snare, try a four-count rhythm, then explore additional instruments.",
  ],
  "tutorialHub.studio": [
    "Buat pola drum pertama, susun empat bar, lalu unduh hasilnya sebagai WAV.",
    "Make your first drum pattern, build a four-bar chain, then download it as a WAV file.",
  ],
  "tutorialHub.beatbox": [
    "Campur suara Bumi, Cicik, dan Dum, coba variasi A/B, lalu unduh groove-mu.",
    "Mix Bumi, Cicik, and Dum, try A/B variations, then download your groove.",
  ],
  "meta.tutorial-pads.title": [
    "Tutorial Pad Station: Cara Main Drum Pad | Perkusi.com",
    "Pad Station Tutorial: How to Play Drum Pads | Perkusi.com",
  ],
  "meta.tutorial-studio.title": [
    "Tutorial Rhythm Studio: Bikin Beat dan Ekspor WAV | Perkusi.com",
    "Rhythm Studio Tutorial: Make a Beat and Export WAV | Perkusi.com",
  ],
  "meta.tutorial-beatbox.title": [
    "Tutorial Beatbox Playground: Susun Groove Pertama | Perkusi.com",
    "Beatbox Playground Tutorial: Build Your First Groove | Perkusi.com",
  ],
  "meta.tutorial-pads.description": [
    "Belajar cara memainkan Pad Station. Mulai dari Kick dan Snare, latih irama empat hitungan, lalu coba kendhang dan instrumen tambahan.",
    "Learn to play Pad Station. Start with Kick and Snare, practise a four-count rhythm, then try kendhang and other instrument pads.",
  ],
  "meta.tutorial-studio.description": [
    "Ikuti tutorial Rhythm Studio untuk membuat pola drum 16 langkah, mengatur tempo, merangkai empat bar, dan mengekspor beat ke WAV.",
    "Follow the Rhythm Studio tutorial to program a 16-step drum pattern, set the tempo, arrange four bars, and export your beat as WAV.",
  ],
  "meta.tutorial-beatbox.description": [
    "Buat groove pertamamu di Beatbox Playground. Campur suara Bumi, Cicik, dan Dum, ganti variasi A/B, lalu simpan proyek atau unduh WAV.",
    "Make your first groove in Beatbox Playground. Mix Bumi, Cicik, and Dum, switch A/B variations, then save the project or download a WAV.",
  ],
  "home.articles.meta": ["04 / JELAJAHI BUNYI", "04 / EXPLORE SOUND"],
  "home.articles.title": ["Artikel Instrumen", "Instrument Articles"],
  "home.articles.copy": [
    "Kenali cerita, asal-usul, dan karakter suara berbagai instrumen. Baca artikelnya, lalu coba mainkan padnya.",
    "Discover the stories, origins and distinctive sounds of musical instruments. Read an article, then try its sound pads.",
  ],
  "home.articles.action": ["Jelajahi Artikel", "Explore Articles"],
  "home.articles.badge": ["Baca & mainkan", "Read & play"],
  "meta.instruments.title": [
    "Artikel Instrumen Gamelan, Drum, Gitar & Bass | Perkusi.com",
    "Gamelan, Drums, Guitar & Bass Instrument Guides | Perkusi.com",
  ],
  "meta.instruments.description": [
    "Jelajahi 16 instrumen melalui cerita, ilustrasi dan pad interaktif. Kenali gamelan, drum, gitar, bass, dan suara Bilah Perkusi.com.",
    "Explore 16 instruments through stories, illustrations and interactive pads. Discover gamelan, drums, guitar, bass and Perkusi.com's Bilah voice.",
  ],
  "home.chooseTool": ["Pilih alat musik", "Choose a music tool"],
  "home.guideTitle": ["Sebelum bermain", "Before you play"],
  "home.guide.audio.title": [
    "Mulai dengan volume rendah",
    "Start with low volume",
  ],
  "home.guide.audio.copy": [
    "Suara aktif setelah kamu mengetuk kontrol di alat yang dipilih. Sesuaikan volume perangkat sebelum bermain.",
    "Audio starts after you tap a control in your chosen tool. Adjust your device volume before playing.",
  ],
  "home.guide.live.title": [
    "Pad Station untuk main langsung",
    "Pad Station is for live play",
  ],
  "home.guide.live.copy": [
    "Pad Station tidak merekam permainanmu. Pilih Rhythm Studio untuk menyusun pola dan mengekspor beat.",
    "Pad Station does not record your performance. Choose Rhythm Studio to arrange patterns and export beats.",
  ],

  "common.pads": ["Buka Pad Station", "Open Pad Station"],
  "home.pads.meta": ["03 / MAIN LANGSUNG", "03 / LIVE PLAY"],
  "home.pads.title": ["Pad Station", "Pad Station"],
  "home.pads.copy": [
    "Pad drum dan instrumen dengan pilihan bank tambahan. Ketuk langsung di HP atau keyboard tanpa menyusun pola.",
    "Drum and instrument pads with additional sound banks. Play directly on your phone or keyboard without pattern editing.",
  ],
  "meta.pads.title": [
    "Pad Station: Drum Pad dan Instrumen Online | Perkusi.com",
    "Pad Station: Online Drum and Instrument Pads | Perkusi.com",
  ],
  "meta.pads.description": [
    "Mainkan drum, Bilah, kendhang, bass, gitar dan pilihan instrumen tambahan. Tanpa pola, rekaman atau akun.",
    "Play drums, Bilah, kendhang, bass, guitar and additional instrument banks live. No patterns, recording or account.",
  ],
  "common.gamelan": ["Gamelan", "Gamelan"],
  "common.instrumentStatus": ["Instrumen", "Instrument"],
  "home.gamelanCopy": [
    "Mainkan bank Pelog dan Slendro terpisah, lalu susun permainanmu di Rhythm Studio.",
    "Play separate Pelog and Slendro banks, then arrange your performance in Rhythm Studio.",
  ],
  "common.loopPreview": ["Loop Station Preview", "Loop Station Preview"],
  "home.loopPreviewCopy": [
    "Susun delapan track, rekam take lokal dan gunakan FX. Simpan proyek dengan audio; pengujian perangkat dan listening tetap terbuka.",
    "Arrange eight tracks, record local takes and use FX. Save projects with audio; device and listening validation remain open.",
  ],
  "home.loopPreviewAction": ["Buka Loop Station", "Open Loop Station"],

  "meta.home.title": [
    "Perkusi.com | Drum Pad, Beat Maker, dan Instrumen Online",
    "Perkusi.com | Online Drum Pads, Beat Maker & Instruments",
  ],
  "meta.home.description": [
    "Mainkan drum pad, susun beat, dan campur suara beatbox langsung di browser. Pelajari ritme dari tutorial pemula dan dengarkan bunyi instrumen gamelan.",
    "Play drum pads, make beats, and mix beatbox voices in your browser. Learn rhythm with beginner tutorials and explore the sounds of gamelan instruments.",
  ],
  "meta.home.social": [
    "Tiga alat musik di browser: Rhythm Studio, Beatbox Playground dan Pad Station. Mulai bermain tanpa instalasi.",
    "Three music tools in your browser: Rhythm Studio, Beatbox Playground and Pad Station. Start playing without installation.",
  ],
  "meta.privacy.title": ["Privasi — Perkusi.com", "Privacy - Perkusi.com"],
  "meta.privacy.description": [
    "Cara Perkusi.com menggunakan analytics dan menyimpan bahasa serta proyek secara lokal.",
    "How Perkusi.com uses analytics and stores language preferences and projects locally.",
  ],
  "meta.beatbox.title": [
    "Beatbox Playground: Mixer Beatbox Online | Perkusi.com",
    "Beatbox Playground: Online Beatbox Loop Mixer | Perkusi.com",
  ],
  "meta.beatbox.description": [
    "Campur enam karakter beatbox, pilih variasi suara A/B, dan unduh groove sebagai WAV langsung dari browser.",
    "Mix six original beatbox voices, switch between A/B variations, and download your groove as a WAV file in your browser.",
  ],
  "meta.studio.title": [
    "Rhythm Studio - Bikin Beat dan Ekspor WAV | Perkusi.com",
    "Rhythm Studio - Make Beats and Export WAV | Perkusi.com",
  ],
  "meta.studio.description": [
    "Gabungkan loop Beatbox, sequencer 8 track, tiga kit orisinal, instrumen Bilah, dan WAV lokal.",
    "Combine Beatbox loops, an eight-track sequencer, three original kits, the Bilah instrument, and local WAV export.",
  ],
  "meta.notFound.title": [
    "Halaman Tidak Ditemukan — Perkusi.com",
    "Page not found - Perkusi.com",
  ],
  "meta.notFound.description": [
    "Halaman ini tidak ditemukan. Kembali ke beranda Perkusi.com.",
    "This page was not found. Return to the Perkusi.com homepage.",
  ],
  "common.skip": ["Lewati ke konten", "Skip to content"],
  "common.homeLabel": ["Beranda Perkusi.com", "Perkusi.com home"],
  "common.menu": ["Menu", "Menu"],
  "common.navLabel": ["Navigasi utama", "Main navigation"],
  "common.footerLabel": ["Navigasi footer", "Footer navigation"],
  "common.language": ["Bahasa", "Language"],
  "common.toId": ["Gunakan Bahasa Indonesia", "Use Bahasa Indonesia"],
  "common.toEn": ["Gunakan English", "Use English"],
  "common.upcoming": ["Segera Hadir", "Upcoming"],
  "common.comingSoon": ["Segera Hadir", "Coming Soon"],
  "common.tools": ["Alat Musik", "Music tools"],
  "common.approach": ["Panduan Bermain", "Playing guide"],
  "common.find": ["Main Sekarang", "Play Now"],
  "common.studio": ["Buka Studio", "Open Studio"],
  "common.playable": ["Bisa Dimainkan", "Playable"],
  "common.footer": [
    "Perkusi.com. Dibuat untuk musik.",
    "Perkusi.com. Built for the music.",
  ],
  "common.privacy": ["Privasi", "Privacy"],
  "common.back": ["Kembali ke Perkusi.com", "Back to Perkusi.com"],
  "home.eyebrow": ["PERKUSI.COM", "PERKUSI.COM"],
  "home.hero1": ["Mainkan irama.", "Make rhythm."],
  "home.hero2": ["Di browser.", "In your browser."],
  "home.description": [
    "Mainkan drum pad di Pad Station, susun beat di Rhythm Studio, atau campur suara di Beatbox Playground.",
    "Play drum pads in Pad Station, build beats in Rhythm Studio, or mix voices in Beatbox Playground.",
  ],
  "home.explore": ["Buka Beatbox", "Open Beatbox"],
  "home.note": ["Tanpa akun atau instalasi.", "No account or installation."],
  "home.artLabel": [
    "Ilustrasi irama abstrak: lingkaran loop mengelilingi kisi pad perkusi empat kali empat. Ini adalah konsep visual, bukan alat yang dapat dimainkan.",
    "Abstract rhythm illustration: concentric circles surrounding a four-by-four percussion pad grid. Illustration only, not an audio control.",
  ],
  "home.artTop": ["PERKUSI", "PERCUSSION"],
  "home.artBottom": ["IRAMA DI BROWSER", "RHYTHM IN YOUR BROWSER"],
  "home.artCaption": [
    "Ilustrasi ritme - bukan kontrol audio",
    "Rhythm illustration - not an audio control",
  ],
  "home.toolsTitle": ["Pilih alat musikmu.", "Choose your music tool."],
  "home.learn": [
    "Mulai dari tutorial pemula",
    "Start with a beginner tutorial",
  ],
  "home.card1.meta": ["01 / PERKUSI", "01 / PERCUSSION"],
  "home.card1.title": ["Rhythm Studio", "Rhythm Studio"],
  "home.card1.copy": [
    "Susun pola ritme dan rantai beat, lalu ekspor ke WAV.",
    "Build rhythm patterns and beat chains, then export to WAV.",
  ],
  "home.card1.foot": ["TEMUKAN GROOVE", "FIND THE POCKET"],
  "home.card2.meta": ["02 / LAPISAN SUARA", "02 / LAYERING"],
  "home.card2.title": [
    "Loop Station Multi-Instrumen",
    "Multi-Instrument Loop Station",
  ],
  "home.card2.copy": [
    "Satukan suaramu. Ruang yang akan hadir untuk membangun, melapisi, dan membentuk loop.",
    "Bring your sounds together. A future space to build, layer, and shape loops.",
  ],
  "home.card2.foot": ["BANGUN SUARAMU", "BUILD YOUR SOUND"],
  "home.card3.meta": ["02 / EKSPLORASI", "02 / EXPLORATION"],
  "home.card3.title": ["Beatbox Playground", "Beatbox Playground"],
  "home.card3.copy": [
    "Bumi, Sabet, Cicik, Dum, Luma, dan Tara. Enam karakter, dua variasi setiap suara.",
    "Bumi, Sabet, Cicik, Dum, Luma and Tara. Six characters, two variations per voice.",
  ],
  "home.card3.foot": ["TERUS EKSPLORASI", "STAY CURIOUS"],
  "home.card4.meta": ["04 / LATIHAN", "04 / PRACTICE"],
  "home.card4.title": ["Alat Latihan & Metronom", "Practice & Metronome Tools"],
  "home.card4.copy": [
    "Luangkan waktu untuk melatih ketukan. Alat sederhana untuk terus berkembang.",
    "Make time for better timing. Simple tools to help you keep growing.",
  ],
  "home.card4.foot": ["RASAKAN KETUKAN", "FEEL THE TIME"],
  "privacy.heading": ["Privasi", "Privacy"],
  "common.gamelanPreview": ["Gamelan Preview", "Gamelan Preview"],
  "common.previewStatus": ["Pratinjau", "Preview"],
  "common.gamelanPlay": ["Main Gamelan Preview", "Play Gamelan Preview"],
  "home.gamelanPreviewCopy": [
    "Mainkan bank Pelog dan Slendro, rekam event, lalu lanjutkan di Studio. Validasi budaya, listening dan perangkat masih tertunda.",
    "Play Pelog and Slendro banks, record events and continue in Studio. Culture, listening and physical-device validation remain pending.",
  ],
  "privacy.updated": [
    "Diperbarui 17 Oktober 2026.",
    "Updated October 17, 2026.",
  ],
  "privacy.analytics": [
    "Perkusi.com menggunakan Google Analytics 4 untuk memahami penggunaan situs. Analytics dapat mengumpulkan halaman yang dikunjungi, jenis perangkat dan browser, sumber kunjungan, serta perkiraan lokasi, dan dapat menyimpan cookie pihak pertama di perangkatmu.",
    "Perkusi.com uses Google Analytics 4 to understand website usage. Analytics may collect pages visited, device and browser type, referral source, and approximate location, and may store first-party cookies on your device.",
  ],
  "privacy.signals": [
    "Google signals dan personalisasi iklan dinonaktifkan dalam konfigurasi tag kami. Situs ini tidak meminta akun atau informasi pribadi.",
    "Google signals and advertising personalization are disabled in our tag configuration. This site does not ask you to create an account or submit personal information.",
  ],
  "privacy.locale": [
    "Jika kamu mengganti bahasa, pilihan itu disimpan di browser pada perangkat ini. Kamu dapat menghapusnya melalui pengaturan penyimpanan situs di browser. Pengunjung baru selalu mendapatkan Bahasa Indonesia. Bahasa pada URL yang dipilih secara eksplisit didahulukan.",
    "When you switch languages, your preference is saved in the browser on this device. You can remove it through your browser's site storage settings. New visitors always receive Bahasa Indonesia. An explicitly chosen URL language takes priority.",
  ],
  "privacy.projects": [
    "Proyek tersimpan dan pemulihan edit memakai penyimpanan lokal di browser ini. Nama, pola dan rekaman tersimpan tetap di perangkatmu; hapus proyek melalui tombol Hapus atau hapus semua data situs melalui pengaturan browser. Profil offset opsional menyimpan nama pilihanmu dan angka manual di browser, tanpa identitas perangkat atau penerapan otomatis; hapus melalui kontrol profil. File impor dibaca lokal. WAV dibuat lokal. Saat kamu memilih Bagikan, file diserahkan ke layanan atau aplikasi yang kamu pilih; kebijakan mereka berlaku.",
    "Saved projects and edit recovery use local storage in this browser. Names, patterns and saved recordings stay on your device; delete projects with Delete or remove all site data in browser settings. Optional offset profiles store your chosen label and manual value in the browser, without device identifiers or automatic application; delete them through the profile controls. Imported project files are read locally. WAV files are rendered locally. When you choose Share, the file is handed to your selected service or app; its policy applies.",
  ],
  "privacy.block": [
    "Kamu dapat memblokir analytics lewat pengaturan privasi browser, pemblokir konten, atau add-on opt-out Google Analytics.",
    "You can block analytics using your browser privacy settings, a content blocker, or Google's Analytics opt-out add-on.",
  ],
  "privacy.optout": [
    "Add-on opt-out Google Analytics",
    "Google Analytics opt-out add-on",
  ],
  "privacy.policy": ["Kebijakan privasi Google", "Google's privacy policy"],
  "privacy.unavailable": [
    "Beatbox, Studio, dan Gamelan memuat suara dari situs ini serta memproses proyek dan WAV di browser, tanpa mikrofon. Loop Station menyediakan mikrofon opsional setelah aktivasi sadar dan izin browser; Stop Mic menghentikan akses. Audio diproses lokal, tidak diunggah ke Perkusi; monitoring memerlukan pilihan terpisah. Event analytics mencatat penggunaan fitur secara agregat: pembukaan workspace, suara pertama, aktivasi layer, pemutaran demo, perpindahan mode, perubahan bahasa, kategori kesalahan umum, penyimpanan proyek, dan hasil ekspor. Nama proyek, isi file, pola, nada individual, nama suara, audio, dan profil perangkat tidak dimasukkan ke parameter event kami.",
    "Beatbox, Studio and Gamelan load sounds from this site and process projects and WAV files in your browser, without a microphone. Loop Station provides an optional microphone after explicit activation and browser permission; Stop Mic ends access. Audio is processed locally and is not uploaded to Perkusi; monitoring requires a separate choice. Analytics events count aggregate feature use: workspace visits, first sound, layer activation, demos, mode transfers, language changes, general error categories, project saves and export outcomes. Our event parameters do not include project names, file content, patterns, individual notes, sound names, audio or device profiles.",
  ],
  "soon.beatbox.heading": ["Beatbox Playground", "Beatbox Playground"],
  "soon.beatbox.copy": [
    "Kami sedang menyiapkan karakter orisinal dan suara beatbox yang musikal. Belum ada karakter atau suara yang dapat dimainkan di sini.",
    "We're preparing original characters and musical beatbox sounds. There are no playable characters or sounds here yet.",
  ],
  "soon.studio.heading": ["Studio Musik", "Music Studio"],
  "soon.studio.copy": [
    "Ruang untuk menyusun pola ritme dan mencampur suara sedang dikembangkan. Sequencer dan mixer belum tersedia.",
    "A workspace for arranging rhythm patterns and mixing sounds is in development. The sequencer and mixer are not available yet.",
  ],
  "soon.note": [
    "Jelajahi rencana alat kami sambil menunggu.",
    "Explore our planned tools in the meantime.",
  ],
  "notFound.heading": ["Ketukan yang tersesat.", "A beat out of place."],
  "notFound.copy": ["Halaman ini tidak ditemukan.", "This page doesn't exist."],
};
const articleTitles = {
  drum: [
    "Drum: Bagian Kit dan Perannya dalam Irama",
    "Drum Kit: The Sounds That Shape a Groove",
  ],
  bilah: [
    "Bilah: Lima Nada Sintetis Perkusi.com",
    "Bilah: Perkusi.com’s Five-Note Synth Voice",
  ],
  "kendhang-ciblon": [
    "Kendhang Ciblon: Bunyi dan Peran dalam Gamelan",
    "Kendhang Ciblon: Sound and Role in Gamelan",
  ],
  "bass-elektrik": [
    "Bass Elektrik: Bunyi dan Perannya dalam Musik",
    "Electric Bass: Listen to the Low Notes of a Groove",
  ],
  "gitar-nylon": [
    "Gitar Nylon: Bentuk dan Bunyi Senar Nilon",
    "Nylon-String Guitar: Construction and Sound",
  ],
  kethuk: [
    "Kethuk: Penanda Ketukan dalam Gamelan",
    "Kethuk: A Small Time Marker in Gamelan",
  ],
  kempyang: [
    "Kempyang: Bunyi dan Fungsi dalam Gamelan",
    "Kempyang: A Bright Sound in Gamelan",
  ],
  kenong: [
    "Kenong: Bunyi dan Fungsinya dalam Gamelan",
    "Kenong: Pitch and Punctuation in Gamelan",
  ],
  "bonang-panerus": [
    "Bonang Panerus: Bunyi dan Gerak Melodi",
    "Bonang Panerus: Sound and Melodic Movement",
  ],
  peking: [
    "Peking: Instrumen Bersuara Tinggi Keluarga Saron",
    "Peking: The High Voice of the Saron Family",
  ],
  "saron-barung": [
    "Saron Barung: Melodi Gamelan dari Bilah Logam",
    "Saron Barung: Gamelan Melody on Metal Keys",
  ],
  "bonang-barung": [
    "Bonang Barung: Bunyi dan Arah Melodi Gamelan",
    "Bonang Barung: How It Shapes Gamelan Melodies",
  ],
  demung: [
    "Demung: Suara Rendah dalam Keluarga Saron",
    "Demung: The Low Voice of the Saron Family",
  ],
  kempul: [
    "Kempul: Gong Gantung Penanda Frasa Gamelan",
    "Kempul: Hanging Gongs and Musical Phrases",
  ],
  "gong-ageng": [
    "Gong Ageng: Bunyi dan Peran Gong Besar",
    "Gong Ageng: Sound and Role of the Great Gong",
  ],
  slenthem: [
    "Slenthem: Bilah Gantung dan Dengung Lembut",
    "Slenthem: Suspended Keys and Soft Resonance",
  ],
};
for (const instrument of instruments) {
  pairs["meta." + instrument.page + ".title"] = articleTitles[
    instrument.slug
  ].map((title) => `${title} | Perkusi.com`);
  pairs["meta." + instrument.page + ".description"] = [
    `${instrument.id}. ${instrument.summary.id} Dengarkan lewat pad interaktif.`,
    `${instrument.en}. ${instrument.summary.en} Listen with interactive pads.`,
  ];
}
export const messages = Object.freeze({
  id: Object.freeze(
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[0]]),
    ),
  ),
  en: Object.freeze(
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[1]]),
    ),
  ),
});
