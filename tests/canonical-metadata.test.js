import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  canonicalFixtureRegistry as registry,
  fixturePCM,
} from "./helpers/canonical-fixtures.js";
import {
  migrateLegacyMetadata,
  validateCanonicalMetadata,
  parseCanonicalMetadata,
  projectLegacyMetadata,
  inspectCanonicalAssets,
  exportCanonicalPortable,
  canonicalSectionCandidates,
} from "../src/project/canonical-metadata.js";
import { canonicalData } from "../src/project/canonical-data.js";
import {
  phraseTransition,
  placementCandidateCount,
  planChainExpansion,
} from "../src/project/arrangement-contract.js";
import {
  parseInstrumentProject,
  PPQ,
} from "../src/project/instrument-project.js";
import { emptyLoopFixture } from "./helpers/retirement-data-fixtures.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { allMix } from "../src/project/composition-model.js";
import { trackGain } from "../src/audio/sequencing.js";

const dir = new URL("./fixtures/v5-canonical/", import.meta.url),
  manifest = JSON.parse(await readFile(new URL("MANIFEST.json", dir))),
  sha = (b) => createHash("sha256").update(b).digest("hex");
const cache = new Map();
async function fixture(id) {
  if (!cache.has(id))
    cache.set(
      id,
      (async () => {
        const bytes = new Uint8Array(
          await readFile(new URL(id + ".perkusi.json", dir)),
        );
        return {
          bytes,
          raw: JSON.parse(new TextDecoder().decode(bytes)),
          ...(await migrateLegacyMetadata(bytes, { registry })),
        };
      })(),
    );
  return cache.get(id);
}
const copy = structuredClone;
for (const f of manifest)
  test(`Q1b fresh inverse ${f.id}: every field/presence and separate raw bytes`, async () => {
    const m = await fixture(f.id),
      canonical = JSON.parse(JSON.stringify(m.project));
    const inverse = await projectLegacyMetadata(canonical, { registry });
    assert.deepEqual(inverse, m.raw);
    assert.equal(sha(m.originals.get(m.project.origins[0].sha256)), f.sha256);
    assert.equal(
      canonical.origins[0].text,
      null,
      "whole original is outside canonical JSON",
    );
    assert(Object.isFrozen(m.project));
    assert(Object.isFrozen(m.project.sourceDefs));
    const raw = m.originals.get(m.project.origins[0].sha256);
    raw[0] ^= 1;
    assert.equal(sha(m.originals.get(m.project.origins[0].sha256)), f.sha256);
  });

test("Q1b inverse reflects edited canonical values without consulting retained original", async () => {
  const m = await fixture("schema3-fifteen-lanes"),
    c = copy(m.project);
  c.master.volume = 0.31;
  c.title = "Edited current state";
  c.sourceDefs[0].programme.title = c.title;
  c.sourceDefs[0].programme.patterns[0].steps.kick[3] = 0.92;
  c.sourceDefs[0].programme.bilah.pan = -0.6;
  const out = await projectLegacyMetadata(JSON.parse(JSON.stringify(c)), {
    registry,
  });
  assert.equal(out.master.volume, 0.31);
  assert.equal(out.title, c.title);
  assert.equal(out.patterns[0].steps.kick[3], 0.92);
  assert.equal(out.instrument.pan, -0.6);
  assert.notDeepEqual(out, m.raw);
  assert.equal(m.raw.master.volume, 0.17);
});

