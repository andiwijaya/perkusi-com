export const extraPadCopy = {
  id: {
    title: "Instrumen tambahan",
    instrument: "Pilih instrumen",
    hint: "Strike rekaman asli; tidak merekam atau mengubah pola. Nama laras mengikuti label sumber, bukan klaim penyeteman bersama Bilah.",
    notes: ["Pelog 6", "Slendro 2"],
    credits:
      "Kethuk: KETHUK_KtPL6.wav dan KETHUK_KtSL2.wav — Digitopia_CdM / Digitopia Casa da Música. Rekaman Pedro Augusto dan Rui Penha; editing Pedro Augusto; dukungan Jorge Queijo dan Maria Mónica. Rekaman CC BY 3.0; paket Artistic 2.0. Perubahan: delivery 48 kHz, gain sumber 0,8, lossless FLAC; kalibrasi gain dan envelope tepi singkat saat playback. Durasi penuh tetap; tanpa retune/denoise. Tidak menyiratkan endorsement atau verifikasi budaya/listening.",
  },
  en: {
    title: "Additional instruments",
    instrument: "Choose instrument",
    hint: "Original recorded strikes; no recording or pattern changes. Scale names follow source labels, not a claim of shared tuning with Bilah.",
    notes: ["Pelog 6", "Slendro 2"],
    credits:
      "Kethuk: KETHUK_KtPL6.wav and KETHUK_KtSL2.wav — Digitopia_CdM / Digitopia Casa da Música. Recorded by Pedro Augusto and Rui Penha; edited by Pedro Augusto; support by Jorge Queijo and Maria Mónica. Recordings CC BY 3.0; package Artistic 2.0. Changes: 48 kHz delivery, source gain 0.8, lossless FLAC; runtime gain calibration and short edge envelope. Full duration retained; no retuning/denoising. No endorsement or cultural/listening verification implied.",
  },
};
export const extraPadNotes = {
  kethuk: {
    name: "Kethuk",
    notes: [
      ["pelog-6", "Pelog 6"],
      ["slendro-2", "Slendro 2"],
    ],
  },
  kempyang: {
    name: "Kempyang",
    notes: [
      ["pelog-6", "Pelog 6"],
      ["slendro-1", "Slendro 1"],
    ],
  },
};
Object.assign(extraPadNotes, {
  "kenong-pelog": {
    name: "Kenong",
    option: "Kenong — Pelog",
    notes: [
      ["pelog-1", "Pelog 1"],
      ["pelog-2", "Pelog 2"],
      ["pelog-3", "Pelog 3"],
      ["pelog-5", "Pelog 5"],
      ["pelog-6", "Pelog 6"],
      ["pelog-7", "Pelog 7"],
    ],
  },
  "kenong-slendro": {
    name: "Kenong",
    option: "Kenong — Slendro",
    notes: [
      ["slendro-1", "Slendro 1"],
      ["slendro-2", "Slendro 2"],
      ["slendro-3", "Slendro 3"],
      ["slendro-5", "Slendro 5"],
      ["slendro-6", "Slendro 6"],
    ],
  },
});
for (const locale of ["id", "en"])
  extraPadCopy[locale].kenongCredits = extraPadCopy[locale].credits.replace(
    "Kethuk: KETHUK_KtPL6.wav " +
      (locale === "id" ? "dan" : "and") +
      " KETHUK_KtSL2.wav",
    "Kenong: KENONG_KPL1h.wav, KENONG_KPL2.wav, KENONG_KPL3.wav, KENONG_KPL5.wav, KENONG_KPL6.wav, KENONG_KPL7.wav, KENONG_KSL1h.wav, KENONG_KSL2.wav, KENONG_KSL3.wav, KENONG_KSL5.wav, KENONG_KSL6.wav",
  );
for (const locale of ["id", "en"])
  extraPadCopy[locale].kempyangCredits = extraPadCopy[locale].credits
    .replaceAll("Kethuk", "Kempyang")
    .replaceAll("KETHUK_KtPL6.wav", "KEMPYANG_KpPL6.wav")
    .replaceAll("KETHUK_KtSL2.wav", "KEMPYANG_KpSL1.wav");
export function renderExtraButtons(instrument = "kethuk", disabled = false) {
  const g = extraPadNotes[instrument];
  if (!g) throw new Error("Unknown extra instrument");
  return g.notes
    .map(
      ([id, label]) =>
        `<button type="button" ${disabled ? "disabled " : ""}class="st-pad ps-extra-pad" data-live-pad="extra:${id}" aria-label="${g.name} ${label}"><span>${g.name}</span><strong>${label}</strong></button>`,
    )
    .join("");
}
export function renderExtraPads(locale) {
  const t = extraPadCopy[locale];
  return `<section class="ps-extra-group" aria-labelledby="ps-extra-title"><h3 id="ps-extra-title" data-extra-copy="title">${t.title}</h3><label><span data-extra-copy="instrument">${t.instrument}</span> <select id="ps-extra-instrument" disabled>${Object.entries(
    extraPadNotes,
  )
    .map(([id, g]) => `<option value="${id}">${g.option || g.name}</option>`)
    .join(
      "",
    )}</select></label><p data-extra-copy="hint">${t.hint}</p><div class="st-pads ps-extra-pads">${renderExtraButtons("kethuk", true)}</div></section>`;
}
