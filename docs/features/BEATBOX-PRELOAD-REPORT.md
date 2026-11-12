# Laporan Preload Audio Beatbox

Tanggal 12 November 2026 WIB. Baseline `57cfb24`. Status: SELESAI; implementasi, QA, dan deployment fitur telah terverifikasi. Dokumentasi penutup diterbitkan melalui jalur yang sama.

## Hasil implementasi

Halaman Beatbox tampil sebelum pemuatan seluruh 12 WAV: Bumi, Sabet, Cicik, Dum, Luma, Tara, masing-masing variasi A dan B. Indikator berada setelah pengantar dan sebelum panduan tiga langkah. Indikator ID/EN menampilkan spinner, progress bar, jumlah sampel valid, pesan gagal, dan Coba lagi. Status menggunakan live region polite/atomic dan progress berlabel; spinner mengikuti reduced motion.

Mulai main/Putar, enam karakter beserta shortcut 1–6, Coba groove, dan Buat WAV terkunci sejak tampilan awal sampai 12/12 download, decode, dan validasi selesai. Handler juga memiliki guard sehingga disabled visual bukan satu-satunya pengaman. Tidak ada autoplay maupun ketukan tertunda. A/B tetap dapat dipilih tanpa suara; pilihan terakhir digunakan setelah ready. Volume, panjang WAV, dan penyimpanan proyek mengikuti perilaku normal yang sudah ada.

Jeda dan Mulai ulang tidak membatalkan antrean. Mulai ulang tetap menjalankan fungsi reset pilihan/layer seperti sebelumnya. Pemulihan draft/proyek tidak memulai audio atau memuat sampel di luar antrean. Kegagalan pertama menjeda seluruh antrean; retry memulihkan bank yang gagal terlebih dahulu, memakai cache valid, lalu melanjutkan file lain. Kegagalan ulang tetap recoverable. Context suspend/close mengunci kembali kontrol audio; retry memulihkan kesiapan tanpa autoplay. Context pengganti diamati dan error context lama dibersihkan hanya setelah ready.

## Struktur dan batas memori

Koordinator koleksi Studio dipindah ke `src/audio/collection-preload.js`, dengan adapter Studio tetap tersedia. Registry Beatbox dua bank/satu bank per variasi dan UI indikator berada di `src/beatbox/preload.js`. Scheduler bersama tetap membatasi dua pekerjaan aktif. `main.js`, `page.js`, serta `style.css` menghubungkan UI dan lifecycle. Controller proyek menerima callback kesiapan audio untuk mengunci dan menjaga handler Buat WAV.

AudioEngine menambahkan opsi mempertahankan loading ketika pilihan layer/variasi berubah; default pengguna lain tetap seperti sebelumnya. Beatbox mengaktifkan opsi ini dan opsi pause yang sudah tersedia. Pemilihan variasi boleh mengubah state saat belum siap, tetapi tidak memulai fetch terpisah. Play juga memiliki guard kesiapan dan tetap menolak engine yang sudah disposed.

Beatbox menggunakan context 48 kHz. Dua belas buffer mono lima detik memerlukan 11.520.000 bytes, sekitar 11 MiB. Batas admission/render 32 MiB tetap digunakan. Uji enam karakter aktif dengan WAV delapan bar/20 detik berada pada estimasi admission 31.074.304 bytes. Ini accounting buffer aplikasi, bukan jaminan total RAM proses browser atau waktu garbage collection. Render offline tetap memiliki bank dan fetch/decode sendiri; klaim cache hangat merujuk bank playback utama.

## Verifikasi lokal

| Pemeriksaan | Hasil |
| --- | --- |
| Unit suite | 655/655 lulus; empat tes Beatbox baru dan regresi preload Studio |
| Lint | Lulus |
| Build retirement-release | SUCCESS; receipt `f68f2a8b-bdc6-4ad5-9c5b-5af8d6db527c`; build sebelumnya dipertahankan |
| Native source | 19/19 lulus: slow 6, failure 7, normal 6 |
| Native compiled | 19/19 lulus: slow 6, failure 7, normal 6 |
| Startup | Frame berlangsung dan indikator ada sebelum fetch pertama; seluruh audio terkunci; tidak ada enable prematur |
| File terakhir tertahan | 11/12 tetap mengunci audio; seluruh pilihan B bertahan |
| A/B dan proyek saat loading | Dua stream tertahan tidak dibatalkan oleh pilihan, Jeda, Mulai ulang, Simpan dan Muat proyek lokal |
| Failure | HTTP 503 terkontrol menjeda antrean; retry gagal lalu berhasil mempertahankan pilihan B |
| Semua mapping | 12 karakter/variasi dimainkan tanpa fetch/decode tambahan pada context utama |
| Playback | Coba groove, Jeda, Putar berhasil; analyser menunjukkan peak native sekitar 0,873 |
| WAV | Mono 48 kHz, 960.000 frame/20 detik, 1.920.044 bytes; enam karakter aktif, diperiksa dalam memori |
| Tanpa gesture | Dua belas sampel siap pada context suspended 48 kHz, 0 sumber suara dimulai sebelum gesture playback |
| Bahasa/context | ID/EN mempertahankan kesiapan; suspend/close/context pengganti pulih tanpa autoplay atau pesan error usang |