test("Q1b edited working score keeps original, foreign IDs, mixer domains and layer links", async () => {
  const m = await fixture("schema5-eq-overdub-alignment"),
    c = copy(m.project),
    d = c.sourceDefs.find((d) => d.workingOriginId),
    child = c.sourceDefs.find((s) => s.id === d.programme.accompanimentRef);
  d.programme.events[0].velocity = 0.33;
  d.master.volume = 0.25;
  child.programme.patterns[1].steps.kick[2] = 0.8;
  c.master.volume = 0.5;
  c.tracks[1].mix.solo = true;
  const out = await projectLegacyMetadata(c, { registry }),
    working = JSON.parse(out.sources[0].text);
  assert.equal(working.events[0].velocity, 0.33);
  assert.equal(working.composition.master.volume, 0.25);
  assert.equal(working.composition.patterns[1].steps.kick[2], 0.8);
  assert.equal(out.master.volume, 0.5);
  assert.equal(out.tracks[1].solo, true);
  assert.equal(out.origins[0].text, m.raw.origins[0].text);
  assert.equal(out.sources[0].originId, m.raw.sources[0].originId);
  assert.deepEqual(out.tracks[0].layering, m.raw.tracks[0].layering);
  assert.deepEqual(
    working.events.map((e) => [e.id, e.sampleId, e.bankId]),
    JSON.parse(m.raw.sources[0].text).events.map((e) => [
      e.id,
      e.sampleId,
      e.bankId,
    ]),
  );
  assert.equal(sha(m.originals.get(m.project.origins[0].sha256)), sha(m.bytes));
});

test("Q1b per-pattern state is independent; divergence cannot be silently flattened to old global clips", async () => {
  const m = await fixture("schema3-fifteen-lanes"),
    c = copy(m.project),
    p = c.sourceDefs[0].programme;
  const first = JSON.stringify(p.patterns[0]);
  p.patterns[1].beatbox[0].variant = 2;
  p.patterns[1].beatbox[0].enabled = false;
  assert.equal(JSON.stringify(p.patterns[0]), first);
  await validateCanonicalMetadata(c, registry);
  await assert.rejects(projectLegacyMetadata(c, { registry }), {
    code: "needsConversion",
  });
  assert.deepEqual(await projectLegacyMetadata(m.project, { registry }), m.raw);
  const cloned = copy(p.patterns[1]);
  cloned.beatbox[0].volume = 0.1;
  assert.equal(p.patterns[1].beatbox[0].volume, 0.7);
});

test("Q1b object validation breaks supplied mutable aliases rather than preserving shared pattern identity", async () => {
  const c = copy((await fixture("schema3-fifteen-lanes")).project),
    patterns = c.sourceDefs[0].programme.patterns;
  patterns[1].beatbox = patterns[0].beatbox;
  const valid = await validateCanonicalMetadata(c, registry),
    rows = valid.sourceDefs[0].programme.patterns;
  assert.notEqual(rows[0].beatbox, rows[1].beatbox);
  assert.notEqual(rows[0].beatbox[0], rows[1].beatbox[0]);
  const editable = copy(valid);
  editable.sourceDefs[0].programme.patterns[1].beatbox[0].pan = 0.8;
  assert.equal(editable.sourceDefs[0].programme.patterns[0].beatbox[0].pan, 0);
});

test("Q1b omitted/reordered roles and disabled-solo retain exact inverse and global Bilah/percussion scope", async () => {
  const raw = copy((await fixture("schema3-fifteen-lanes")).raw);
  raw.clips = [raw.clips[2], raw.clips[0]];
  raw.clips[0].enabled = false;
  raw.clips[0].solo = true;
  const m = await migrateLegacyMetadata(JSON.stringify(raw), { registry }),
    out = await projectLegacyMetadata(m.project, { registry });
  assert.deepEqual(out, raw);
  assert.equal(m.project.sourceDefs[0].programme.patterns[0].beatbox.length, 6);
  assert.equal(
    trackGain(out.tracks[0], allMix(out)),
    0,
    "disabled-solo edge case matches legacy allMix",
  );
  assert.deepEqual(out.instrument, raw.instrument);
});

