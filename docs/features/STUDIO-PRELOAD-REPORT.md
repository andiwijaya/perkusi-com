# Laporan Preload Audio Rhythm Studio

Tanggal: 12 November 2026 WIB. Baseline aplikasi: `c89e5749caa12025b4400754add35593c89d3826`. Status: implementasi, QA lokal, deployment fitur, dan UI live terverifikasi. Dokumentasi penutup dipublikasikan melalui jalur yang sama.

## Hasil yang diterapkan

Saat Rhythm Studio dibuka dari beranda, halaman mendapat kesempatan paint sebelum pemuatan audio dimulai. Indikator global terletak di bawah pengantar, tepat sebelum kotak saran laptop. Indikator menampilkan spinner, progress bar, jumlah file yang benar-benar siap, pesan gagal, serta Coba lagi dalam bahasa Indonesia dan Inggris. Status menggunakan live region polite, progress memiliki label aksesibel, dan animasi menghormati reduced motion.

Seluruh koleksi dipersiapkan sejak awal, bukan hanya kit atau pola yang sedang dipilih:

| Koleksi | Sampel |
| --- | ---: |
| Drum Ruang, Arus, Fusion | 24 |
| Bilah | 5 |
| Kendhang Ciblon | 2 |
| Bass elektrik | 3 |
| Gitar nylon | 3 |
| Loop, dua variasi untuk enam suara | 12 |
| Total | 49 |

Putar, seluruh 21 pad yang tampil beserta shortcut dan jalur audition editor, serta Buat WAV tetap terkunci sampai 49/49 sampel berhasil diunduh, didekode, dan divalidasi. Tidak ada autoplay atau antrean ketukan yang berbunyi setelah loading. Pengeditan pola, pilihan kit/demo, volume, serta penyimpanan proyek tetap tersedia dengan aturan normal yang sudah ada. Contohnya, tempo tetap mengikuti batas 96 BPM ketika loop aktif. Perubahan editor terbaru dipakai setelah loading selesai tanpa mengulang koleksi yang valid.

Scheduler membatasi pekerjaan aktif menjadi dua file. Kegagalan pertama menjeda seluruh antrean dan membatalkan pekerjaan pending lain; buffer yang sudah valid tetap disimpan. Coba lagi memulihkan bank yang gagal sebelum melanjutkan koleksi lainnya. Kegagalan ulang tetap dapat dicoba kembali. Jeda dan Kembali ke awal hanya mengatur playback, sehingga tidak membatalkan preload. Suspend/close context mengunci kontrol kembali dan menyediakan pemulihan; hasil pekerjaan usang tidak boleh membuka kontrol.

## Perubahan teknis dan anggaran memori

Koordinator yang sebelumnya khusus Pad Station dipindah tanpa perubahan perilaku ke `src/audio/bank-preparation.js`; `src/pads/core-loading.js` menjadi re-export kompatibel. Registry dan kesiapan global Studio berada di `src/studio/preload.js`. Markup/copy indikator berada di `src/studio/preload-page.js`, integrasinya di `main.js`, `page.js`, dan `style.css`.

Factory Studio mengaktifkan profil AudioContext 48 kHz dan opsi mempertahankan loading saat pause. Default AudioEngine untuk pengguna lain tetap seperti sebelumnya. Gate juga ada pada handler dan jalur engine/composition, sehingga disabled visual tidak menjadi satu-satunya pengaman. Preload berjalan setelah dua requestAnimationFrame; decoding dapat berlangsung pada context awal yang suspended tanpa menunggu izin mikrofon atau memulai suara.

Pengukuran native menunjukkan 49 buffer utama memakai 17.074.568 bytes, sekitar 16,3 MiB pada 48 kHz. Batas admission aplikasi 32 MiB tetap dipertahankan. Render/kalibrasi memiliki kebutuhan buffer sendiri; bila render ditolak karena anggaran, aplikasi dapat melepas cache bank yang tidak dipakai suara aktif, mencoba render sekali lagi, lalu mempersiapkan ulang seluruh koleksi sebelum membuka kontrol. Bank yang masih membacking suara aktif tidak dilepas. Uji render 32 detik membuktikan jalur ini dengan 49 decode tambahan dan pemulihan kembali ke 49/49.

