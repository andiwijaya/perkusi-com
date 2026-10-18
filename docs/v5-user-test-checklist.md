# Uji pengguna V5 lokal — 17 Oktober 2026

Build lokal terbaru `bdbcfb4e-81c5-479f-92bf-a9f33ff71b26` mencakup profil offset manual dan waveform track. UI penuh Firefox 155 diuji dengan input sintetis pada loopback port 5995; server tes sudah ditutup. Perintah di bawah menyiapkan sesi pengguna terpisah pada port 4175 (preferensi browser per-origin, sehingga profil simulasi tes tidak dipindahkan). Mikrofon fisik, headphone, listening, latensi, Bluetooth dan perangkat mobile **BELUM DIUJI** oleh agen. Suling ditunda dari V5 atas persetujuan pengguna, belum diintegrasikan, dan tidak dijanjikan untuk versi tertentu.

## Buka preview di laptop ini

Saat sesi uji sudah diatur, di PowerShell:

```powershell
Set-Location -LiteralPath 'C:\PerkusiDotCom'
node qa-artifacts/v5-profile-waveform-2026-10-17/serve-preview.mjs
```

Biarkan terminal terbuka, lalu buka **http://127.0.0.1:4175/loop-station/?lang=id** pada browser laptop. Ganti `lang=id` menjadi `lang=en` untuk bahasa Inggris. Server hanya mendengarkan loopback laptop dan memegang lease build agar preview aktif tidak tertimpa. Tutup dengan **Ctrl+C**. Jika port sedang dipakai atau build telah berganti, helper akan menolak; gunakan petunjuk build terbaru, jangan membuka `index.html` sebagai `file://`.

Sebelum mencoba, simpan audio/proyek yang ingin dipertahankan. Take sesi masih berada di memori tab: unduh WAV, atau tambahkan take penuh ke proyek dan simpan audio. JSON saja tidak membawa rekaman.

## Checklist singkat

Tandai setiap baris **LULUS / GAGAL / BELUM DIUJI** berdasarkan perangkat nyata.

| Uji | Langkah dan hasil yang diperiksa |
| --- | --- |
| Izin dan input mic | Pilih track kosong → **Mikrofon** → **Siapkan instrumen** → **Aktifkan Mic**. Periksa alur izin browser, termasuk penolakan bila ingin mengujinya. Setelah diizinkan, meter bergerak saat berbicara; catat kanal dan sample rate yang ditampilkan. Monitoring harus tetap mati pada aktivasi awal. |
| Rekam dan Stop Mic | Rekam satu bar dengan suara pelan/normal. Setelah loop penuh, tekan **Hentikan rekaman / replay**, lalu simpan/unduh dan dengarkan. **Stop Mic** harus menghentikan akses perangkat; periksa indikator mic browser. Aktivasi berikutnya harus memerlukan tindakan sadar dan monitoring kembali mati. |
| Waveform dan state | Saat merekam, waveform dan jumlah frame harus tumbuh; setelah selesai/parsial, label harus sesuai. Grafik menunjukkan sumber asli sebelum posisi/mix/FX, bukan output yang didengar. Bagian belum diterima tetap kosong. Periksa setelah adopsi/reload; mute/Stop/Resume tidak boleh merusak rekaman. |
| Headphone dan monitoring | Gunakan headphone **berkabel**, volume rendah. Centang konfirmasi headphone, lalu aktifkan monitoring opsional. Periksa suara, pan/mute/volume dan tombol matikan monitoring. Catat delay, putus-putus atau feedback. Jangan meluluskan latensi hanya karena terasa nyaman: target PRD memerlukan pengukuran loopback/korelasi terpisah. |
| Profil offset opsional | Pada layer rekaman penuh, buka **Profil offset perangkat lokal**. Isi penyesuaian manual, beri nama ringkas dan simpan sebagai profil baru. Setelah reload, profil harus tetap ada namun tidak dipilih/diterapkan otomatis. **Isi angka dari profil** hanya mengubah draft; gunakan Preview lalu Simpan posisi secara terpisah. Periksa rate mismatch dan hapus/batal. Label tetap BELUM DIKALIBRASI; nilai manual bukan bukti pengukuran hardware. Profil tidak ikut portable. |
| Perangkat terputus / mute / suspend | Saat rekaman baru berjalan, coba satu gangguan yang benar-benar tersedia: mute perangkat, cabut mic USB, atau sleep/resume Windows. Catat gangguan dan perilaku browser yang benar-benar terjadi. Jika take terputus, harus tetap ditandai parsial; periksa jumlah frame dalam take, diterima, target, serta tambahan saat penutupan bila ada. Unduh WAV sebelum discard. Jangan menandainya sebagai take penuh atau menebak audio yang hilang. Gunakan tombol pemulihan bila muncul, lalu siapkan dan aktifkan ulang secara sadar. |
| Listening musik | Dengarkan instrumen, starter dan sambungan loop beberapa putaran: attack, decay, bunyi klik, distorsi, keseimbangan dan hasil fase manual. Nilai tujuh sampel bertanda di `internal/gamelan-delivery/quality-flags.json`; indikator numerik bukan putusan audibilitas. Penilaian laras/asalan budaya perlu rujukan yang sesuai. Jangan menilai suling sebagai instrumen aplikasi karena belum tersedia. |
| Perangkat lain | Catat browser/output yang digunakan. Bluetooth, Safari dan sentuhan di perangkat mobile perlu sesi fisik tersendiri. URL `127.0.0.1` di HP menunjuk HP itu sendiri, sehingga tautan laptop ini belum menyediakan akses HP. Layout 390 px yang lolos otomatis bukan bukti uji HP. |

Untuk temuan, catat: langkah reproduksi, browser/versi, mic dan output, sample rate/kanal yang ditampilkan, hasil yang diharapkan, hasil aktual, angka take parsial, serta nama screenshot/WAV lokal jika dibuat. Checklist ini tidak menjalankan mic, mengunggah rekaman, atau melakukan deployment.
