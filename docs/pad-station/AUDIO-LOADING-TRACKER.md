# Tracker Perbaikan Loading Audio Pad Station

Tanggal dibuat dan diperbarui: 12 November 2026, WIB.

Tujuan: semua sampel instrumen tambahan yang dipilih harus siap dimainkan sebelum tombol nadanya aktif. Selama proses tersebut, tampilkan indikator loading tepat di bawah judul **Instrumen tambahan**, sebelum combo box.

Status keseluruhan: **Selesai dan sudah deployed**. Implementasi commit 6ddcd59ad99fd456f78f6c8a67dc707ced6fd1b7 telah terbit melalui GitHub main ke Cloudflare Pages dan diverifikasi live pada 12 November 2026. Tidak ada pengujian upload atau izin mikrofon.

## Aturan status

- `[ ]` berarti belum selesai. `[x]` hanya digunakan setelah hasilnya diverifikasi.
- Item yang sedang dikerjakan tetap `[ ]` dan dicatat pada bagian Pekerjaan aktif.
- Untuk pengujian, simpan perintah atau langkah, hasil aktual, serta lokasi bukti. Pengujian yang belum dijalankan tidak boleh ditandai lulus.
- Penyelesaian lokal dan publikasi dicatat terpisah.

## Pemeriksaan awal yang selesai

- [x] Memeriksa alur pemilihan instrumen, pemuatan sampel, dan aktivasi tombol pada kode lokal.
- [x] Memeriksa tampilan halaman Pad Station di browser internal. Kasus koneksi lambat belum direproduksi.

Temuan: pergantian instrumen saat ini langsung merender tombol aktif. Sampler memuat sampel per nada ketika pad ditekan. `SampleBank.loadAll()` tersedia, tetapi penyelesaian promise harus diikuti pemeriksaan seluruh buffer karena kegagalan dapat diselesaikan dengan hasil kosong. `initLivePads().update()` saat ini mengatur ulang status disabled berdasarkan penguncian global dan perlu menghormati kesiapan instrumen tambahan.

Catatan aset: rekaman sumber disebut WAV; aset delivery yang dirujuk bank tambahan saat ini berupa FLAC. Perbaikan ini mengikuti daftar sampel bank yang dipilih, tanpa mengganti format audio.

## Pekerjaan aktif

A sampai F selesai. Seluruh 19 bank dan 89 nada mencapai ready pada situs live. Tracker dan laporan verifikasi ditutup melalui commit dokumentasi; sesudah push, versi live kembali dicocokkan dengan HEAD akhir. Lihat AUDIO-LOADING-VERIFICATION.md untuk hasil dan batas pemeriksaan.

## A Pemuatan seluruh sampel

- [x] A1 Tambahkan operasi persiapan pada sampler untuk memuat semua sampel bank terpilih tanpa menghasilkan suara.
- [x] A2 Verifikasi setiap buffer setelah loading. Instrumen hanya berstatus siap jika seluruh sampel valid dan tersedia untuk playback.
- [x] A3 Laporkan progres berdasarkan jumlah sampel yang selesai diunduh, didekode, dan divalidasi. Gunakan kembali cache yang masih valid saat retry.
- [x] A4 Pertahankan antrean loading, batas decode, dan batas memori yang tersedia. Periksa kebutuhan seluruh bank terpilih bersama cache inti; kegagalan kapasitas harus menghasilkan pesan yang dapat dipulihkan.

## B Penguncian dan interaksi pad

- [x] B1 Saat pilihan berubah, render semua tombol nada pilihan baru dalam keadaan disabled sebelum memulai pekerjaan asynchronous.
- [x] B2 Pertahankan penguncian pada semua jalur interaksi dan setiap pemanggilan pembaruan tombol. Tambahkan pemeriksaan kesiapan pada jalur pemutaran instrumen tambahan.
- [x] B3 Aktifkan semua tombol nada secara bersamaan setelah seluruh sampel siap. Abaikan tekanan selama loading tanpa mengantrekan nada untuk dimainkan belakangan.
- [x] B4 Terapkan persiapan yang sama pada instrumen awal Kethuk. Tangani kebutuhan aktivasi AudioContext melalui interaksi pengguna tanpa membuat loading macet atau memicu suara otomatis.

## C Indikator dan pemulihan

- [x] C1 Tempatkan indikator tepat di bawah judul Instrumen tambahan dan sebelum label Pilih instrumen.
- [x] C2 Tampilkan indikator gerak, nama pilihan aktif, dan hitungan seperti Memuat suara Kethuk… 1/2 file siap. Angka siap hanya bertambah setelah validasi audio selesai.
- [x] C3 Setelah seluruh sampel siap, tampilkan konfirmasi singkat seperti Kethuk siap dimainkan · 2/2 file dan aktifkan pad.
- [x] C4 Jika ada kegagalan unduhan, timeout, decode, atau validasi, pertahankan penguncian dan tampilkan jumlah file siap serta tombol Coba lagi pada area indikator.
- [x] C5 Sediakan teks ID dan EN, status yang dapat dibaca pembaca layar, serta tampilan mobile yang tidak memotong nama atau progres.

