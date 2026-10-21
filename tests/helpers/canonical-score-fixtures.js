import fixture from "../fixtures/v5-canonical/schema5-eq-overdub-alignment.perkusi.json" with { type: "json" };
import c44 from "../../internal/instrument-focus/registry-44100.json" with { type: "json" };
import c48 from "../../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../../src/audio/instrument-registry.js";
import { physicalFocus } from "../../src/gamelan/instrument-focus.js";
import { migrateLegacyMetadata } from "../../src/project/canonical-metadata.js";
import { compileCanonicalTimeline } from "../../src/project/canonical-timeline.js";
import { canonicalSoundKey } from "../../src/audio/canonical-score.js";
import { hashBytes } from "../../src/project/canonical-data.js";
import { PPQ } from "../../src/project/instrument-project.js";

const seedOf = (key) => {
  let n = 7;
  for (const c of key) n = (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0;
  return (n % 17) + 1;
};
// Rational, integer-indexed multi-component QA waveform; reproducible Float32
// bits across engines. Not a replacement/placeholder for production samples.
export function qaSample(key, i, c) {
  const seed = seedOf(key),
    saw = ((i * (seed * 2 + 1) + c * 71) % 997) / 997 - 0.5;
  const pulse = (i + seed * 11 + c * 23) % 379 < 97 ? 0.23 : -0.08;
  const envelope = 0.55 + (0.45 * ((i + seed) % 8191)) / 8191;
  return Math.fround((saw * 0.013 + pulse * 0.017) * envelope);
}
export function qaBuffer(channels, length, rate) {
  const cs = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    length,
    sampleRate: rate,
    numberOfChannels: channels,
    duration: length / rate,
    getChannelData: (c) => cs[c],
    copyFromChannel: (target, c, start = 0) =>
      target.set(cs[c].subarray(start, start + target.length)),
  };
}
export async function canonicalScoreFixture(
  rate,
  memory,
  createBuffer = qaBuffer,
  { profile = "mixed", afterLoad } = {},
) {
  const registry = new InstrumentRegistry((rate === 44100 ? c44 : c48).banks),
    raw = structuredClone(fixture);
  const shortest = (items) =>
    [...items].sort((a, b) => a.descriptor.frames - b.descriptor.frames)[0];
  const saron = shortest(physicalFocus(registry, "saron-barung", "pelog")),
    slenthem = shortest(physicalFocus(registry, "slenthem", "pelog"));
  if (!saron || !slenthem) throw Error("QA focus unavailable");
  const descriptors = new Map(),
    stats = { loads: 0, buffers: 0, releases: 0 },
    sampleDataKeys = new Map();
  const makeDescriptor = async (
    key,
    frames,
    channels,
    gainTrim = 0.47,
    planar = false,
  ) => {
    const lease = memory.reserve(
      frames * channels * 4,
      "QA/fixture-hash-authoring",
    );
    try {
      const bytes = new Uint8Array(frames * channels * 4),
        v = new DataView(bytes.buffer);
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < channels; c++)
          v.setFloat32(
            (planar ? c * frames + i : i * channels + c) * 4,
            qaSample(key, i, c),
            true,
          );
      return {
        frames,
        channels,
        sampleRate: rate,
        encodedBytes: 0,
        gainTrim,
        hashKind: "decoded-pcm",
        contentHash: await hashBytes(bytes),
      };
    } finally {
      lease.release();
    }
  };
  for (const ref of raw.assetRefs) {
    ref.frames = Math.round(rate * 2.5);
    ref.sampleRate = rate;
    ref.bytes = ref.frames * ref.channels * 4;
    const key = "QA/" + ref.id,
      d = await makeDescriptor(key, ref.frames, ref.channels, 1, true);
    ref.sha256 = d.contentHash;
    const lookup = canonicalSoundKey({ kind: "recording", asset: ref });
    descriptors.set(lookup, d);
    sampleDataKeys.set(lookup, key);
  }
  raw.clock = {
    kind: "fixed-bar",
    sampleRate: rate,
    framesPerBar: Math.round(rate * 2.5),
  };
  raw.master.volume = 0.5;
  for (const t of raw.tracks)
    for (const c of t.clips)
      if (c.phaseAlignment)
        c.phaseAlignment.sourceSHA256 = raw.assetRefs.find(
          (r) => r.id === c.sourceId,
        ).sha256;
  const score = JSON.parse(raw.sources[0].text),
    bankRefs = new Map(
      [saron, slenthem].map((x) => [
        x.bank.id,
        { id: x.bank.id, version: x.bank.version },
      ]),
    );
  score.banks = [...bankRefs.values()];
  const strike = (note, id, tick) => ({
    id,
    tick,
    action: "strike",
    velocity: 0.6,
    bankId: note.bank.id,
    sampleId: note.descriptor.id,
  });
  const damp = (note, id, tick) => ({
    ...strike(note, id, tick),
    action: "damp",
    velocity: 0,
  });
  score.events = [
    strike(saron, "saron-offgrid", 137),
    damp(saron, "saron-damp", PPQ + 19),
    strike(slenthem, "slenthem-tail", 15 * PPQ + 137),
  ];
  score.instrumentMix = [saron, slenthem].map((x) => ({
    bankId: x.bank.id,
    instrumentId: x.descriptor.instrumentId,
    volume: 0.4,
    pan: x === saron ? -0.25 : 0.2,
    mute: false,
    solo: false,
  }));
  let command = { kind: "window", bars: 4, cycles: 1 },
    text;
  if (profile !== "mixed") {
    for (const p of score.composition.patterns) {
      Object.values(p.steps).forEach((a) => a.fill(0));
      p.notes.fill(null);
    }
    score.composition.clips.forEach((c) => (c.enabled = false));
    score.composition.chain = [score.composition.patterns[0].id];
    score.clock.lengthTicks = 4 * PPQ;
    score.events =
      profile === "single"
        ? [strike(saron, "single", 137)]
        : [
            damp(slenthem, "wrap-damp", 137),
            strike(saron, "saron-offgrid", PPQ + 17),
            damp(saron, "saron-damp", 2 * PPQ + 23),
            strike(slenthem, "slenthem-tail", 4 * PPQ - 137),
          ];
    command = {
      kind: profile === "single" ? "once" : "repeat",
      bars: null,
      cycles: profile === "single" ? 1 : 2,
    };
    text = JSON.stringify(score);
  } else {
    raw.sources[0].text = JSON.stringify(score);
    text = JSON.stringify(raw);
  }
  const migrated = await migrateLegacyMetadata(text, { registry }),
    canonical = structuredClone(migrated.project);
  if (profile === "mixed") {
    const placed = canonical.sourceDefs.find(
      (d) =>
        d.id ===
        canonical.sections[0].placements.find(
          (p) => p.sourceRef.kind === "working",
        ).sourceRef.id,
    );
    const c = canonical.sourceDefs.find(
      (d) => d.id === placed.programme.accompanimentRef,
    ).programme;
    for (const p of c.patterns) {
      p.beatbox.forEach((b) => (b.enabled = false));
      Object.assign(p.beatbox[0], { enabled: true, volume: 0.7, pan: -0.3 });
      Object.assign(p.beatbox[2], { enabled: true, volume: 0.4, pan: 0.2 });
      Object.assign(p.beatbox[4], {
        enabled: true,
        volume: 0.3,
        pan: 0,
        variant: 1,
      });
    }
    const b = c.patterns[1];
    Object.assign(b.beatbox[0], { volume: 0.25, pan: 0.6, mute: true });
    b.beatbox[2].enabled = false;
    Object.assign(b.beatbox[4], {
      variant: 2,
      phasePolicy: "restart-on-entry",
    });
  }
  // Catalog authoring is a separately charged QA phase. describe() itself
  // allocates no PCM; actual AudioBuffers are constructed only inside load().
  const timeline = await compileCanonicalTimeline(canonical, {
    registry,
    rate,
    memory,
    command,
  });
  const defs = new Map(timeline.project.sourceDefs.map((d) => [d.id, d])),
    requests = new Map();
  const add = (r) => requests.set(canonicalSoundKey(r), r);
  for (const p of timeline.placements) {
    if (p.recording) add({ kind: "recording", asset: p.recording.asset });
    for (const v of p.native?.voices ?? [])
      add({
        kind: "instrument",
        bankId: v.event.bankId,
        version: v.event.version,
        sampleId: v.event.sampleId,
        descriptor: v.event.descriptor,
      });
    if (p.composition) {
      const s = defs.get(p.composition.sourceId),
        g = s.programme;
      for (const shot of p.composition.shots)
        add(
          shot.kind === "bilah"
            ? {
                kind: "bilah",
                pack: { id: g.bilah.id, version: g.bilah.version },
                pitch: shot.pitch,
              }
            : { kind: "percussion", pack: g.pack, role: shot.role },
        );
      for (const seg of p.composition.segments)
        for (const state of seg.phrases)
          if (state.control.enabled)
            add({
              kind: "phrase",
              pack: g.clipPack,
              role: state.role,
              variant: state.control.identity.variant,
            });
    }
  }
  timeline.dispose();
  for (const [key, r] of requests)
    if (!descriptors.has(key)) {
      const frames =
        r.kind === "instrument"
          ? r.descriptor.frames
          : r.kind === "phrase"
            ? 5 * rate
            : Math.round(rate * (r.kind === "bilah" ? 0.43 : 0.29));
      const channels = r.kind === "instrument" ? r.descriptor.channels : 2;
      descriptors.set(key, await makeDescriptor(key, frames, channels));
      sampleDataKeys.set(key, key);
    }
  const provider = {
    purpose: "qa",
    describe: (r) => descriptors.get(canonicalSoundKey(r)),
    async load(r) {
      const key = canonicalSoundKey(r),
        d = descriptors.get(key),
        index = ++stats.loads;
      const buffer = createBuffer(d.channels, d.frames, rate);
      stats.buffers++;
      for (let c = 0; c < d.channels; c++)
        for (let i = 0; i < d.frames; i++)
          buffer.getChannelData(c)[i] = qaSample(sampleDataKeys.get(key), i, c);
      let released = false;
      const loan = {
        buffer,
        release() {
          if (!released) {
            released = true;
            stats.releases++;
          }
        },
      };
      try {
        await afterLoad?.(loan, r, index);
        return loan;
      } catch (e) {
        loan.release();
        throw e;
      }
    },
  };
  return {
    canonical,
    registry,
    provider,
    command,
    stats,
    text,
    originals: migrated.originals,
    descriptors,
  };
}
