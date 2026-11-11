# Tracker Preload Audio Beatbox

Tanggal: 12 November 2026 WIB. Baseline `57cfb24`. Status: implementasi selesai; QA native final dan deployment berjalan.

## Kontrak interview

Halaman Beatbox tampil sebelum loading seluruh 12 WAV (enam karakter, A/B). Indikator global di bawah pengantar, sebelum panduan tiga langkah. Mulai main/Putar, enam karakter dan shortcut, Coba groove, serta Buat WAV terkunci sampai 12/12 download/decode/validasi selesai. A/B dapat dipilih tanpa suara dan pilihan terbaru bertahan. Tidak ada autoplay atau ketukan tertunda. Volume dan penyimpanan proyek tetap tersedia sesuai aturan yang ada. Jeda/Mulai ulang tidak membatalkan loading. Kegagalan pertama menjeda seluruh antrean; Coba lagi memulihkan yang gagal dahulu, mempertahankan cache valid. Maksimum dua file aktif.

## Checklist

- [x] 01 Periksa checkout, katalog, playback, pemilihan variasi, pemulihan draft, dan anggaran WAV.
- [x] 02 Gunakan koordinator koleksi bersama untuk registry 12 sampel dan kesiapan global.
- [x] 03 Pertahankan preload saat pause/reset/pilihan A/B/pemulihan proyek; hindari fetch di luar antrean.
- [x] 04 Tambahkan indikator ID/EN, progress, jumlah, spinner, error/retry, dan aksesibilitas.
- [x] 05 Kunci semua jalur audio sejak awal hingga 12/12, termasuk handler, shortcut, dan render WAV.
- [x] 06 Pertahankan A/B terbaru, volume, proyek, dan perilaku tanpa autoplay.
- [x] 07 Tangani context suspend/close/replacement, hasil usang, dan disposal.
- [x] 08 Uji unit antrean, guard, pemilihan variasi, cache, lifecycle, markup, dan anggaran.
- [x] 09 Uji native startup lambat, 11/12, pilihan A/B, Stop/Jeda, retry berulang, dan tanpa gesture.
- [x] 10 Uji seluruh karakter/variasi, playback, output nonzero, WAV dalam memori, dan ID/EN.
- [ ] 11 Periksa responsive dan regresi Studio serta Pad Station.
- [x] 12 Jalankan unit suite, lint, build, serta QA compiled; simpan bukti.
- [ ] 13 Tinjau diff, commit hanya perubahan tugas, dan deploy GitHub main ke Cloudflare Pages.
- [ ] 14 Cocokkan HEAD/GitHub/live, bundle serta 12 aset; verifikasi UI produksi.
- [ ] 15 Tutup tracker, publikasikan laporan, verifikasi SHA akhir, dan rapikan QA.

## Bukti

Direktori `qa-artifacts/beatbox-preload-2026-11-12/`. Laporan akhir `docs/features/BEATBOX-PRELOAD-REPORT.md`. Tidak dilakukan test upload, download UI, impor file, izin mikrofon, atau dialog konfirmasi pengguna. WAV diuji dalam memori. Deployment memakai integrasi Git yang sudah ada.
