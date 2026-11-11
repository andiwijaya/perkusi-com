# Tracker Loading Lima Grup Utama Pad Station

Tanggal: 12 November 2026, WIB. Status: implementasi dimulai. Baseline: `8bf3e06`.

## Keputusan hasil interview

Halaman tampil sebelum audio mulai dimuat. Drum 8, Bilah 5, Kendhang Ciblon 2, Bass elektrik 3, dan Gitar nylon 3 sampel dimuat melalui antrean bersama dengan maksimal dua pekerjaan bersamaan. Setiap grup memiliki indikator tepat di bawah judul dan seluruh pad grup terkunci sampai semua sampelnya siap.

Jika satu grup gagal, seluruh pemuatan dijeda sampai grup gagal dipulihkan; grup yang sudah siap tetap dapat dimainkan. Instrumen tambahan hanya dimuat setelah kelima grup utama berhasil. Pilihan tambahan terbaru selama menunggu harus digunakan. Hentikan suara hanya menghentikan bunyi dan tidak membatalkan loading, termasuk instrumen tambahan.

Pengujian menggunakan fixture dan browser lokal tanpa upload, download melalui UI, impor file, atau izin mikrofon. Deploy telah diotorisasi melalui GitHub main dan Cloudflare Pages.

## Checklist implementasi

- [x] 01 Verifikasi checkout, status Git, baseline, dan alur audio bersama. Pertahankan file di luar tugas.
- [x] 02 Buat pengelola pemuatan lima grup dengan antrean dua pekerjaan dan progres buffer valid.
- [x] 03 Bekukan setiap grup sampai seluruh sampelnya siap; lindungi pointer, keyboard, dan jalur playback.
- [x] 04 Tambahkan indikator waiting, loading, ready, paused, error dan retry tepat di bawah setiap judul, dalam ID dan EN.
- [x] 05 Tampilkan halaman sebelum mulai fetch audio dan hindari bunyi otomatis saat persiapan.
- [x] 06 Saat satu file gagal, jeda seluruh antrean, pertahankan cache valid dan grup yang sudah siap, serta batasi hasil asynchronous usang.
- [x] 07 Retry grup gagal dahulu; lanjutkan pekerjaan lain hanya setelah seluruh kegagalan pulih.
- [x] 08 Tunda instrumen tambahan sampai semua grup utama siap; gunakan pilihan terbaru selama menunggu.
- [x] 09 Pisahkan Hentikan suara dari pembatalan loader untuk semua grup, termasuk instrumen tambahan.
- [x] 10 Tangani interupsi AudioContext, penggantian context, perpindahan halaman, dan disposal tanpa nada atau aktivasi terlambat.
- [x] 11 Uji terkontrol: sampel terakhir tertunda, gagal sebagian, retry berulang, beberapa kegagalan, dan Stop tanpa pembatalan loading.
- [x] 12 Uji browser dari beranda, pembatasan dua pekerjaan, indikator dan penguncian per grup, serta ketukan pertama tanpa fetch tambahan.
- [x] 13 Uji instrumen tambahan menunggu, perubahan pilihan saat menunggu, dan regresi semua pilihan tambahan.
- [x] 14 Periksa mobile dan desktop, ID dan EN, reduced motion, status aksesibel, serta keluaran audio native.
- [x] 15 Jalankan unit suite, lint, build produksi, QA compiled dan regresi dasar Studio serta Beatbox tanpa transfer file UI.
- [x] 16 Tinjau diff dan simpan bukti, hasil aktual, serta batas verifikasi.
- [ ] 17 Commit hanya perubahan tugas dan push melalui Git integration produksi.
- [ ] 18 Verifikasi versi lokal/GitHub/live, aset runtime, dan perilaku live; tutup tracker.

## Pekerjaan aktif

17 dan 18: commit perubahan terpilih, deploy melalui main, lalu cocokkan versi dan perilaku live.

## Bukti dan hasil

642/642 unit tests, lint, dan build produksi lulus. Source slow suite 8/8, source failure suite 5/5, compiled slow suite 8/8. Compiled failure suite 5/5 lulus; regresi dasar Studio dan Beatbox juga lulus. Semua tes audio native memakai 48 kHz, tanpa upload, download UI, impor, atau izin mikrofon. Bukti berada pada `qa-artifacts/pad-core-loading-2026-11-12/`.
