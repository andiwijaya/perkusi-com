# Laporan Navigasi Kartu Beranda

Tanggal 12 November 2026 WIB. Baseline `69964a0`. Status: SELESAI; implementasi, QA, serta deployment fitur terverifikasi. Dokumentasi penutup mengikuti jalur publikasi yang sama.

## Hasil

Tiga kartu Rhythm Studio, Beatbox Playground, dan Pad Station kini memakai satu link native yang memenuhi seluruh bagian dalam kartu, termasuk padding. Judul, ilustrasi, deskripsi, tombol visual, dan panah menuju halaman yang sama. Tidak ada nested link, tombol interaktif tambahan, atau handler JavaScript khusus untuk klik kartu.

CTA di bagian bawah memakai latar hijau terang dan teks gelap, lebar penuh area dalam kartu, tinggi minimal 48 px, dengan panah kanan di dalamnya. Label Buka Studio, Buka Beatbox, Buka Pad Station dan padanan EN tetap memakai terjemahan yang ada. Desktop mempertahankan tiga kartu sejajar dengan CTA pada tinggi yang sama. Keyboard memiliki satu tab stop per kartu, focus ring jelas, serta feedback hover/pressed. Tautan native juga mempertahankan fungsi browser normal seperti salin alamat atau buka di tab baru.

Perubahan aplikasi hanya pada `src/app/document.js` dan `src/style.css`. Markup kartu menggunakan daftar tiga alat agar struktur dan CTA konsisten. Padding dipindah dari article ke link; aturan CSS dibatasi ke beranda. Navigasi tetap memakai resolver route/locale yang ada.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Existing unit suite | 655/655 lulus, 0 gagal/skipped |
| Lint | Lulus |
| Build retirement-release | SUCCESS, receipt `c216e3c0-b0ab-4ed2-84c3-7fd91cdb15ba`; build lama dipertahankan |
| Ukuran dan bahasa | 360, 390, 768, 1440 px × ID/EN: delapan kombinasi lulus |
| Tombol | Semua 48 px tinggi dan memenuhi lebar dalam link; pada 390 px lebar CTA 289 px |
| Seluruh kartu | Link memenuhi lebar/tinggi bagian dalam article; satu link per kartu, tidak ada nested interactive element |
| Desktop | Ketiga CTA sejajar pada 1440 px; tidak ada overflow horizontal |
| Hit test desktop EN | 24/24 titik pada tiga kartu: metadata, ilustrasi, judul, deskripsi, CTA, panah, padding atas dan bawah menargetkan link kartu |
| Hit test mobile ID | 8/8 titik yang sama pada kartu Studio yang terlihat menargetkan link |
| Keyboard | Tab dari Studio ke Beatbox, kemudian Pad Station, kemudian keluar kartu; focus-visible aktif; Enter membuka Pad Station EN |
| Navigasi EN | Enter pada Pad Station, panah CTA Beatbox, dan permukaan CTA Studio membuka halaman yang benar |
| Navigasi ID pada HP | Judul Studio, ilustrasi Beatbox, dan deskripsi Pad Station membuka halaman yang benar |
| Startup tujuan | Keenam perjalanan menampilkan status persiapan audio dan pad terkunci; Putar Studio/Beatbox disabled selama belum siap |
| Pad Station sesudah siap | Status siap dan 23 pad enabled, termasuk dua pad Kethuk |
| Console | Tidak ada warning/error pada pemeriksaan akhir lokal |

Inisialisasi audio tetap mengikuti `body[data-page]` dalam entry aplikasi; kartu beranda berisi link navigasi biasa. Pemeriksaan tugas ini mencakup startup dan gate audio pada halaman tujuan, bukan pengulangan seluruh pengujian DSP/render WAV yang telah dilakukan pada tugas preload sebelumnya. Tidak ada perubahan pada modul audio.

Bukti berada di `qa-artifacts/home-card-navigation-2026-11-12/`: unit/lint/build logs, `layouts.json`, `navigation.json`, `keyboard.json`, `hit-targets-desktop-en.json`, `hit-targets-mobile-studio.json`, dan screenshot. Percobaan koordinat mobile sebelum target seluruhnya masuk viewport disimpan sebagai `mobile-offscreen-probe.json` dan tidak dihitung sebagai hit test lulus. Hit test diulang pada target yang terlihat; navigasi mobile juga diverifikasi dengan klik elemen. Pemeriksaan DOM menggunakan toleransi subpixel; tidak menganggap ukuran outline yang dibulatkan renderer harus sama persis dengan deklarasi CSS.

Tidak dibuat unit test baru yang sekadar mencerminkan markup untuk perubahan UI yang mudah dibalik ini. Suite existing serta pemeriksaan browser pada hasil build digunakan untuk memverifikasi kontrak dan perilaku nyata. Tidak ada upload, download UI, impor file, izin mikrofon, atau dialog konfirmasi pengguna. Responsive adalah emulasi viewport di browser internal Windows; ponsel fisik, iOS/Safari, dan gestur swipe layar sentuh fisik belum diuji.

## Deployment

Commit fitur `1531da0394da47ee78f8923b3e0670b1f6325817` dipush ke GitHub main dan terbit otomatis di Cloudflare Pages. `version.json` menunjukkan SHA tersebut dan branch main. Verifier membandingkan 32 HTML/JS/CSS, termasuk beranda ID/EN: 17 identik byte demi byte; 15 identik setelah pemetaan referensi nama aset melalui manifest. Perbedaan yang dibatasi adalah NOTICE Windows 2.622 bytes CRLF versus produksi 2.611 bytes LF; teks identik setelah konversi, sehingga hash NOTICE dan bundle yang merujuknya ikut berbeda. Tidak ada perbedaan kode lain. Bukti `deployment-1531da0.json`.

UI live diperiksa pada 390/1440 px, ID/EN. Semua CTA setinggi 48 px dan memenuhi lebar bagian dalam kartu; satu link per kartu, panah berada di dalam, serta tidak ada overflow halaman. Pada live HP, judul Studio membuka halaman Studio dan mencapai 49/49; ilustrasi Beatbox membuka Beatbox dan mencapai 12/12; CTA Pad Station membuka Pad Station lalu 23 pad termasuk Kethuk siap. Pengujian ini hanya navigasi dan observasi, tanpa mengubah pola, pilihan instrumen, atau menyalakan playback pada proyek produksi pengguna. Console akhir tanpa warning/error.

Inspeksi DOM sempat timeout pada transisi navigasi live Studio. Observasi native berikutnya menunjukkan halaman sudah mencapai 49/49, lalu pembacaan DOM berhasil; hal ini tidak dicatat sebagai kegagalan navigasi aplikasi. Bukti live: `live-layouts.json`, `live-navigation.json`, dan screenshot mobile/desktop ID/EN.

Viewport sementara telah dikembalikan ke default. Tab preview serta server QA milik tugas telah ditutup; tab pengguna berada pada beranda ID bagian pilihan alat. Dokumen penutup dipublikasikan melalui GitHub main ke Cloudflare Pages. SHA akhir dan kecocokan HEAD/GitHub/live dicatat dalam `completion.json` setelah deployment penutup terverifikasi. Tidak ada upload manual deployment.

URL hasil: https://perkusi.com/?lang=id#tools