test("Q1b optional absent/flat/bypassed EQ, limiter, root consent and explicit zero alignment roundtrip", async () => {
  const base = (await fixture("schema5-eq-overdub-alignment")).raw;
  for (const mode of ["absent", "flat", "bypassed", "zero"]) {
    const p = copy(base);
    p.tuningConsent = mode === "zero";
    if (mode === "absent") {
      delete p.tracks[0].eq;
      delete p.master.limiter;
      delete p.tuningConsent;
      delete p.sources;
      for (const t of p.tracks)
        t.clips = t.clips.filter((c) =>
          p.assetRefs.some((a) => a.id === c.sourceId),
        );
      delete p.clock;
      for (const t of p.tracks) {
        delete t.layering;
        for (const c of t.clips) delete c.phaseAlignment;
      }
    }
    if (mode === "flat")
      p.tracks[0].eq = {
        version: 1,
        bypass: false,
        lowDb: 0,
        midDb: 0,
        highDb: 0,
      };
    if (mode === "bypassed")
      p.tracks[0].eq = {
        version: 1,
        bypass: true,
        lowDb: 3,
        midDb: -2,
        highDb: 1,
      };
    if (mode === "zero") p.tracks[0].clips[0].phaseAlignment.advanceFrames = 0;
    const m = await migrateLegacyMetadata(JSON.stringify(p), { registry });
    assert.deepEqual(
      await projectLegacyMetadata(m.project, { registry }),
      p,
      mode,
    );
  }
});

test("Q1b native/accompaniment lengths in both orders, same-tick ordering and inactive mixer survive", async () => {
  const base = (await fixture("schema4-multibar")).raw;
  for (const bars of [2, 6]) {
    const p = copy(base);
    p.clock.lengthTicks = bars * 4 * PPQ;
    p.events.push({
      ...p.events[0],
      id: "same-tick-damp",
      action: "damp",
      velocity: 0,
    });
    p.events.reverse();
    p.instrumentMix.push({
      bankId: p.banks[0].id,
      instrumentId: "saron-barung",
      volume: 0.2,
      pan: 0.1,
      mute: true,
      solo: false,
    });
    const expected = parseInstrumentProject(JSON.stringify(p), registry),
      m = await migrateLegacyMetadata(JSON.stringify(p), { registry }),
      out = await projectLegacyMetadata(m.project, { registry });
    assert.deepEqual(out, expected);
    assert.equal(m.project.transport.nativeLengthTicks, bars * 4 * PPQ);
    assert.equal(m.project.transport.accompanimentLengthTicks, 16 * PPQ);
    assert.equal(out.events[0].action, "damp");
    assert.equal(out.instrumentMix.at(-1).mute, true);
  }
});

test("Q1b raw UTF8 BOM and replacement-decode bytes are retained separately from semantic inverse", async () => {
  const raw = copy((await fixture("schema2-rhythm-ab")).raw);
  raw.title = "decode-X";
  const text = JSON.stringify(raw),
    body = Buffer.from(text),
    at = body.indexOf("decode-X") + 7,
    invalid = Buffer.concat([Buffer.from([239, 187, 191]), body]);
  invalid[at + 3] = 255;
  const m = await migrateLegacyMetadata(new Uint8Array(invalid), { registry }),
    out = await projectLegacyMetadata(m.project, { registry });
  assert.equal(out.title, "decode-\ufffd");
  assert.equal(sha(m.originals.get(m.project.origins[0].sha256)), sha(invalid));
  assert.notEqual(
    sha(new TextEncoder().encode(JSON.stringify(out))),
    sha(invalid),
  );
});

test("Q1b Node Buffer input and returned originals never alias caller memory", async () => {
  const f = await fixture("schema3-fifteen-lanes"),
    input = Buffer.from(f.bytes),
    before = sha(input),
    m = await migrateLegacyMetadata(input, { registry });
  input.fill(0);
  const a = m.originals.get(m.project.origins[0].sha256);
  a.fill(1);
  assert.equal(sha(m.originals.get(m.project.origins[0].sha256)), before);
  assert.deepEqual(await projectLegacyMetadata(m.project, { registry }), f.raw);
});

test("Q1b cancellation before and during async staging never publishes a replacement or releases foreign ownership", async () => {
  const m = await fixture("schema3-fifteen-lanes"),
    state = { current: m.project, history: [m.project], selection: "a" },
    memory = new AudioMemory(),
    foreign = memory.reserve(32, "foreign-cancel");
  try {
    const before = new AbortController();
    before.abort();
    await assert.rejects(
      migrateLegacyMetadata(m.bytes, { registry, signal: before.signal }),
      { code: "cancelled" },
    );
    const during = new AbortController(),
      pending = migrateLegacyMetadata(m.bytes, {
        registry,
        signal: during.signal,
      });
    during.abort();
    await assert.rejects(pending, { code: "cancelled" });
    assert.equal(state.current, m.project);
    assert.deepEqual(state.history, [m.project]);
    assert.equal(state.selection, "a");
    assert.equal(memory.snapshot().bytes, 32);
  } finally {
    foreign.release();
  }
});

