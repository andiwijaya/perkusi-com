# Beatbox loops per pola — satu fitur lokal

Fondasi: retained Rhythm Studio pada commit `ca6bcd5d6521209584be9a2716cab6e073b0ea2e`. Tidak menghidupkan Preview/V5/V6 dan tidak menambah instrumen atau engine.

## Kepemilikan data dan kompatibilitas

- Editor biasa sekarang membuat composition schema3 dengan penanda eksplisit **`loopScope: "pattern-v1"`**. `patterns[].clips` menyimpan `role`, `enabled`, `variant`, `volume`, `pan`, `mute`, `solo` untuk Bumi, Sabet, Cicik, Dum, Luma, Tara. Root `clips` tidak ada pada bentuk baru.
- Bentuk legacy schema3 dengan root `clips` tetap divalidasi/di-serialize tanpa mengubah byte/field aslinya secara diam-diam. Saat editor membuka proyek itu, `withPatternLoops` menyalin kontrol global ke **semua pola** dengan deep copy. Save/download berikutnya menyimpan bentuk eksplisit per pola. Tidak ada migrasi massal storage atau penulisan ke data produksi dalam pengujian.
- V1/Beatbox dan V2 yang masuk melalui alur lama tetap dikonversi oleh adapter yang ada, lalu editor memberi loop setiap pola. Schema/model yang dipakai qualified recovery tidak diganti atau dipangkas.
- Pembaca lama yang belum mengenal field baru akan menolak grammar baru; field per pola tidak dibuat seolah-olah root global sehingga berisiko hilang diam-diam.
- Kit/mixer delapan drum, mixer Bilah, tempo, swing dan master tetap global. Tempo tetap96 BPM jika loop mana pun pada proyek aktif; loop tidak di-stretch/retune.
- Dropdown pola memilih pola yang **diedit**. Dalam Putar rantai, audio mengikuti bar rantai yang sedang terdengar. Kontrol loop diberi teks ID/EN yang menyebut nama pola terpilih.
- Gandakan menyalin loop bersama step/not secara independen. Pola baru memiliki loop kosong. **Kosongkan pola menghapus step drum, not Bilah, dan seluruh loop pola tersebut**, termasuk mix-nya; pola lain tidak berubah. Snapshot history tetap memuat seluruh proyek.
- Buka di Beatbox tetap merupakan konversi eksplisit: bila loop berbeda antar pola, penjelasan menyebut bahwa salinan turunan memakai loop pola terpilih; proyek Studio lengkap tetap sebagai original.

## Waktu dan lifecycle

Pola tetap satu bar; sample Beatbox tetap frasa dua bar. Fase berasal dari transport AudioContext bersama, bukan waktu kedatangan UI/pesan atau hitungan callback.

1. Role tetap enabled dengan variasi sama: **native source dipertahankan** melewati boundary. Tidak ada unconditional retrigger tiap bar. Gain/pan/mute/solo yang berbeda dijadwalkan pada boundary untuk pola yang sedang terdengar.
2. Enabled/disabled atau variasi berubah: sumber lama fade-out4 ms, sumber baru fade-in4 ms pada boundary. Sumber baru mulai di posisi **fase dua bar absolut saat itu**; misalnya bar kedua mulai pada offset2,5 detik di96 BPM, bukan offset nol.
3. Mix menggunakan automation dengan time constant4 ms. Itu berbeda dari klaim bahwa seluruh perubahan mix selesai persis4 ms. Mute dapat mempertahankan source enabled yang tidak terdengar agar fase tetap berlanjut.
4. Pause menyimpan posisi; resume bergabung pada fase tersebut. Stop/reset mengembalikan fase nol. Putar pola tetap mengulang pola satu bar, tetapi source dua bar berjalan terus; rantai ganjil tidak memaksa source reset di awal rantai.
5. Edit kontrol loop menjeda playback secara eksplisit agar asset selection/loading dan perubahan score tidak berlomba dengan boundary. Tekan Putar lagi untuk melanjutkan. Perubahan dropdown saat chain berjalan tidak memilih ulang suara berdasarkan pola editor.
6. Boundary yang sudah dijadwalkan tetapi belum terdengar dibatalkan saat reschedule/Pause: future source dilepas, fade sumber lama dipulihkan, future mix automation dibatalkan. Stop/retirement tetap dimiliki engine yang sama.
7. Offline WAV memakai aturan transisi yang sama, tetapi satu putaran chain. Source tidak diulang ulang hanya karena pola berganti. Drum/Bilah dan solo mix dihitung menurut pola yang terdengar, bukan dropdown editor.

Semua varian enabled yang dibutuhkan pola dimuat sebelum Play; role+variant didedup. Existing admission/headroom/memory guards tetap. Tidak ada API berbayar, upload audio, microphone atau storage backend baru.

## Batas bukti

Native scheduling dan native offline PCM dapat membuktikan identity/phase, waveform dan channel/mute yang diperiksa. Itu **bukan human listening**, qualification HP fisik/Safari, atau bukti bahwa historical V5 playback interruption sudah diperbaiki. Callback terlambat tetap mengikuti kebijakan scheduler retained yang melewatkan expired steps; fitur ini tidak mengklaim kebal terhadap producer/browser stalls.
