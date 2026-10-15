import { emptyInstrumentTake } from "../project/instrument-take.js";
import {
  PPQ,
  validateInstrumentProject,
} from "../project/instrument-project.js";
import { fail } from "../project/instrument-contract.js";

export const INSTRUMENT_DEMOS = Object.freeze([
  {
    id: "pelog-space",
    laras: "pelog",
    title: { id: "Pelog — Ruang", en: "Pelog — Space" },
    detail: {
      id: "Empat bar: saron bergantian 1–2–5, bonang menjawab, kethuk dan Tak/Thung menjaga ruang. Gong menutup. Redam sengaja ditulis sebagai event. Ini komposisi modern kandidat, bukan gending tradisi terverifikasi.",
      en: "Four bars: saron alternates 1–2–5, bonang responds, kethuk and Tak/Thung leave space. Gong closes. Deliberate damps are written events. A modern candidate composition, not a verified traditional gending.",
    },
  },
  {
    id: "pelog-response",
    laras: "pelog",
    title: { id: "Pelog — Jawab", en: "Pelog — Response" },
    detail: {
      id: "Empat bar dengan demung 5 di awal frasa, saron 5–2–1 dan bonang di sela. Kendhang lebih jarang pada bar terakhir. Sumber Pelog asli; tanpa repitch. Validasi budaya/listening masih UNVERIFIED.",
      en: "Four bars with demung 5 starting phrases, saron 5–2–1 and bonang between them. Kendhang leaves more space in the last bar. Original Pelog sources, no repitch. Culture/listening remain UNVERIFIED.",
    },
  },
  {
    id: "slendro-space",
    laras: "slendro",
    title: { id: "Slendro — Ruang", en: "Slendro — Space" },
    detail: {
      id: "Empat bar: saron 1–2–5, demung 2 menandai frasa, bonang menjawab. Kethuk dan Tak/Thung berselang; gong terakhir dibiarkan selesai. Komposisi modern kandidat, bukan klaim keaslian tradisi.",
      en: "Four bars: saron 1–2–5, demung 2 marks phrases, bonang responds. Kethuk and Tak/Thung alternate; the final gong keeps its tail. A modern candidate composition with no authenticity claim.",
    },
  },
  {
    id: "slendro-response",
    laras: "slendro",
    title: { id: "Slendro — Jawab", en: "Slendro — Response" },
    detail: {
      id: "Empat bar dengan jawaban bonang 5–1 dan saron 5–2–1. Kendhang memberi aksen bergeser pada bar genap. Mute grup dan Jeda/Lanjut dapat dipakai untuk mempelajari lapisan. Listening masih UNVERIFIED.",
      en: "Four bars with bonang 5–1 responses and saron 5–2–1. Kendhang shifts accents in even bars. Use group mute and Pause/Continue to study layers. Listening remains UNVERIFIED.",
    },
  },
]);
export function instrumentDemo(id, registry) {
  const demo = INSTRUMENT_DEMOS.find((d) => d.id === id);
  if (!demo) fail("invalidInstrumentProject");
  const project = structuredClone(emptyInstrumentTake(registry));
  project.composition.title = demo.title.id;
  project.composition.chain = Array(4).fill("p1");
  project.clock.lengthTicks = 16 * PPQ;
  const tuned = registry.bank("cdm-" + demo.laras, "candidate-1.0.0"),
    shared = registry.bank("cdm-shared", "candidate-1.0.0"),
    events = [];
  const sample = (bank, instrument, degree) => {
    const s = bank.samples.find(
      (s) =>
        s.instrumentId === instrument &&
        (!degree ||
          s.pitchId === "degree-" + degree ||
          s.articulation.toLowerCase().includes(degree)),
    );
    if (!s) fail("unknownInstrumentSample");
    return s;
  };
  const hit = (bank, s, beat, velocity, dampAfter = null) => {
    const event = (action, at, v) =>
      events.push({
        id: "demo-" + (events.length + 1),
        tick: Math.round(at * PPQ),
        bankId: bank.id,
        sampleId: s.id,
        action,
        velocity: v,
      });
    event("strike", beat, velocity);
    if (dampAfter !== null) event("damp", beat + dampAfter, 0);
  };
  const response = id.endsWith("response"),
    melody = response ? [5, 2, 1, 2] : [1, 2, 5, 2];
  for (let bar = 0; bar < 4; bar++) {
    for (let step = 0; step < 4; step++)
      hit(
        tuned,
        sample(tuned, "saron-barung", melody[(step + bar) % 4]),
        bar * 4 + step,
        0.45 + (step === 0 ? 0.1 : 0),
        0.92,
      );
    for (const step of response ? [1.5, 3.5] : [2.5])
      hit(
        tuned,
        sample(tuned, "bonang-barung", step === 1.5 ? 5 : 1),
        bar * 4 + step,
        0.4,
        0.42,
      );
    if (response || bar % 2 === 0)
      hit(
        tuned,
        sample(tuned, "demung", demo.laras === "pelog" ? 5 : 2),
        bar * 4,
        0.35,
        3.8,
      );
    for (const step of [1, 3])
      hit(tuned, sample(tuned, "kethuk"), bar * 4 + step, 0.4, 0.6);
    for (const step of bar === 3 && response ? [1] : [0, 2])
      hit(
        shared,
        sample(shared, "kendhang-ciblon", step ? "thung" : "tak"),
        bar * 4 + step + (response && bar % 2 ? 0.5 : 0),
        0.6,
      );
  }
  hit(shared, sample(shared, "gong-ageng"), 15.75, 0.5);
  project.banks = [tuned, shared].map((b) => ({
    id: b.id,
    version: b.version,
  }));
  project.events = events;
  return validateInstrumentProject(project, registry);
}