test("Q1b unused different-tempo origin and IDs shared across typed domains remain lossless", async () => {
  const p = copy((await fixture("schema5-eq-overdub-alignment")).raw),
    r = (await fixture("schema2-rhythm-ab")).raw;
  p.origins.push({
    id: "unused-rhythm",
    schemaVersion: 2,
    text: " \n" + JSON.stringify(r) + "\n",
  });
  const old = p.assetRefs[0].id;
  p.assetRefs[0].id = p.tracks[0].id;
  p.tracks[0].clips.find((c) => c.sourceId === old).sourceId =
    p.assetRefs[0].id;
  const m = await migrateLegacyMetadata(JSON.stringify(p), { registry });
  assert.equal(
    m.project.sourceDefs.filter((d) => d.parentId === null).length,
    3,
  );
  assert.deepEqual(await projectLegacyMetadata(m.project, { registry }), p);
});

test("Q1b large valid recording metadata stays inspectable without loading payload or applying defaults", async () => {
  const p = copy((await fixture("schema5-eq-overdub-alignment")).raw);
  delete p.tracks[0].layering;
  p.tracks[0].clips.length = 1;
  delete p.tracks[0].clips[0].phaseAlignment;
  p.tracks[0].clips[0].loop = false;
  p.tracks[0].clips[0].lengthTicks = 2 * PPQ;
  p.clock = { kind: "fixed-bar", sampleRate: 192000, framesPerBar: 480000 };
  Object.assign(p.assetRefs[0], {
    sampleRate: 192000,
    frames: 6144000,
    bytes: 49152000,
  });
  const m = await migrateLegacyMetadata(JSON.stringify(p), { registry });
  assert.deepEqual(await projectLegacyMetadata(m.project, { registry }), p);
  const inspection = await inspectCanonicalAssets(m.project, {
    registry,
    originals: m.originals,
  });
  assert(inspection.issues.some((i) => i.code === "recordingPackageTooLarge"));
  assert.equal(inspection.playableVerified, false);
});

test("Q1b current shared edits to a formerly absent role are exported, not silently discarded", async () => {
  const p = copy((await fixture("schema3-fifteen-lanes")).raw);
  p.clips = [p.clips[2]];
  const m = await migrateLegacyMetadata(JSON.stringify(p), { registry }),
    c = copy(m.project);
  for (const a of c.sourceDefs[0].programme.patterns) a.beatbox[0].variant = 2;
  const out = await projectLegacyMetadata(c, { registry });
  assert.deepEqual(
    out.clips.map((c) => c.role),
    ["hat", "kick"],
  );
  assert.equal(out.clips[1].variant, 2);
  assert.equal(out.clips[1].enabled, false);
});

test("Q1b empty Loop has deterministic non-legacy defaults but no invented old fields", async () => {
  const p = emptyLoopFixture();
  delete p.clock;
  delete p.sources;
  const m = await migrateLegacyMetadata(JSON.stringify(p), { registry });
  assert.equal(m.project.sections[0].name, "A");
  assert.equal(m.project.tracks[0].name, "Track 1");
  assert.equal(m.project.export.bars, 4);
  assert.deepEqual(await projectLegacyMetadata(m.project, { registry }), p);
});

