# Laporan Pembuka Beranda Ringkas

Tanggal 12 November 2026 WIB. Baseline `a3caf8c`. Status: SELESAI; implementasi, QA, dan deployment fitur terverifikasi. Dokumentasi penutup menggunakan jalur publikasi yang sama.

## Hasil implementasi

Ilustrasi pad besar beserta tombol perantara Pilih alat musik dihapus dari hero. Pembuka kini berisi judul/deskripsi yang sama serta catatan Tanpa akun atau instalasi, kemudian langsung dilanjutkan tiga kartu alat. Urutan tetap Rhythm Studio → Beatbox Playground → Pad Station. Kartu penuh tetap dapat diketuk dengan CTA hijau lebar penuh dan tinggi 48 px.

Layout pembuka diubah menjadi satu kolom, dengan tinggi dan jarak yang lebih kecil. Judul desktop dapat berada dalam satu baris; HP menampilkan dua bagian judul pada baris terpisah. Copy ID/EN tidak ditulis ulang. Spacing heading pilihan alat dipadatkan. CSS khusus ilustrasi yang sudah tidak digunakan dibersihkan. Perubahan aplikasi hanya `src/app/document.js` dan `src/style.css`; modul audio dan katalog terjemahan tetap memakai versi yang ada.

## Pengukuran sebelum dan sesudah

Baseline diukur pada situs live versi sebelumnya. Koordinat di bawah adalah posisi bagian bawah tombol Buka Studio terhadap awal dokumen, sehingga hasil tetap dapat dibandingkan ketika posisi scroll browser berbeda.

| Viewport | Sebelum | Sesudah, build | Naik | Terlihat seluruhnya pada layar awal |
| --- | ---: | ---: | ---: | --- |
| 360 × 800, ID | 1.334,75 px | 723,77 px | 610,98 px | Ya |
| 390 × 844, ID | 1.372,38 px | 726,29 px | 646,08 px | Ya |

Versi EN juga menempatkan tombol pada 723,77 dan 726,29 px untuk dua ukuran HP tersebut. Header, judul, deskripsi, catatan dan tombol Studio terlihat dalam layar awal pada screenshot hasil build. Desktop 1440 menampilkan tiga kartu sejajar dalam layar awal 1000 px tinggi. Tidak diperlukan ilustrasi atau demo audio baru di beranda.

## Verifikasi

- Existing suite 655/655 lulus, 0 gagal/skipped; lint lulus.
- Build retirement-release SUCCESS; receipt `ff4da1db-69a8-4429-83a7-89f58bd7d607`; build sebelumnya dipertahankan.
- Delapan kombinasi 360×800, 390×844, 768×1024, 1440×1000 dalam ID/EN lulus: tidak ada ilustrasi/tombol perantara, tidak ada overflow, urutan tetap, CTA48 tetap tersedia.
- Judul dua bagian dan deskripsi pada delapan observasi sama persis dengan katalog terjemahan yang ada. ID juga dibandingkan dengan baseline live.
- Tab dari Studio ke Beatbox lalu Pad Station, dengan focus-visible; Enter membuka Pad Station EN.
- Enam perjalanan native dari kartu membuka tiga alat dalam ID/EN. Studio dan Beatbox masih mengunci Putar saat loading; indikator muncul sebelum audio siap. Pad Station kemudian diamati siap dengan 23 pad termasuk dua Kethuk.
- Tidak dibuat unit test baru yang sekadar mengulang markup untuk perubahan UI reversibel ini. Existing suite, pengukuran DOM, screenshot, dan navigasi native pada hasil build digunakan sebagai bukti.

Bukti: `qa-artifacts/home-compact-intro-2026-11-12/`, khususnya `baseline.json`, `compiled-layouts.json`, `comparison.json`, `copy-verification.json`, `navigation.json`, `keyboard.json`, `pads-ready.json`, log unit/lint/build serta screenshot HP/desktop ID/EN.

Pada pengambilan baseline, satu percobaan pergantian bahasa belum menghasilkan perubahan yang teramati. Observasi duplikat ID dikeluarkan; tabel baseline hanya memakai dua ukuran ID yang telah diverifikasi. Posisi EN lama tidak diklaim terukur. Sesudah implementasi, bahasa dan isi teks aktual diperiksa sebelum menghitung hasil EN.

Pemeriksaan memakai browser internal Windows dan emulasi viewport. Ponsel fisik dan iOS/Safari belum diuji. Pengujian DSP/render WAV tidak diulang untuk perubahan pembuka ini; startup/gate audio halaman tujuan diperiksa, sedangkan tes audio mendalam tetap tercatat pada laporan preload sebelumnya. Tidak dilakukan upload/download UI, impor file, izin mikrofon, atau dialog konfirmasi pengguna.

## Deployment

Commit fitur `47dab123aa7b488fe13c476dfa3ce1bf76382752` dipush ke GitHub main dan terbit melalui Cloudflare Pages. `version.json` menunjukkan SHA tersebut dan branch main. Verifier membandingkan 32 HTML/JS/CSS termasuk beranda ID/EN: 17 identik byte demi byte, 15 identik setelah pemetaan referensi nama aset melalui manifest. Perbedaan terbatas pada NOTICE Windows 2.622 bytes CRLF versus produksi 2.611 bytes LF, dengan teks identik setelah konversi; hash NOTICE dan bundle yang merujuknya ikut berbeda. Tidak ada perbedaan kode lain. Bukti `deployment-47dab12.json`.

Delapan kombinasi layout live ID/EN lulus. Pada 360×800 dan 390×844, bagian bawah CTA pertama berada sekitar 723,77 dan 726,29 px, cocok dengan hasil compiled. Judul/deskripsi, urutan, CTA48, dan ketidakadaan ilustrasi/tombol perantara kembali diperiksa. Screenshot layar awal diambil pada scrollTop 0; CTA seluruhnya masuk viewport. CTA Studio live membuka halaman Studio yang benar; pengamatan berikutnya mencapai 49/49 dan Putar enabled. Tidak diubah pola maupun pilihan proyek produksi pengguna, dan tidak dimulai playback.

Bukti tambahan: `live-layouts.json`, `live-initial-screen.json`, `live-primary-navigation.json`, screenshot live HP/desktop ID/EN. Console akhir tanpa warning/error. Viewport dikembalikan ke default, tab/server preview ditutup, dan tab pengguna dipertahankan pada awal beranda ID.

Dokumentasi penutup diterbitkan melalui GitHub main ke Cloudflare Pages. SHA akhir serta kecocokan HEAD/GitHub/live dicatat dalam `completion.json` setelah deployment penutup terverifikasi. Tidak ada upload manual deployment.

URL hasil: https://perkusi.com/?lang=id
