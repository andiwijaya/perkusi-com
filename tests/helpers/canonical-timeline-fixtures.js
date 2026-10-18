import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { InstrumentRegistry } from "../../src/audio/instrument-registry.js";
import c44 from "../../internal/instrument-focus/registry-44100.json" with { type: "json" };
import c48 from "../../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { migrateLegacyMetadata } from "../../src/project/canonical-metadata.js";

export const registryAt = (rate) =>
  new InstrumentRegistry((rate === 44100 ? c44 : c48).banks);
export async function timelineFixture(name, rate = 48000) {
  const bytes = await readFile(
    new URL(`../fixtures/v5-canonical/${name}.perkusi.json`, import.meta.url),
  );
  const registry = registryAt(rate);
  const migrated = await migrateLegacyMetadata(new Uint8Array(bytes), {
    registry,
  });
  return { bytes, text: bytes.toString("utf8"), registry, ...migrated };
}
export const pcmHash = (b) => {
  const hash = createHash("sha256");
  for (let c = 0; c < b.numberOfChannels; c++)
    hash.update(new Uint8Array(b.getChannelData(c).buffer));
  return hash.digest("hex");
};
// Explicit synthetic RAM QA provider. These are NOT production sounds or
// production asset hashes. Two channels, transients, multiple tones, polarity,
// gain trims, distinct roles/variants and long enough tails exercise the DSP.
export function timelineSamples(rate, memory) {
  let serial = 0;
  const entries = [],
    leases = [];
  const make = (length, channels = 2) => {
    const seed = ++serial;
    leases.push(
      memory.reserve(length * channels * 4, "QA/synthetic-shared-sample"),
    );
    const data = Array.from({ length: channels }, (_, c) =>
      Float32Array.from(
        { length },
        (_, i) =>
          0.018 *
            (1 + 0.2 * Math.sin(i / 97)) *
            Math.exp(-i / length) *
            (Math.sin((i + 13 * c) * (0.011 + 0.003 * seed)) +
              0.31 * Math.cos(i * (0.031 + 0.002 * c))) +
          (i % (317 + seed) === 7 ? 0.012 : 0),
      ),
    );
    const buffer = Object.freeze({
      length,
      sampleRate: rate,
      numberOfChannels: channels,
      duration: length / rate,
      getChannelData: (c) => data[c],
    });
    const entry = { buffer, stem: { gainTrim: 0.23 + (seed % 5) * 0.11 } };
    entries.push(entry);
    return entry;
  };
  const percussion = new Map(
    [
      "kick",
      "snare",
      "closed-hat",
      "open-hat",
      "clap",
      "tom",
      "rim",
      "shaker",
    ].map((r, i) => [
      r,
      make(Math.round(rate * (0.18 + i * 0.025)), (i % 2) + 1),
    ]),
  );
  const bilah = new Map(
    ["d4", "f4", "g4", "a4", "c5"].map((p) => [
      p,
      make(Math.round(rate * 0.43)),
    ]),
  );
  const loops = new Map(
    ["kick", "snare", "hat", "vocal-bass", "hum", "percussion-fx"].flatMap(
      (r) => [1, 2].map((v) => [r + "/" + v, make(2903 + serial * 17)]),
    ),
  );
  return {
    percussion,
    bilah,
    phrase: (c) => loops.get(c.role + "/" + c.variant),
    entries,
    hashes: () => entries.map((e) => pcmHash(e.buffer)),
    dispose: () => leases.forEach((l) => l.release()),
  };
}
