import {
  array,
  record,
  dataTree,
  identifier,
  version,
  integer,
  finite,
  fail,
  frozenCopy,
} from "../project/instrument-contract.js";

export const MAX_INSTRUMENT_BUFFER_BYTES = 32 * 1024 * 1024;
export const MAX_TAKE_REGION_BYTES = 49152000;
const code = "invalidInstrumentBank";
const rateOK = (rate) => integer(rate, 8000, 192000);
const geometry = (frames, channels, rate, maxBytes) =>
  rateOK(rate) &&
  integer(channels, 1, 2) &&
  integer(frames, 1, Math.floor(maxBytes / channels / 4));
const bankKeys = [
  "id",
  "version",
  "kind",
  "setId",
  "tradition",
  "laras",
  "samples",
];
const sampleKeys = [
  "id",
  "instrumentId",
  "pitchId",
  "articulation",
  "assetPath",
  "sha256",
  "sourceWorkId",
  "licenseId",
  "encodedBytes",
  "sampleRate",
  "channels",
  "frames",
  "gainTrim",
  "voicePolicy",
];
function validateBank(bank) {
  dataTree(bank, code);
  record(bank, bankKeys, code);
  if (
    ![bank.id, bank.setId, bank.tradition].every(identifier) ||
    !version(bank.version) ||
    bank.kind !== "instrument-bank" ||
    !["slendro", "pelog", "shared", "none"].includes(bank.laras)
  )
    fail(code);
  array(bank.samples, 1, 256, code);
  const seen = new Set();
  for (const s of bank.samples) {
    record(s, sampleKeys, code);
    if (
      ![
        s.id,
        s.instrumentId,
        s.pitchId,
        s.articulation,
        s.sourceWorkId,
        s.licenseId,
      ].every(identifier) ||
      seen.has(s.id) ||
      typeof s.assetPath !== "string" ||
      !/^\/sounds\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(wav|mp3|flac)$/.test(
        s.assetPath,
      ) ||
      s.assetPath.length > 256 ||
      typeof s.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(s.sha256) ||
      !integer(s.encodedBytes, 1, 16 * 1024 * 1024) ||
      !geometry(
        s.frames,
        s.channels,
        s.sampleRate,
        MAX_INSTRUMENT_BUFFER_BYTES,
      ) ||
      !finite(s.gainTrim, 0, 1) ||
      !["polyphonic", "choke", "protected-tail"].includes(s.voicePolicy)
    )
      fail(code);
    seen.add(s.id);
  }
  return frozenCopy(bank);
}
// Only an explicitly trusted caller can install descriptors; JSON import cannot.
export class InstrumentRegistry {
  #banks = new Map();
  constructor(banks = []) {
    array(banks, 0, 64, code);
    for (const input of banks) {
      const bank = validateBank(input),
        key = bank.id + "@" + bank.version;
      if (this.#banks.has(key)) fail(code);
      this.#banks.set(key, bank);
    }
    Object.freeze(this);
  }
  bank(id, bankVersion) {
    if (!identifier(id) || !version(bankVersion)) fail("unknownInstrumentBank");
    const bank = this.#banks.get(id + "@" + bankVersion);
    if (!bank) fail("unknownInstrumentBank");
    return bank;
  }
  sample(id, bankVersion, sampleId) {
    if (!identifier(sampleId)) fail("unknownInstrumentSample");
    const sample = this.bank(id, bankVersion).samples.find(
      (s) => s.id === sampleId,
    );
    if (!sample) fail("unknownInstrumentSample");
    return sample;
  }
}
function inspectPCM(buffer, maxBytes, errorCode) {
  if (
    !buffer ||
    !geometry(
      buffer.length,
      buffer.numberOfChannels,
      buffer.sampleRate,
      maxBytes,
    ) ||
    !Number.isFinite(buffer.duration) ||
    Math.abs(buffer.duration - buffer.length / buffer.sampleRate) > 1e-9 ||
    typeof buffer.getChannelData !== "function"
  )
    fail(errorCode);
  let peak = 0,
    energy = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    if (!(data instanceof Float32Array) || data.length !== buffer.length)
      fail(errorCode);
    for (const value of data) {
      if (!Number.isFinite(value)) fail(errorCode);
      peak = Math.max(peak, Math.abs(value));
      energy += value * value;
    }
  }
  return {
    peak,
    rms: Math.sqrt(energy / buffer.length / buffer.numberOfChannels),
    bytes: buffer.length * buffer.numberOfChannels * 4,
    silent: energy === 0,
    overrange: peak > 1,
  };
}
export function inspectInstrumentBuffer(buffer, descriptor) {
  // Descriptor must itself pass the distinct instrument contract.
  const s = validateBank({
    id: "inspection",
    version: "1",
    kind: "instrument-bank",
    setId: "inspection",
    tradition: "inspection",
    laras: "none",
    samples: [descriptor],
  }).samples[0];
  const result = inspectPCM(
    buffer,
    MAX_INSTRUMENT_BUFFER_BYTES,
    "invalidInstrumentPCM",
  );
  if (
    buffer.length !== s.frames ||
    buffer.sampleRate !== s.sampleRate ||
    buffer.numberOfChannels !== s.channels ||
    result.silent ||
    result.peak > 0.95
  )
    fail("invalidInstrumentPCM");
  return Object.freeze(result);
}
export function inspectUserTake(buffer) {
  const result = inspectPCM(buffer, MAX_TAKE_REGION_BYTES, "malformedTakePCM");
  if (buffer.length > buffer.sampleRate * 32) fail("takeRegionLimit");
  // Processing admission only; this never deletes/clamps the caller's original.
  if (result.peak > 16) fail("takeLevelLimit");
  return Object.freeze(result);
}