## D Pergantian pilihan dan siklus halaman

- [x] D1 Biarkan combo box dapat digunakan saat loading. Batalkan pekerjaan pilihan lama bila memungkinkan dan abaikan semua hasil lama agar tidak menimpa pilihan terbaru, termasuk urutan A ke B ke A.
- [x] D2 Pisahkan status loading instrumen tambahan dari status ketukan pad lain agar aktivitas drum tidak menghapus progres atau pesan gagal instrumen tambahan.
- [x] D3 Tangani Stop saat loading dengan membatalkan persiapan, mempertahankan sampel valid, dan menyediakan aksi Lanjutkan pemuatan. Jangan biarkan pad terkunci tanpa cara melanjutkan.
- [x] D4 Tangani halaman tersembunyi, pelepasan halaman, dan AudioContext terputus atau diganti. Hasil pekerjaan usang tidak boleh membuka pad; pemulihan harus menyediakan status dan aksi yang sesuai.

## E Pengujian dan bukti penerimaan

- [x] E1 Uji terkontrol bahwa satu sampel terakhir yang tertunda mempertahankan semua pad terkunci. Keadaan seluruh sampel siap harus membuka semuanya sekaligus dan persiapan tidak membuat voice audio.
- [x] E2 Uji kegagalan sebagian, hasil load kosong, timeout, decode gagal, serta retry dengan cache valid. Pastikan status gagal tidak dianggap siap dan pemulihan berhasil.
- [x] E3 Uji pergantian cepat A ke B ke A, Stop, pelepasan halaman, serta interupsi atau penggantian context. Tidak boleh ada hasil lama yang mengubah indikator, membuka pad, atau menghasilkan nada tertunda.
- [x] E4 Uji browser dengan cache kosong dan respons sampel diperlambat. Buktikan indikator muncul sejak pergantian pilihan dan mouse, sentuhan, serta keyboard tidak mengaktifkan pad selama loading. Setelah siap, ketukan pertama memicu playback tanpa menunggu unduhan sampel.
- [x] E5 Periksa seluruh pilihan instrumen, termasuk bank panjang dan besar, cache saat dipilih ulang, serta pemakaian bersama pad inti. Batas memori dan antrean harus tetap terpenuhi.
- [x] E6 Verifikasi tampilan mobile dan desktop, ID dan EN, serta aksesibilitas status. Simpan screenshot keadaan loading, siap, dan gagal, beserta bukti teknis pemutaran audio; screenshot saja tidak membuktikan adanya suara.
- [x] E7 Jalankan pengujian regresi yang relevan, lint, dan build. Catat hasil aktual dan keterbatasan pemeriksaan audio atau perangkat fisik.

## F Penyelesaian dan publikasi

- [x] F1 Tinjau diff akhir, lengkapi bukti pengujian, dan perbarui tracker dengan hasil serta pekerjaan yang masih terbuka.
- [x] F2 Publikasikan melalui GitHub main dan Cloudflare Pages, lalu verifikasi perilaku live dan kecocokan versi. Bukti live tersedia: version.json, pemeriksaan 31 file, dan pemeriksaan 19 bank di browser internal.

## Peta file implementasi

| File | Perubahan yang direncanakan |
| --- | --- |
| `src/pads/extra-sampler.js` | Persiapan bank, verifikasi kesiapan, progres, dan pembatalan |
| `src/pads/main.js` | Koordinasi pilihan, penguncian, indikator, retry, dan siklus halaman |
| `src/pads/extra-page.js` | Markup indikator, tombol pemulihan, dan teks ID serta EN |
| `src/pads/style.css` | Tampilan loading, status, dan tata letak responsif |
| `src/studio/live-pads.js` | Penguncian per kelompok tanpa mengganggu konsumen lain |
| `src/pads/owner.js` | Penyesuaian bila diperlukan untuk koordinasi Stop dan interupsi |
| `tests/` dan sarana QA browser | Pengujian perilaku, kegagalan, pembatalan, dan regresi |

## Catatan verifikasi

| Tanggal WIB | Item | Pemeriksaan dan bukti | Hasil |
| --- | --- | --- | --- |
| 12 November 2026 | F2 | Commit implementasi 6ddcd59, version.json main, 31 file HTML/JS/CSS, dan live-ui-banks.json | PASS; 19 bank dan 89 nada ready |
| 12 November 2026 | Pemeriksaan awal | Pembacaan kode lokal dan observasi halaman `https://perkusi.com/pad-station/?lang=id` di browser internal | Alur saat ini diperiksa; koneksi lambat belum direproduksi |

Hasil lokal: 633/633 unit tests, lint, dan build lulus. Dua suite browser native masing-masing lulus 12 pemeriksaan, termasuk 19 bank / 89 nada. Verifikasi live selesai: 19 bank / 89 nada siap; ketukan Slenthem dan Stop tidak menghasilkan status error; console browser live tanpa warning/error pada pemeriksaan akhir.
