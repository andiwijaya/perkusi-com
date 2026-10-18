export const phaseCopy = Object.freeze({
  id: {
    title: "Kompensasi posisi loop",
    layer: "Layer",
    advance: "Majukan (ms; negatif menunda)",
    preview: "Preview 4 bar tanpa menyimpan",
    apply: "Simpan posisi",
    reset: "Reset posisi",
    hint: "Atur tiap layer secara terpisah, maksimal ±250 ms. Nilai positif membaca bagian rekaman lebih awal dan membungkus akhir ke awal periode. PCM asli tidak dipotong atau diubah; materi di luar jendela rekaman tidak dapat dipulihkan. Preview memutar seluruh mix 4 bar tanpa menyimpan posisi; Play biasa memulihkan pengaturan tersimpan. Simpan posisi dapat di-undo. Ini penyesuaian manual, bukan pengukuran latensi hardware; latensi dan listening perangkat BELUM TERVERIFIKASI.",
  },
  en: {
    title: "Loop position compensation",
    layer: "Layer",
    advance: "Advance (ms; negative delays)",
    preview: "Preview 4 bars without saving",
    apply: "Save position",
    reset: "Reset position",
    hint: "Adjust each layer separately, up to ±250 ms. Positive values read the recording earlier and wrap the end into the start of its period. Original PCM is never trimmed or changed; material outside the capture window cannot be recovered. Preview plays the whole mix for 4 bars without saving the position; ordinary Play restores saved settings. Saving a position supports Undo. This is manual adjustment, not a hardware latency measurement; device latency and listening remain UNVERIFIED.",
  },
});
