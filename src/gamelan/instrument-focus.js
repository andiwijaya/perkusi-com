import { fail } from "../project/instrument-contract.js";

export const CORPUS_INSTRUMENTS = Object.freeze([
  "demung",
  "saron-barung",
  "peking",
  "slenthem",
  "bonang-barung",
  "bonang-panerus",
  "kenong",
  "kempul",
  "kethuk",
  "kempyang",
  "gong-ageng",
  "kendhang-ciblon",
]);
export const instrumentNames = Object.freeze({
  demung: "Demung",
  "saron-barung": "Saron barung",
  peking: "Peking",
  slenthem: "Slenthem",
  "bonang-barung": "Bonang barung",
  "bonang-panerus": "Bonang panerus",
  kenong: "Kenong",
  kempul: "Kempul",
  kethuk: "Kethuk",
  kempyang: "Kempyang",
  "gong-ageng": "Gong ageng",
  "kendhang-ciblon": "Kendhang Ciblon",
});
const shared = new Set(["gong-ageng", "kendhang-ciblon"]);
export function validateFocus(spec) {
  if (
    !spec ||
    !CORPUS_INSTRUMENTS.includes(spec.instrument) ||
    !["pelog", "slendro"].includes(spec.laras) ||
    typeof spec.ensemble !== "boolean"
  )
    fail("unknownInstrumentBank");
  return spec;
}
export function physicalFocus(registry, instrument, laras) {
  validateFocus({ instrument, laras, ensemble: false });
  const bank = registry.bank(
    "cdm-" + (shared.has(instrument) ? "shared" : laras),
    "candidate-1.0.0",
  );
  return bank.samples
    .filter((s) => s.instrumentId === instrument)
    .sort(
      (a, b) =>
        Number(a.pitchId.match(/\d+/)?.[0] ?? 0) -
          Number(b.pitchId.match(/\d+/)?.[0] ?? 0) ||
        a.articulation.localeCompare(b.articulation),
    )
    .map((descriptor) => ({ bank, descriptor }));
}
export function focusSelection(registry, spec) {
  validateFocus(spec);
  const desired = physicalFocus(registry, spec.instrument, spec.laras);
  if (!desired.length) fail("unknownInstrumentSample");
  if (spec.ensemble)
    for (const name of ["kethuk", "kendhang-ciblon", "gong-ageng"])
      desired.push(...physicalFocus(registry, name, spec.laras));
  return [
    ...new Map(
      desired.map((item) => [item.bank.id + "/" + item.descriptor.id, item]),
    ).values(),
  ].sort((a, b) => b.descriptor.frames - a.descriptor.frames);
}
export function padLabel(note) {
  const degree = note.pitch.match(/\d+/)?.[0];
  if (degree) return degree;
  if (note.instrument === "gong-ageng") return "Gong";
  return note.articulation
    .replace("recorded-", "")
    .replace(/^./, (c) => c.toUpperCase());
}