Angka tersebut adalah accounting buffer aplikasi, bukan jaminan total RAM proses browser atau kapan garbage collector melepas memori fisik. Kalibrasi offline yang sudah ada tetap dapat melakukan fetch/decode tersendiri. Pernyataan cache hangat pada pengujian pad/loop merujuk pada bank playback utama, bukan klaim bahwa seluruh proses kalibrasi tidak menggunakan jaringan.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Unit suite | 651/651 lulus, 0 gagal/skipped |
| Unit baru khusus preload | 9 lulus: registry, dua pekerjaan, freeze 48/49, retry, cache, lifecycle, pause, budget recovery, guard, markup |
| ESLint | Lulus |
| Build retirement-release | SUCCESS; receipt `6aca0ccf-7cc4-4398-86b3-00a272ba7188`; build sebelumnya dipertahankan |
| Native browser source | 16/16 pemeriksaan lulus: slow 7, failure 5, budget 4 |
| Native browser compiled | 16/16 pemeriksaan lulus: slow 7, failure 5, budget 4 |
| Startup lambat | Indikator sudah ada dan frame berlangsung sebelum fetch pertama; tidak ada enable prematur; maksimum pekerjaan teramati 2 |
| File terakhir tertahan | 48/49 tetap mengunci Putar, seluruh pad, dan Buat WAV; editor tetap usable |
| Pilihan terbaru | Kit/demo/grid dan pemilihan note tetap berlaku setelah ready; audition note diblok saat belum siap |
| Playback pad | Seluruh 24 mapping drum dan 13 nada instrumen bekerja memakai bank yang sudah siap |
| Loop | Seluruh 12 variasi dimainkan tanpa decode tambahan pada context utama |
| Playback pola | Kalibrasi, Putar, Jeda, lanjut, dan kembali awal lulus; analyser native menunjukkan sinyal nonzero |
| WAV pendek | Stereo 48 kHz, 480.000 frame/10 detik, 1.920.044 bytes; diperiksa di memori |
| WAV panjang | Stereo 48 kHz, 1.536.000 frame/32 detik, 6.144.044 bytes; cache dipulihkan 49/49 |
| Failure | HTTP 503 pertama menjeda antrean; retry gagal lalu berhasil; pilihan editor tidak direset |
| Context | Suspend, close, context pengganti, cache, dan status pesan pulih tanpa pesan error usang |
| ID/EN | Status dan kesiapan bertahan saat bahasa berubah |
| Tata letak lokal | Desktop lokal 1280 px; live 390 dan 1440 px, ID/EN; tidak ada overflow horizontal; indikator berada di antara `.st-intro` dan `#st-desktop` |
| Regresi Pad Station | Lima grup 21/21 dan Kethuk 2/2 siap; Kick, Bilah D4, Stop; tanpa console error |
| Regresi Beatbox | Coba groove, Jeda, Putar, Mulai ulang, Jeda; status normal dan tanpa console error |

Bukti ada di `qa-artifacts/studio-preload-2026-11-12/`: `source-{slow,failure,budget}.json`, `compiled-{slow,failure,budget}.json`, unit/lint/build logs, screenshot loading/ready, serta hasil regresi. Fixture dan server QA hanya lokal, tidak masuk commit atau build produksi. File WAV dibentuk dan dibaca dalam memori. Tidak dilakukan upload, download lewat UI, impor file, izin mikrofon, atau dialog konfirmasi pengguna.

