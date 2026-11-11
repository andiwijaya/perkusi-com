# Verifikasi Loading Lima Grup Utama Pad Station

Tanggal: 12 November 2026, WIB. Baseline: `8bf3e06`. Status: implementasi dan verifikasi lokal selesai; publikasi dilanjutkan melalui GitHub main ke Cloudflare Pages sesuai otorisasi pengguna.

## Perilaku sesuai hasil interview

Halaman dirender dengan pad disabled dan indikator menunggu sebelum pemuatan audio. Antrean baru dimulai setelah dua callback animation frame, memberi halaman kesempatan tampil terlebih dahulu. Antrean milik Pad Station mengajukan maksimal dua sampel bersamaan dan membagi giliran antargrup.

Drum 8, Bilah 5, Kendhang Ciblon 2, Bass elektrik 3, dan Gitar nylon 3 sampel masing-masing memiliki indikator langsung di bawah judul. Seluruh pad satu grup baru aktif setelah seluruh buffer grup selesai diunduh, didekode, dan divalidasi. Grup yang sudah siap dapat dimainkan ketika grup lain masih loading.

Kegagalan satu grup menjeda seluruh antrean dan mempertahankan cache valid serta grup yang sudah siap. Retry memulihkan grup gagal terlebih dahulu. Jika beberapa grup gagal, semuanya harus dipulihkan sebelum pekerjaan lain dilanjutkan. Instrumen tambahan menunggu kelima grup utama berhasil, lalu memuat pilihan terbaru pengguna.

Hentikan suara sekarang memisahkan pembatalan niat ketukan dan penghentian voice dari pembatalan loader. Loading utama dan tambahan terus berjalan. Pergantian instrumen tambahan tetap membatalkan pekerjaan pilihan sebelumnya. Interupsi context dan disposal memiliki pembatalan tersendiri agar hasil usang tidak mengaktifkan pad atau menghasilkan suara terlambat.

Perilaku Stop ini menggantikan perilaku menjeda loading pada iterasi instrumen tambahan sebelumnya. Engine bersama, DSP, gain, sampel, batas memori, batas native decode, dan perilaku transport Studio tidak diubah.

## Hasil verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| Unit suite final | 642/642 PASS, 0 gagal dan 0 skipped |
| Lint | PASS, exit 0 |
| Build retirement release | SUCCESS, exit 0, Vite 1,15 detik |
| Receipt build final | `91133207-5856-4a95-b6cd-03f8a4cfb56d` |
| Source native slow suite | 8/8 PASS, 113 source starts, peak Bilah 0,3957834244 |
| Source native failure suite | 5/5 PASS |
| Compiled native slow suite | 8/8 PASS |
| Compiled native failure suite | 5/5 PASS |
| Batas file bersamaan | Maksimum teramati 2 pada setiap suite |
| Startup | Lima indikator sudah ada dan animation frame telah berlangsung sebelum fetch audio pertama; tidak terlihat pad enabled sebelum loading dimulai |
| Drum tertahan | 7/8 file siap; semua 8 pad Drum disabled; empat grup lain ready dan Bilah menghasilkan keluaran native nonzero |
| Pertama kali mengetuk core | Seluruh 21 pad memulai playback tanpa fetch atau decode tambahan |
| Instrumen tambahan | 19 bank / 89 nada lulus preload dan playback; 0 request tambahan sebelum coreReady |
| Stop | Tidak membatalkan stream core maupun tambahan; tidak menghasilkan ketukan tertunda |
| Kegagalan | Satu grup gagal menjeda antrean; retry gagal tetap menjeda; retry berhasil menyelesaikan grup gagal sebelum grup lain dan tambahan |
| Context dan disposal | Suspend, close, pemulihan cache, context pengganti, dan pagehide dengan pekerjaan pending lulus |
| Tata letak | Desktop 1440 dan mobile 390, ID/EN; tidak ada overflow horizontal; kelima indikator tepat di bawah heading |
| Regresi Studio | 21 pad, tanpa indikator core atau selector tambahan; muat demo, Putar, Jeda, dan kembali awal bekerja |
| Regresi Beatbox | Coba groove, Jeda, Putar, dan Mulai ulang bekerja; tanpa console error pada pemeriksaan akhir |

Browser native menggunakan sample rate 48 kHz. Pengukuran source menunjukkan retained cache 24.109.040 bytes pada akhir pengujian seluruh pilihan tambahan. Angka ini adalah satu snapshot cache aplikasi, bukan maksimum seluruh run atau total RAM browser. Semua bank termasuk bank besar berhasil disiapkan bersama buffer core melalui batas admission yang tersedia.

## Bukti lokal dan batas pemeriksaan

Direktori: `qa-artifacts/pad-core-loading-2026-11-12/`.

- `unit.log`, `lint.log`, dan `build.log`.
- `source-slow.json`, `source-failure.json`, `compiled-slow.json`, dan `compiled-failure.json`.
- `layout.json`, `regression.json`, screenshot loading ID/EN pada mobile/desktop, serta screenshot error.
- `server.mjs` dan `fixture.js` merupakan sarana QA lokal; tidak disertakan dalam build atau commit aplikasi.

Fixture slow menahan stream dengan mengirim byte positif sambil menunda sisanya. Timeout loader aplikasi tidak diperpanjang. Fixture failure mengembalikan HTTP 503 terkontrol. Hasil test dan screenshot dibaca lewat DOM atau disimpan langsung di filesystem; tidak ada upload, download melalui UI, impor file, atau izin mikrofon.

Tinjauan akhir menemukan enable sementara pada pad selama jeda sebelum fetch pertama. Pembaruan status disabled langsung setelah kontrol diaktifkan menutup celah tersebut; pemantauan frame ditambahkan ke fixture dan startup diuji ulang pada source serta build final. Dua tes markup awal juga disesuaikan karena tombol retry menambah jumlah button non-pad; jumlah pad tetap 21.

Pemeriksaan ini membuktikan perilaku software dan sinyal audio native pada browser internal Windows, bukan penilaian listening manusia atau keluaran speaker fisik. Mobile adalah emulasi viewport; ponsel fisik, iOS/Safari, dan preferensi reduced motion OS secara terpisah tidak diuji. Aturan CSS reduced motion yang ada tetap digunakan. Runner E2E Playwright terpisah tidak dijalankan; browser dikendalikan melalui API browser internal yang didukung.

## Publikasi

Menunggu commit implementasi dan pemeriksaan versi, manifest runtime, serta perilaku live pada `https://perkusi.com/pad-station/?lang=id`. Jalur publikasi tetap GitHub `main` ke Cloudflare Pages; tidak ada manual upload deployment.
