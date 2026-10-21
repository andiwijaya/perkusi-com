// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  CORPUS_INSTRUMENTS,
  physicalFocus,
  focusSelection,
  padLabel,
} from "../src/gamelan/instrument-focus.js";
const registry = (rate) =>
  new InstrumentRegistry(
    JSON.parse(
      readFileSync(
        new URL(
          `../internal/instrument-focus/registry-${rate}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    ).banks,
  );
test("S3 stage has 12 named physical focuses in both laras/profiles, all101 sources represented without transposition", () => {
  assert.equal(CORPUS_INSTRUMENTS.length, 12);
  for (const rate of [44100, 48000]) {
    const r = registry(rate),
      ids = new Set();
    for (const instrument of CORPUS_INSTRUMENTS)
      for (const laras of ["pelog", "slendro"]) {
        const notes = physicalFocus(r, instrument, laras);
        assert.ok(notes.length);
        for (const { bank, descriptor } of notes) {
          ids.add(descriptor.sourceWorkId);
          assert.equal(descriptor.sampleRate, rate);
          assert.equal(descriptor.instrumentId, instrument);
          assert.equal(
            bank.laras,
            ["gong-ageng", "kendhang-ciblon"].includes(instrument)
              ? "shared"
              : laras,
          );
        }
      }
    assert.equal(ids.size, 101);
    assert.deepEqual(
      physicalFocus(r, "bonang-barung", "slendro").map(
        (n) => n.descriptor.pitchId,
      ),
      ["degree-1", "degree-2", "degree-3", "degree-5", "degree-6"],
    );
    for (const name of ["kempul", "kenong"])
      assert.equal(
        physicalFocus(r, name, "pelog").some(
          (n) => n.descriptor.pitchId === "degree-4",
        ),
        false,
      );
    assert.deepEqual(
      physicalFocus(r, "gong-ageng", "pelog"),
      physicalFocus(r, "gong-ageng", "slendro"),
    );
    assert.equal(
      new Set(
        physicalFocus(r, "kendhang-ciblon", "pelog").map(
          (n) => n.descriptor.articulation,
        ),
      ).size,
      2,
    );
  }
});
test("S3 focus selection deduplicates ensemble sources and complete cold admission fits accepted64MiB", () => {
  for (const rate of [44100, 48000])
    for (const instrument of CORPUS_INSTRUMENTS)
      for (const laras of ["pelog", "slendro"]) {
        const notes = focusSelection(registry(rate), {
          instrument,
          laras,
          ensemble: true,
        });
        assert.equal(
          new Set(notes.map((n) => n.bank.id + "/" + n.descriptor.id)).size,
          notes.length,
        );
        let resident = 524288;
        for (const { descriptor: d } of notes) {
          const decoded = d.frames * d.channels * 4;
          assert.ok(
            resident + d.encodedBytes + Math.max(d.encodedBytes, decoded) <=
              67108864,
            `${rate}/${instrument}/${laras}`,
          );
          resident += decoded;
        }
        assert.ok(resident <= 67108864);
      }
});
test("S3 untuned stroke labels expose Tak/Thung/Gong rather than invented degrees", () => {
  assert.equal(
    padLabel({
      instrument: "kendhang-ciblon",
      pitch: "untuned",
      articulation: "recorded-tak",
    }),
    "Tak",
  );
  assert.equal(
    padLabel({
      instrument: "gong-ageng",
      pitch: "untuned",
      articulation: "recorded-strike",
    }),
    "Gong",
  );
  assert.equal(
    padLabel({
      instrument: "bonang-barung",
      pitch: "degree-5",
      articulation: "recorded-strike",
    }),
    "5",
  );
});