const invalidCases = [
  [
    "unknown top key",
    (c) => {
      c.extra = true;
    },
  ],
  [
    "future version",
    (c) => {
      c.schemaVersion = 7;
    },
  ],
  [
    "duplicate source",
    (c) => {
      c.sourceDefs.push(copy(c.sourceDefs[0]));
    },
  ],
  [
    "dangling source",
    (c) => {
      c.sections[0].placements[2].sourceRef.id = "missing";
    },
  ],
  [
    "cycle",
    (c) => {
      c.sourceDefs[0].parentId = c.sourceDefs[0].id;
      c.sourceDefs[0].master.binding = "parent";
      c.sourceDefs[0].master.volume = null;
    },
  ],
  [
    "wrong clock",
    (c) => {
      c.timing.clock.framesPerBar++;
    },
  ],
  [
    "wrong alignment hash",
    (c) => {
      c.sections[0].placements[0].alignment.sourceSHA256 = "f".repeat(64);
    },
  ],
  [
    "swapped layer",
    (c) => {
      const t = c.tracks[0].layering;
      [t.basePlacementId, t.overdubPlacementId] = [
        t.overdubPlacementId,
        t.basePlacementId,
      ];
    },
  ],
  [
    "third layer",
    (c) => {
      const p = copy(c.sections[0].placements[0]);
      p.id = "third-layer";
      c.sections[0].placements.push(p);
    },
  ],
  [
    "dangling layer",
    (c) => {
      c.tracks[0].layering.basePlacementId = "missing";
    },
  ],
  [
    "duplicate mapping",
    (c) => {
      c.compatibility.idMap.push(copy(c.compatibility.idMap[0]));
    },
  ],
  [
    "unknown field presence",
    (c) => {
      c.compatibility.fieldPresence.push("zzz/unknown");
      c.compatibility.fieldPresence.sort();
    },
  ],
  [
    "corrupt embedded text",
    (c) => {
      c.origins.find((o) => o.kind === "embedded-text").text += " ";
    },
  ],
];
for (const [name, edit] of invalidCases)
  test(`Q1b atomic reject ${name}`, async () => {
    const m = await fixture("schema5-eq-overdub-alignment"),
      c = copy(m.project),
      accepted = JSON.stringify(m.project),
      memory = new AudioMemory(),
      foreign = memory.reserve(32, "foreign-Q1b");
    const state = { current: m.project, history: [m.project], selection: "a" };
    edit(c);
    try {
      await assert.rejects(validateCanonicalMetadata(c, registry));
      assert.equal(JSON.stringify(m.project), accepted);
      assert.equal(state.current, m.project);
      assert.deepEqual(state.history, [m.project]);
      assert.equal(state.selection, "a");
      assert.equal(memory.snapshot().bytes, 32);
      assert.equal(
        sha(m.originals.get(m.project.origins[0].sha256)),
        sha(m.bytes),
      );
    } finally {
      foreign.release();
    }
  });

test("Q1b metadata inspection reports missing/corrupt data and credits without claiming playback/save", async () => {
  const m = await fixture("schema5-eq-overdub-alignment"),
    none = await inspectCanonicalAssets(m.project, { registry });
  assert(none.issues.some((i) => i.code === "missingRecording"));
  assert(none.issues.some((i) => i.code === "missingOriginal"));
  const pcm = fixturePCM(),
    entries = new Map(
      m.project.assets.map((a, i) => [
        a.id,
        {
          blob: new Blob([pcm[i].buffer]),
          provenance: "RAM synthetic fixture",
        },
      ]),
    );
  const good = await inspectCanonicalAssets(m.project, {
    registry,
    entries,
    originals: m.originals,
  });
  assert.deepEqual(good.issues, []);
  assert.equal(good.playableVerified, false);
  assert.equal(good.durableSaved, false);
  const wrongBlob = new Blob(["too short"]);
  let read = false;
  wrongBlob.arrayBuffer = async () => {
    read = true;
    throw Error("must reject size before read");
  };
  const wrong = await inspectCanonicalAssets(m.project, {
    registry,
    originals: new Map([[m.project.origins[0].sha256, wrongBlob]]),
  });
  assert(wrong.issues.some((i) => i.code === "originalHashMismatch"));
  assert.equal(read, false);
  const first = m.project.assets[0];
  entries.set(first.id, {
    blob: new Blob([new Uint8Array(first.bytes)]),
    provenance: "",
  });
  const bad = await inspectCanonicalAssets(m.project, {
    registry,
    entries,
    originals: new Map([[m.project.origins[0].sha256, new Uint8Array([0])]]),
  });
  for (const code of [
    "recordingHashMismatch",
    "recordingCreditsRequired",
    "originalHashMismatch",
  ])
    assert(bad.issues.some((i) => i.code === code));
  const offset = await fixture("schema5-nonzero-offset");
  assert(
    (await inspectCanonicalAssets(offset.project, { registry })).issues.some(
      (i) => i.code === "recordingOffsetUnsupported",
    ),
  );
  assert.throws(() => exportCanonicalPortable(m.project), {
    code: "canonicalPortableNotImplemented",
  });
  assert(Object.is(pcm[0][0], -0));
  assert.equal(sha(pcm[0]), m.project.assets[0].sha256);
});

