# Tracker Navigasi Kartu Beranda

Tanggal: 12 November 2026 WIB. Baseline: `69964a0`. Status: implementasi dan QA compiled selesai; deployment disiapkan.

## Keputusan interview

Seluruh kartu Rhythm Studio, Beatbox Playground, dan Pad Station dapat diketuk. Setiap kartu memiliki satu link native; tombol visual hijau terang, teks gelap dan panah kanan di dalamnya memenuhi lebar bagian dalam kartu, tinggi minimal 48 px. Label Buka Studio, Buka Beatbox, Buka Pad Station serta padanannya dalam EN. Fokus pada tiga kartu, konsisten di HP/desktop. Fokus keyboard dan feedback ditekan jelas; tidak ada nested link atau tab stop duplikat. Halaman tujuan tetap menjalankan preload audio yang telah diterapkan.

## Checklist

- [x] 01 Verifikasi checkout, perubahan lama, markup, CSS, routing dan keputusan interview.
- [x] 02 Ubah tiga kartu menjadi satu link penuh per kartu dengan CTA visual di dalamnya.
- [x] 03 Terapkan tombol hijau penuh, panah kanan, target 48 px, focus/hover/pressed dan tata letak desktop.
- [x] 04 Periksa ID/EN dan ukuran 360/390/768/1440, overflow, lebar tombol dan posisi bawah/sejajar.
- [x] 05 Uji ketukan judul/ilustrasi/deskripsi/tombol/padding/panah, keyboard dan tujuan tiga alat.
- [x] 06 Pastikan beranda tidak memuat audio dan halaman tujuan menjalankan indikator serta gate audio.
- [x] 07 Jalankan pemeriksaan existing yang relevan, lint, build dan QA pada hasil build; simpan bukti.
- [ ] 08 Review diff, commit hanya perubahan tugas, push main untuk deploy Cloudflare Pages.
- [ ] 09 Cocokkan versi dan runtime produksi serta verifikasi tampilan/navigasi live ID/EN.
- [ ] 10 Publikasikan laporan, tutup tracker, verifikasi SHA akhir dan rapikan QA.

## Bukti

`qa-artifacts/home-card-navigation-2026-11-12/`. Laporan: `docs/features/HOME-CARD-NAVIGATION-REPORT.md`. Tidak ada uji upload/download UI, impor file, izin mikrofon, atau konfirmasi pengguna. Build lama dipertahankan dan file lama di luar tugas tidak disentuh.