Bukti disimpan di `qa-artifacts/beatbox-preload-2026-11-12/`, terutama `source-{slow,failure,normal}.json`, `compiled-{slow,failure,normal}.json`, `source-no-gesture.json`, `compiled-no-gesture.json`, serta unit/lint/build logs. Server dan fixture hanya sarana lokal dan tidak masuk build/commit aplikasi.

Suite unit pertama di sandbox menemui penolakan akses loopback/junction pada empat pengujian lingkungan. Suite lengkap dijalankan ulang dengan akses lokal yang sesuai dan seluruh 655 tes lulus. Probe fixture normal pertama berhasil menyiapkan 12 sampel tanpa gesture, tetapi mencoba menjalankan playback dari timer dan ditolak kebijakan autoplay. Fixture diperbaiki agar mencatat kesiapan terlebih dahulu, kemudian menunggu gesture tombol QA sebelum uji playback. State awal context dicatat, bukan dipaksakan sebagai asumsi lintas browser; run final source dan compiled mengamati suspended. Probe awal yang gagal tidak dihitung sebagai lulus.

Tidak ada upload, download melalui UI, impor file, izin mikrofon, atau dialog konfirmasi pengguna. Simpan/Muat yang diuji hanya proyek disposable di origin localhost milik QA. WAV dibuat dan dibaca di memori. Pengujian membuktikan software dan sinyal audio native browser internal Windows, bukan penilaian listening manusia atau speaker fisik. Ponsel fisik dan iOS/Safari belum diuji; responsive menggunakan viewport. Runner browser E2E terpisah tidak dijalankan.

Regresi build: Studio mencapai 49/49, Kick, Muat demo, Putar, Jeda, dan Kembali ke awal bekerja tanpa console error/warning. Pad Station mencapai lima grup 21/21 dan Kethuk 2/2; Kick, Bilah D4, dan Hentikan suara bekerja tanpa console error/warning. Bukti `studio-regression.txt`, `pad-regression.txt`. Indikator 11/12 tepat di antara `.bb-intro` dan `.bb-guide`; enam karakter terkunci dan 12 tombol variasi aktif (`layout-loading.json`).

## Deployment dan UI live

Commit fitur `f5d52b499bcd8fc875dcdbfdc674a0c62ceeae2e` dipush ke GitHub main dan terbit melalui deployment otomatis Cloudflare Pages. `version.json` menunjukkan SHA tersebut dan branch main. Verifier membandingkan 31 HTML/JS/CSS: 17 identik byte demi byte; 14 identik setelah pemetaan referensi nama aset dari manifest. Perbedaan yang dibatasi adalah NOTICE Windows 2.622 bytes CRLF versus produksi 2.611 bytes LF, teks identik setelah konversi. Hash NOTICE dan bundle yang merujuknya berubah; tidak ada perbedaan kode lain. Bukti `deployment-f5d52b4.json`. Seluruh 12 WAV merespons HTTP 200 dan identik byte dengan aset lokal (`live-audio-audit.json`). Pemeriksaan awal sempat mengalami timeout koneksi; pengulangan dengan retry terbatas selesai lulus.

Alur live dari beranda memperlihatkan waiting 0/12; enam karakter, Putar, Coba groove, dan Buat WAV disabled. Kemudian siap 12/12 dengan enam karakter, 12 tombol A/B, Putar, Coba groove, dan Buat WAV enabled. Jumlah karakter aktif tetap 0, sesuai aturan tanpa autoplay. Pemeriksaan live tidak mengubah pilihan karakter, variasi, demo, atau pola draft pengguna; pengujian audio rinci dilakukan pada localhost.

Pada live ID/EN lebar 390 dan 1440, tidak ada overflow horizontal. Indikator berada tepat antara `.bb-intro` dan `.bb-guide`. Perubahan bahasa mempertahankan 12/12. Console tidak menampilkan error/warning. Bukti `live-startup.json`, `live-mobile-{id,en}.json`, `live-desktop-id.json`, serta screenshot ready mobile/desktop ID/EN. Viewport sementara dikembalikan ke default; tab dan server QA ditutup. Tab live dipertahankan untuk pengguna.

Satu artefak source sempat tertimpa status awal saat reload dan pengulangan pada server dev lama mengalami timeout stream. Server dev QA diganti, suite source dijalankan ulang sampai selesai, lalu seluruh enam hasil skenario diperiksa lagi: source 19/19 dan compiled 19/19 lulus. Hasil WAITING/FAIL tidak dihitung sebagai lulus.

Dokumentasi penutup dipublikasikan melalui jalur GitHub main ke Cloudflare Pages yang sama. SHA akhir dan kecocokan HEAD/GitHub/live direkam dalam `completion.json` setelah deployment penutup terverifikasi. Tidak ada upload manual deployment.

URL hasil: https://perkusi.com/beatbox/?lang=id