test("Q1b hash-valid nonfinite raw PCM is reported with bounded scratch and a retained foreign pin", async () => {
  const m = await fixture("schema5-eq-overdub-alignment"),
    c = copy(m.project),
    pcm = fixturePCM(),
    memory = new AudioMemory(),
    foreign = memory.reserve(32, "foreign-inspection");
  pcm[0][0] = NaN;
  c.assets[0].sha256 = sha(pcm[0]);
  for (const s of c.sections)
    for (const p of s.placements)
      if (p.sourceRef.id === c.assets[0].id && p.alignment)
        p.alignment.sourceSHA256 = c.assets[0].sha256;
  const entries = new Map(
    c.assets.map((a, i) => [
      a.id,
      { blob: new Blob([pcm[i].buffer]), provenance: "RAM synthetic fixture" },
    ]),
  );
  try {
    const result = await inspectCanonicalAssets(c, {
      registry,
      entries,
      originals: m.originals,
      memory,
    });
    assert(result.issues.some((i) => i.code === "invalidRecordingPCM"));
    assert.equal(memory.snapshot().bytes, 32);
  } finally {
    foreign.release();
  }
});

test("Q1b nullable phase state composes on→off→off→on from returned cursors", () => {
  const on = {
      identity: {
        packId: "original-groove",
        packVersion: "0.1.0-candidate",
        processing: "bumi-presence-v1",
        role: "kick",
        variant: 1,
      },
      enabled: true,
      gate: true,
      volume: 1,
      pan: 0,
      phasePolicy: "continue-source",
    },
    off = { ...on, enabled: false };
  let previous = on,
    phaseFrame = 100;
  for (const [control, action, phase] of [
    [off, "exit", null],
    [off, "silent", null],
    [on, "restart", 0],
  ]) {
    const r = phraseTransition(previous, control, {
      phaseFrame,
      elapsedFrames: 120000,
      periodFrames: 240000,
    });
    assert.equal(r.action, action);
    assert.equal(r.phaseFrame, phase);
    phaseFrame = r.phaseFrame;
    previous = control;
  }
  assert.throws(() =>
    phraseTransition(on, on, {
      phaseFrame: null,
      elapsedFrames: 1,
      periodFrames: 240000,
    }),
  );
});

test("Q1b repeated source placements/windows/chain occurrences are all charged", async () => {
  const m = await fixture("schema5-eq-overdub-alignment"),
    c = copy(m.project),
    template = copy(c.sections[0].placements[0]);
  c.tracks[0].layering = null;
  c.tracks[1].kind = "recording";
  c.sections[0].placements = [];
  c.compatibility.idMap = c.compatibility.idMap.filter(
    (m) => m.kind !== "placement",
  );
  c.compatibility.fieldPresence = c.compatibility.fieldPresence.filter(
    (p) => !p.endsWith("/alignment"),
  );
  for (let i = 0; i < 64; i++)
    c.sections[0].placements.push({
      ...copy(template),
      id: "repeat-" + i,
      trackId: c.tracks[i < 32 ? 0 : 1].id,
    });
  const p = await validateCanonicalMetadata(c, registry),
    counts = Object.fromEntries(p.sections[0].placements.map((p) => [p.id, 3]));
  assert.equal(
    await canonicalSectionCandidates(p, "a", counts, { registry }),
    64 * 3,
  );
  const repeated = placementCandidateCount(
    Array.from({ length: 64 }, () => ({ sourceId: "same", recurrences: 1 })),
    { same: 2000 },
  );
  assert.equal(repeated, 128000);
  assert.throws(
    () =>
      planChainExpansion(
        [{ id: "a", lengthTicks: 4 * PPQ, candidateCount: repeated }],
        [{ id: "entry", sectionId: "a", repeats: 8 }],
      ),
    { code: "arrangementExpansionLimit" },
  );
  assert.equal(
    planChainExpansion(
      [{ id: "a", lengthTicks: 4 * PPQ, candidateCount: 2000 }],
      [{ id: "entry", sectionId: "a", repeats: 8 }],
    ).candidateCount,
    16000,
    "unique-source counting would undercharge",
  );
});

