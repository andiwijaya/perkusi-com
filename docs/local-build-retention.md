# Build lokal dan task cleanup sesudah build

Semua entry build npm kini memakai wrapper `scripts/local-build.mjs`. Perubahan ini hanya alur lokal; tidak menjalankan deployment atau GitHub Actions dan tidak mengubah header, dependency, aset, atau batas audio.

| Perintah                          | Output sukses                                       |
| --------------------------------- | --------------------------------------------------- |
| `npm run build`                   | `dist`, mode public candidate seperti sebelumnya    |
| `npm run build:v5`                | `qa-artifacts/v5-current-build`, mode V5 UX lengkap |
| `npm run build:gamelan-candidate` | Candidate Gamelan yang dikelola wrapper             |
| `npm run build:gamelan-public`    | Candidate public Gamelan yang dikelola wrapper      |
| `npm run build:audio-prototype`   | `qa-artifacts/audio-prototype-current`              |
| `npm run cleanup:builds`          | Dry-run; tidak menghapus payload                    |

Build dikerjakan pada candidate baru. Output sukses sebelumnya tetap utuh sampai proses build baru keluar sukses dan memiliki hasil lengkap. Sesudah sukses, candidate dipromosikan ke target stabil. Target QA yang sudah ada tetapi belum dikenal registry ditolak; wrapper tidak menganggap folder QA lama boleh ditimpa. Root `dist` yang belum dikenal dipertahankan sebagai backup retained setelah promosi pertama, bukan otomatis dihapus. Root `dist`, V4/live, dan accepted release tidak pernah menjadi target cleanup otomatis.

Wrapper mencatat ukuran target sebelum/sesudah, ruang drive, source fingerprint, mode/path, exit code, durasi, status promosi dan hasil cleanup terpisah. Preflight memakai payload aset terpilih ditambah margin generasi256MiB dan reserve2GiB. Ini batas perencanaan, bukan pengukuran peak compiler. Proses Vite memiliki deadline120detik; timeout/failure tetap FAILED. Candidate gagal terakhir dan diagnosis tetap disimpan. Cleanup juga berjalan setelah proses build gagal; hasil cleanup tidak mengubah build gagal menjadi sukses.

Satu target stabil dipakai ulang. Build terdahulu yang dikelola wrapper baru menjadi obsolete setelah successor berhasil, tidak memiliki konsumen aktif, dan tidak dipin review. File kode/metadata/laporan historis tetap disimpan. Payload ZIP/FLAC yang duplikat dapat dipulihkan persis dari canonical. Tidak ada satu full build baru yang dipertahankan untuk setiap tahap tes UI. Server/browser/test harus memegang lease melalui `acquireBuildConsumer({target,kind})` dan melepasnya di `finally`; build/cleanup menolak target aktif. Review dapat mem-pin root melalui retain registry dengan lock yang sama.

Kebijakan sumber adalah [RETENTION-POLICY.md](../qa-artifacts/disk-retention-policy-2026-10-17/RETENTION-POLICY.md). `scripts/build-retention-policy.json` memuat tiga mapping persis beserta hash kebijakan; code tidak menerima perluasan rule dari nama ekstensi/folder secara otomatis.

Allowlist awal hanya file individual dalam **registered obsolete QA build**:

- `source-forms/cdm-porto-candidate-1.0.0/*.zip` yang sama nama/ukuran/SHA256 dengan `internal/gamelan-source-forms/archives`.
- `sounds/cdm-porto-flac-candidate/{44100,48000}/*.flac` yang sama nama/ukuran/SHA256 dengan `internal/gamelan-flac/audio/{44100,48000}`.

