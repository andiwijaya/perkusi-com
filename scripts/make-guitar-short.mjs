import fs from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = "internal/guitar-short",
  sha = (b) => createHash("sha256").update(b).digest("hex");
const source = JSON.parse(
  fs.readFileSync("internal/loop-instruments/manifest.json"),
);
const rate = 48000,
  frames = 86400,
  fadeFrames = 3840;
fs.mkdirSync(root + "/audio", { recursive: true });
const assets = [];
for (const id of ["guitar-b2", "guitar-e3", "guitar-g3"]) {
  const a = source.assets.find(
      (x) => x.sampleId === id && x.profileRate === rate,
    ),
    inputPath = "internal/loop-instruments/" + a.derivative.path,
    input = fs.readFileSync(inputPath);
  assert.equal(sha(input), a.derivative.sha256);
  assert.equal(input.toString("ascii", 0, 4), "RIFF");
  let offset = 12,
    pcmOffset;
  while (offset + 8 <= input.length) {
    const tag = input.toString("ascii", offset, offset + 4),
      n = input.readUInt32LE(offset + 4);
    if (tag === "fmt ") {
      assert.equal(input.readUInt16LE(offset + 8), 3);
      assert.equal(input.readUInt16LE(offset + 10), 1);
      assert.equal(input.readUInt32LE(offset + 12), rate);
      assert.equal(input.readUInt16LE(offset + 22), 32);
    }
    if (tag === "data") pcmOffset = offset + 8;
    offset += 8 + n + (n % 2);
  }
  assert(pcmOffset && input.length >= pcmOffset + frames * 4);
  const b = Buffer.alloc(44 + frames * 4);
  b.write("RIFF", 0);
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(32, 34);
  b.write("data", 36);
  b.writeUInt32LE(frames * 4, 40);
  let peak = 0,
    energy = 0;
  for (let i = 0; i < frames; i++) {
    const envelope =
        i < frames - fadeFrames
          ? 1
          : 0.5 *
            (1 +
              Math.cos(
                (Math.PI * (i - (frames - fadeFrames))) / (fadeFrames - 1),
              )),
      value =
        i === frames - 1
          ? 0
          : Math.fround(input.readFloatLE(pcmOffset + i * 4) * envelope);
    assert(Number.isFinite(value));
    b.writeFloatLE(value, 44 + i * 4);
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
  }
  assert(peak > 0 && peak <= 0.95);
  assert.equal(b.readFloatLE(b.length - 4), 0);
  const assetPath = "audio/" + id + ".wav",
    outputPath = root + "/" + assetPath;
  if (fs.existsSync(outputPath))
    assert.equal(
      sha(fs.readFileSync(outputPath)),
      sha(b),
      "Refuse overwrite of changed derivative",
    );
  else fs.writeFileSync(outputPath, b);
  assets.push({
    id: id.slice(7),
    assetPath,
    bytes: b.length,
    sha256: sha(b),
    frames,
    sampleRate: rate,
    channels: 1,
    durationSeconds: frames / rate,
    gainTrim: 0.55,
    peak,
    rms: Math.sqrt(energy / frames),
    licenseId: "CC0-1.0",
    author: a.creator,
    sourcePage: a.sourcePage,
    originalPath: a.originalPath,
    originalSHA256: a.originalSHA256,
    inputPath,
    inputSHA256: a.derivative.sha256,
    sourceDurationSeconds: a.derivative.duration,
    transforms:
      "First 1.8 seconds of retained 48 kHz Float32 mono delivery; half-cosine fade over final 80 ms. No gain normalization, pitch shift, synthetic missing notes or time stretch. Playback adds the existing short attack and a 10 ms same-pitch retrigger fade; different pitches ring together.",
  });
}
const licensePath = "internal/loop-instruments/source-forms/guitar/cc0.txt";
fs.writeFileSync(root + "/LICENSE.txt", fs.readFileSync(licensePath));
const manifest = {
  schemaVersion: 1,
  id: "nylon-guitar-short",
  version: "1.0.0",
  notes: ["b2", "e3", "g3"],
  createdAt: "2026-10-23",
  quality:
    "Limited three-note short nylon guitar; listening UNVERIFIED; not a complete guitar library",
  license: "CC0-1.0",
  licenseEvidence: licensePath,
  licenseEvidenceSHA256: sha(fs.readFileSync(licensePath)),
  recipe: "scripts/make-guitar-short.mjs",
  recipeSHA256: sha(fs.readFileSync(new URL(import.meta.url))),
  assets,
};
fs.writeFileSync(
  root + "/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    assets: assets.length,
    encodedBytes: assets.reduce((n, a) => n + a.bytes, 0),
    decodedBytes: frames * 4 * assets.length,
    sourceFilesChanged: false,
  }),
);