test("Q1b grouped canonical metadata can exceed legacy50000 nodes without weakening old validators", async () => {
  const m = await fixture("schema3-fifteen-lanes"),
    c = copy(m.project),
    base = copy(c.sourceDefs[0]);
  for (let i = base.programme.patterns.length; i < 16; i++)
    base.programme.patterns.push({
      ...copy(base.programme.patterns[0]),
      id: "p" + (i + 1),
      name: "Extra " + i,
    });
  c.sourceDefs[0] = copy(base);
  for (let i = 1; i < 20; i++) {
    const d = copy(base);
    d.id = "extra-" + i;
    c.sourceDefs.push(d);
    c.compatibility.rolePresence.push({
      sourceId: d.id,
      roles: copy(c.compatibility.rolePresence[0].roles),
    });
  }
  let nodes = 0;
  function count(v) {
    nodes++;
    if (v && typeof v === "object") for (const x of Object.values(v)) count(x);
  }
  count(c);
  assert(nodes > 50000);
  await validateCanonicalMetadata(c, registry);
  await assert.rejects(projectLegacyMetadata(c, { registry }), {
    code: "needsConversion",
  });
});

test("Q1b placement limit is cumulative per bus across sections, not reset at each section", async () => {
  const m = await fixture("schema5-eq-overdub-alignment"),
    c = copy(m.project),
    p = copy(c.sections[0].placements[0]);
  c.tracks[0].layering = null;
  c.sections = [];
  c.activeSection = "a0";
  c.compatibility.idMap = c.compatibility.idMap.filter(
    (m) => m.kind !== "placement",
  );
  c.compatibility.fieldPresence = c.compatibility.fieldPresence.filter(
    (p) => !p.endsWith("/alignment"),
  );
  for (let i = 0; i < 2; i++)
    c.sections.push({
      id: "a" + i,
      name: "A " + i,
      lengthTicks: 4 * PPQ,
      placements: Array.from({ length: 17 }, (_, j) => ({
        ...copy(p),
        id: "p-" + i + "-" + j,
      })),
    });
  await assert.rejects(validateCanonicalMetadata(c, registry), {
    code: "invalidCanonicalProject",
  });
  c.sections[1].placements.length = 15;
  await validateCanonicalMetadata(c, registry);
});

test("Q1b unknown accessors, huge bytes, repeats and malformed imports refuse before reads/state changes", async () => {
  const m = await fixture("schema3-fifteen-lanes"),
    c = copy(m.project);
  let touched = false;
  Object.defineProperty(c.master, "volume", {
    enumerable: true,
    get() {
      touched = true;
      return 1;
    },
  });
  await assert.rejects(validateCanonicalMetadata(c, registry));
  assert.equal(touched, false);
  await assert.rejects(
    parseCanonicalMetadata(" ".repeat(8 * 1024 * 1024 + 1), registry),
    { code: "projectTooLarge" },
  );
  const repeats = copy(m.project);
  repeats.chain[0].repeats = 9;
  await assert.rejects(validateCanonicalMetadata(repeats, registry));
  await assert.rejects(migrateLegacyMetadata("{broken", { registry }));
  await assert.rejects(migrateLegacyMetadata("null", { registry }), {
    code: "invalidCanonicalProject",
  });
  assert.equal(m.project.master.volume, 0.17);
  assert.throws(() => canonicalData({ x: undefined }));
});