Dua asumsi fixture dikoreksi sebelum hasil akhir: draft disposable dengan loop aktif membuat tempo terkunci 96 BPM, sehingga fixture render panjang kini menonaktifkan loop dan memeriksa tempo 60 terlebih dahulu; pemeriksaan editor juga menghormati aturan tempo tersebut. Probe awal yang gagal tetap disimpan sebagai bukti dan tidak dihitung sebagai lulus. Pengujian context menemukan pesan `context-closed` yang tertinggal setelah context pulih; implementasi memperbarui observer context, membersihkan pesan itu hanya setelah audio ready, dan memperbarui lock retry ketika proses lain selesai. Suite compiled final lulus setelah perbaikan tersebut.

Pengujian menggunakan audio native di browser internal Windows. Ini membuktikan perilaku software dan sinyal audio, bukan penilaian listening manusia atau kualitas speaker fisik. Ponsel fisik, iOS/Safari, dan preferensi reduced motion OS secara terpisah belum diuji. Runner E2E browser terpisah tidak dijalankan; browser diuji melalui API internal yang didukung. Pengujian sengaja menghindari alur transfer file atau izin yang memerlukan persetujuan pengguna.

## Deployment

Commit fitur `1c11f65f4fec4a7861f37d47e4a68273f748ece3` dipush ke GitHub main dan terbit otomatis di Cloudflare Pages. `version.json` menunjukkan commit tersebut dan branch main. Pemeriksaan membandingkan 31 HTML/JS/CSS: 17 identik byte demi byte; 14 identik setelah referensi nama aset dipetakan melalui manifest. Perbedaan yang dibatasi adalah NOTICE Windows 2.622 bytes CRLF versus produksi 2.611 bytes LF, dengan teks identik setelah konversi. Hash NOTICE dan bundle yang merujuknya ikut berubah. Tidak ada perbedaan kode lain; seluruh hash raw tidak diklaim identik. Bukti: `deployment-1c11f65.json`.

Alur beranda → Buka Studio live pada viewport 390 menunjukkan waiting 0/49 dan seluruh 21 pad, Putar, serta Buat WAV disabled. Saat 24/49, editor kit aktif sementara kontrol audio tetap terkunci. Pemuatan pertama kemudian masuk error 28/49; retry pertama belum menyelesaikan kegagalan, retry kedua berhasil 49/49. Seluruh 21 pad, Putar, dan Buat WAV kemudian aktif, tanpa mereset kit/proyek. Penyebab spesifik kegagalan awal tidak tersedia dari UI produksi dan tidak diklaim sebagai masalah jaringan tertentu. Audit terpisah seluruh 47 WAV dan dua FLAC menunjukkan HTTP 200 serta isi identik dengan aset lokal (49/49; `live-audio-audit.json`). Error awal, freeze, dan keberhasilan pemulihan dicatat sebagai hasil observasi, bukan dihapus dari laporan.

Live diuji pada lebar 390 dan 1440, ID serta EN: status 49/49, posisi indikator benar, tidak ada overflow halaman. Satu pad Kick dan Kembali ke awal berjalan normal; tidak dilakukan perubahan pola/demo atau transfer file pada draft produksi pengguna. Console tidak menunjukkan error/warning saat pemeriksaan. Bukti: `live-startup.json`, `live-mobile-{id,en}.json`, `live-desktop-id.json`, screenshot loading/error/ready mobile dan ready desktop ID/EN.

Pembukaan ulang live dari awal kemudian selesai 49/49 tanpa retry dan tanpa gesture tambahan; Putar, Buat WAV, serta seluruh 21 pad aktif, console tanpa warning/error (`live-reopen.json`).

Preload tanpa gesture juga diperiksa terpisah pada source: context tetap suspended 48 kHz, seluruh 49 sampel berhasil didekode dan daftar error kosong, tanpa menekan tombol Jalankan QA yang melakukan resume context.

Commit dokumentasi penutup menyusul melalui jalur GitHub main ke Cloudflare Pages; SHA akhir dicatat dalam receipt `completion.json` dan laporan percakapan setelah HEAD, GitHub main, serta live cocok. Tidak ada upload manual deployment.

URL hasil: https://perkusi.com/studio/?lang=id
