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
export function renderExtraPads(locale) {
  const t = extraPadCopy[locale];
  return `<section class="ps-extra-group" aria-labelledby="ps-extra-title"><h3 id="ps-extra-title" data-extra-copy="title">${t.title}</h3><label><span data-extra-copy="instrument">${t.instrument}</span> <select id="ps-extra-instrument" disabled><option value="kethuk">Kethuk</option></select></label><p data-extra-copy="hint">${t.hint}</p><div class="st-pads ps-extra-pads">${["pelog-6", "slendro-2"].map((id, i) => `<button type="button" disabled class="st-pad ps-extra-pad" data-live-pad="extra:${id}" aria-label="Kethuk ${t.notes[i]}"><span>Kethuk</span><strong>${t.notes[i]}</strong></button>`).join("")}</div></section>`;
}