Hook memakai satu lock, validasi path absolut descendant, penolakan symlink/junction/reparse, latest/failed/active/review exclusions, hash dan metadata stabil. Peta recovery bersama disimpan **sebelum** removal; receipt per-run berisi root/key yang dihapus, ukuran sebelum/sesudah, alasan skip/refusal dan free space. Sebelum mutasi, registry, canonical dan target dicek lagi. Removal memakai `fs.unlink` satu path literal terverifikasi, tanpa shell, wildcard removal, recursive delete, atau penghapusan parent. Canonical dan ketiadaan target diverifikasi sesudahnya.

Canonical source/arsip asli, source produk, dependency/cache bersama, browser profile/storage, raw WAV/PCM/F32/XZ, take/project asli, screenshot, failure/protocol/receipt, review aktif, latest complete build dan laporan ringkas berada di luar allowlist. Unique evidence tidak dipurge permanen tanpa konfirmasi spesifik saat tindakan. Tidak mengosongkan Recycle Bin atau menampilkan perpindahan ke Bin sebagai ruang bebas baru.

Allowlist ini dapat memangkas675678888byte payload duplikat per build biasa, sekitar98% dari build689MB, sambil mempertahankan kode/metadata yang diperlukan. Pertumbuhan laporan dan metadata kecil tetap terukur; kebijakan ini tidak menjanjikan pertumbuhan absolut nol. Cache/temporary output lain baru boleh ditambahkan jika exact owned path, regenerability, ownership dan pengecualian evidence sudah dibuktikan. Tidak ada sweep umum `qa-artifacts`.

Registry dan receipt berada pada `qa-artifacts/build-retention`. Receipt restoration menunjuk satu manifest hash-pinned: untuk setiap removed key, salin kembali `canonicalRelative` ke `root/copyRelative`, setelah memastikan kedua path masih aman dan hash canonical tetap cocok. Jangan menjalankan ulang hash manifest historis yang mencakup pruned assets tanpa membaca receipt dan melakukan restore bila perlu.

Sesudah build, validasi UI memakai target build yang sama. Simpan hanya diagnostics/screenshot/hasil ringkas atau raw lossless baru yang benar-benar diperlukan; jangan membuat build baru atau menggandakan raw audio untuk setiap assertion. Tetap pisahkan hasil build, UI, waveform, durability, listening/physical/cultural dan release acceptance.

Untuk successor yang memperbaiki kegagalan UI, gunakan `npm run build:v5 -- --retain-previous`. Build lama tetap dipin lengkap sampai gate perbaikan selesai. Hanya setelah hasil UI diterima, lepaskan root obsolete tersebut melalui `releaseObsoleteReview`, lalu jalankan cleanup allowlist. Melepas pin tidak menghapus folder atau evidence unik.

Satu operasi build memegang lease untuk target stabil dan candidate sepanjang runner sampai promosi/refusal selesai. Build lain yang targetnya sama, ancestor, atau descendant ditolak sebelum runner dimulai. Pelepasan hanya menghapus token operasi itu; lease konsumen lain tetap berlaku. `SEAL.json` pada target sendiri maupun ancestor sampai root workspace diperiksa sebelum launch dan kembali sebelum promosi. Seal yang muncul selama runner mempertahankan last-good di path semula dan candidate sebagai latest-failed yang bisa diperiksa/dipulihkan; cleanup tetap berjalan dengan pengecualian tersebut.

Fingerprint sumber adalah observasi input sebelum dan sesudah runner, bukan checkout beku. Jika fingerprint berubah, hasil runner sukses tetap ditolak untuk publikasi dengan `buildSourceChanged`, kedua fingerprint disimpan, dan candidate/last-good dipertahankan. Perubahan yang terjadi lalu dikembalikan persis di antara dua observasi tidak dapat dibuktikan oleh mekanisme ini.

Edit project durable memublikasikan history setelah acknowledgement penyimpanan. Penolakan transaksi mempertahankan project dan undo/redo sebelumnya. Preview mixer saat save pending dapat terdengar; pada penolakan, aplikasi mengembalikan mix lama, atau masuk fault boundary bila rollback gagal. Tes model rollback tidak menggantikan pengukuran waveform native.
