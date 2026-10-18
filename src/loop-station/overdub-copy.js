export const overdubCopy = {
  id: {
    prepare: "Siapkan overdub 2 layer",
    record: "Rekam layer tambahan",
    adopt: "Simpan layer overdub ke proyek",
    hint: "Overdub menambahkan satu layer ke base rekaman penuh. Base tetap utuh dan terdengar; hanya input baru yang direkam. Panjang dan awal siklus mengikuti base. Setelah disimpan, buang salinan sesi untuk memakai Urungkan/Ulangi proyek.",
    ready: "Mode overdub · base tetap utuh · ",
    layers: "2 layer · base + overdub",
    baseReady:
      "Base siap. Pilih Siapkan overdub 2 layer untuk menambahkan rekaman tanpa mengubah base.",
    layeredReady:
      "Dua layer tersimpan. Gunakan Putar semua atau Urungkan proyek; pilih track kosong untuk rekaman baru.",
    errors: {
      overdubBaseRequired:
        "Overdub memerlukan tepat satu base rekaman penuh yang berulang pada track ini. Maksimum dua layer; proyek lama tetap utuh.",
      overdubGeometryMismatch:
        "Panjang, channel atau sample rate layer harus sama dengan base. Base dan take tetap dipertahankan.",
      invalidOverdubLayers:
        "Susunan dua layer tidak valid. Base dan proyek sebelumnya tetap dipertahankan.",
    },
  },
  en: {
    prepare: "Prepare 2-layer overdub",
    record: "Record additional layer",
    adopt: "Save overdub layer to project",
    hint: "Overdub adds one layer to a complete recorded base. The base stays intact and audible; only new input is recorded. Length and cycle start follow the base. After saving, discard session copies to use project Undo/Redo.",
    ready: "Overdub mode · base intact · ",
    layers: "2 layers · base + overdub",
    baseReady:
      "Base ready. Choose Prepare 2-layer overdub to add a recording without changing the base.",
    layeredReady:
      "Two layers saved. Use Play all or project Undo; choose an empty track for a new recording.",
    errors: {
      overdubBaseRequired:
        "Overdub needs exactly one complete looping recorded base on this track. Two layers maximum; the previous project stays intact.",
      overdubGeometryMismatch:
        "Layer length, channels and sample rate must match the base. The base and take are preserved.",
      invalidOverdubLayers:
        "Invalid two-layer structure. The base and previous project are preserved.",
    },
  },
};
