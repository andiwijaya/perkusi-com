# Checklist penutupan V5 lokal - 17 Oktober 2026

Catatan checkpoint historis. Untuk lingkup rilis terbaru, lihat [V5 Preview release](v5-preview-release.md): successor ekspor/level telah diterima reviewer dan owner, lalu owner mengizinkan deploy pada 18 Oktober 2026. Hasil perangkat/latency/budaya yang belum diuji tidak otomatis menjadi lulus.

**Full V5/release tetap HOLD.** Build `bdbcfb4e-81c5-479f-92bf-a9f33ff71b26`, source `2173878a6134c8d17096ba0435fdc6637503ebcdae4bea89da4db5d284ead050`, sudah lolos 860 tes, lint/build dan alur UI compiled Firefox 155 sintetis. Ini penutupan software oleh writer; penerimaan peer terhadap successor belum diberikan. Tidak ada mic fisik, listening, commit atau deploy dalam pekerjaan ini.

| Gate | Status dan tindakan berikutnya |
| --- | --- |
| Profil lokal §5.3 | PASS software: opt-in, selalu belum dikalibrasi, Load hanya draft, Preview/Save terpisah, durable Undo/Redo/reload, portable tanpa profil. P3 pilihan usang diperbaiki dan direproduksi sebagai penolakan Load/Delete di UI dua layer. Peer perlu meninjau successor. |
| F09 waveform/state | PASS software: sumber asli, pertumbuhan receipt native, penuh/parsial, adopsi/reload, mute/Stop/Resume, Recover/Discard dan perubahan format mono/stereo. Setiap bin diverifikasi dari PCM tersimpan. Peer perlu meninjau successor. |
| F01–F13 dan migrasi lintas produk | [Peta requirement](v5-requirement-evidence.md) menghubungkan bukti per cohort. Penerimaan slice tidak meluluskan seluruh journey produk, Studio/migrasi, atau rilis. |
| Mic dan perangkat | BELUM DIUJI fisik. Pengguna menjalankan izin/penolakan, Stop/re-enable/indikator, mute/unplug/suspend dengan perangkat yang tersedia. Agen tidak mengaktifkan mic. |
| Monitoring dan pengukuran | BELUM DIUJI. Headphone kabel, volume rendah; periksa monitoring opt-in. Ukur loopback/korelasi dan median terkompensasi pada setup referensi yang didukung sebelum klaim ≤25 ms. Profil manual/API latency bukan pengukuran hardware. |
| Musik dan budaya | BELUM DIUJI listening. Nilai attack/decay/klik/distorsi/blend/loop seam dan tujuh quality flag Gamelan; perlukan rujukan budaya untuk klasifikasi/koherensi. Hak/provenance dan izin distribusi sumber/export/portable tetap dinilai sesuai aset. |
| Suling | **Ditunda dari V5 dengan persetujuan pengguna**, 17 Oktober 2026 10:49 UTC. Kandidat belum diintegrasikan; tidak ada janji versi tertentu. Ini tidak menunda gate perangkat/listening lain. |
| HP/browser/output lain | BELUM DIUJI fisik untuk touch, Safari/iOS/Android/Bluetooth. Viewport 390 px yang lolos bukan bukti HP. |
| Produksi | HOLD. Belum deploy atau memverifikasi revision produksi V5. Kebijakan produksi `microphone=()` tidak diubah; production permission policy dan smoke test ditangani dalam alur rilis yang diotorisasi. |

## Tindakan pengguna saat sesi uji tersedia

1. Buka PowerShell di `C:\PerkusiDotCom` dan jalankan `node qa-artifacts/v5-profile-waveform-2026-10-17/serve-preview.mjs`. Buka `http://127.0.0.1:4175/loop-station/?lang=id` pada laptop ini. Server belum berjalan sekarang. Gunakan Ctrl+C saat selesai; helper menolak jika build telah berganti.
2. Simpan proyek/audio yang ingin dipertahankan. Ikuti [checklist perangkat](v5-user-test-checklist.md): mulai mic eksplisit hanya bila siap, monitoring awal harus mati, gunakan headphone kabel bervolume rendah untuk monitoring.
3. Rekam loop pendek, periksa waveform/state, unduh atau adopsi take penuh, simpan proyek dengan audio, reload dan dengarkan. Take parsial harus tetap parsial; simpan WAV sebelum discard.
4. Coba profil manual opsional: simpan nama/offset, reload, pilih secara sadar, Load hanya mengisi draft; Preview dan Simpan posisi terpisah. Nilai harus tetap berlabel belum dikalibrasi.
5. Catat setiap hasil sebagai LULUS/GAGAL/BELUM DIUJI, langkah reproduksi, browser, mic/output, sample rate/kanal, angka take dan file bukti lokal. Temuan pengguna dapat dimasukkan ke V5; pengembangan tidak perlu menunggu seluruh sesi selesai.

Laporan dan identitas lengkap: [packet profil/waveform](../qa-artifacts/v5-profile-waveform-2026-10-17/REPORT.md). Server tes otomatis port 5995 sudah ditutup; origin tersebut terpisah dari sesi pengguna 4175. URL loopback laptop bukan URL HP atau produksi.
