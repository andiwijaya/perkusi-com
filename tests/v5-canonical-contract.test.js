import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  canonicalFixtureRegistry as registry,
  fixturePCM,
} from "./helpers/canonical-fixtures.js";
import { parseProject } from "../src/project/schema.js";
import { compositionRegistry } from "../src/project/studio-registry.js";
import { allMix } from "../src/project/composition-model.js";
import {
  parseInstrumentProject,
  eventFrame,
  PPQ,
} from "../src/project/instrument-project.js";
import { takePlan } from "../src/project/instrument-take.js";
import { gamelanRepeatPlan } from "../src/project/gamelan-repeat.js";
import {
  parseLoopProject,
  validateLoopProject,
} from "../src/loop-station/project.js";
import { emptyLoopProject, assignSource } from "../src/loop-station/model.js";
import { phaseAdvance } from "../src/loop-station/phase-alignment.js";
import { eqGains } from "../src/loop-station/fx-model.js";
import { recordingProject } from "../src/loop-station/recording-data.js";
import {
  exportAudioBundle,
  importAudioBundle,
} from "../src/loop-station/audio-bundle.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { AudioDocument } from "../src/loop-station/audio-document.js";
import { arrangementEvents } from "../src/audio/sequencing.js";
import { materializeLegacyPatternControls } from "../src/project/pattern-controls.js";
import {
  ARRANGEMENT_LIMITS,
  planChainExpansion,
  phraseTransition,
} from "../src/project/arrangement-contract.js";

const dir = new URL("./fixtures/v5-canonical/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("MANIFEST.json", dir)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const raw = async (id) => readFile(new URL(id + ".perkusi.json", dir));
const json = async (id) => JSON.parse((await raw(id)).toString("utf8"));
for (const fixture of manifest)
  test(`Q1 original ${fixture.id}: pinned bytes, unchanged old grammar and stored values`, async () => {
    const bytes = await raw(fixture.id),
      before = Buffer.from(bytes);
    assert.equal(bytes.length, fixture.bytes);
    assert.equal(sha(bytes), fixture.sha256);
    const value = JSON.parse(bytes.toString("utf8"));
    const parsed =
      fixture.schemaVersion < 4
        ? parseProject(bytes.toString("utf8"), compositionRegistry)
        : fixture.schemaVersion === 4
          ? parseInstrumentProject(bytes.toString("utf8"), registry)
          : parseLoopProject(bytes.toString("utf8"), registry);
    const expected =
      value.master?.volume ?? value.volume ?? value.composition.master.volume;
    assert.equal(
      parsed.master?.volume ?? parsed.composition.master.volume,
      expected,
    );
    assert.deepEqual(bytes, before);
    assert.notEqual(
      sha(Buffer.from(JSON.stringify(value))),
      fixture.sha256,
      "raw original is not normalized JSON",
    );
  });

test("Q1 Rhythm keeps distinct multibar cells/swing,15 logical lanes and per-pattern deep-copy independence", async () => {
  const v2 = await json("schema2-rhythm-ab"),
    v3 = await json("schema3-fifteen-lanes");
  assert.deepEqual(v2.chain, ["p1", "p2", "p1", "p2"]);
  assert.equal(v2.patterns[0].steps.kick[1], 0.75);
  assert.equal(v2.patterns[1].steps.snare[9], 0.4);
  assert.equal(v2.timing.swing, 0.17);
  assert.equal(v2.master.volume, 0.75);
  assert.equal(v3.tracks.length + v3.clips.length + 1, 15);
  const mapped = materializeLegacyPatternControls(v3);
  assert.notEqual(mapped.patterns[0].beatbox[0], mapped.patterns[1].beatbox[0]);
  assert(Object.isFrozen(mapped.patterns[0].beatbox[0]));
  assert.deepEqual(
    mapped.rolePresence,
    v3.clips.map((c) => c.role),
  );
  const controls = structuredClone(mapped.patterns).map((p) => ({
    id: p.id,
    controls: p.beatbox,
  }));
  const original = JSON.stringify(controls[0]);
  controls[1].controls[0].enabled = false;
  controls[1].controls[0].variant = 2;
  controls[1].controls[0].pan = 0.5;
  assert.equal(JSON.stringify(controls[0]), original);
  assert.equal(v3.clips[0].pan, 0);
  const clone = structuredClone(controls[1]);
  clone.controls[0].volume = 0.2;
  assert.equal(controls[1].controls[0].volume, 0.7);
  const a = structuredClone(controls),
    b = structuredClone(controls);
  b[0].controls[0].mute = true;
  assert.equal(a[0].controls[0].mute, false);
  // The metadata adapter is exercised; a Q2 editing UI is not claimed here.
});

test("Q1 pattern materialization retains absent roles and rejects unknown legacy fields", async () => {
  const p = await json("schema3-fifteen-lanes");
  p.clips = [p.clips[0]];
  const before = JSON.stringify(p),
    mapped = materializeLegacyPatternControls(p);
  assert.deepEqual(mapped.rolePresence, ["kick"]);
  for (const pattern of mapped.patterns) {
    assert.equal(pattern.beatbox.length, 6);
    assert.deepEqual(pattern.beatbox[1], {
      role: "snare",
      variant: 1,
      enabled: false,
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      phasePolicy: "continue-source",
    });
  }
  assert.equal(JSON.stringify(p), before);
  p.patterns[0].unexpected = true;
  assert.throws(() => materializeLegacyPatternControls(p), {
    code: "invalidProject",
  });
});

test("Q1 eight outer group buses can retain eight independent15-lane programmes", async () => {
  let project = emptyLoopProject(registry);
  for (let i = 0; i < 8; i++) {
    const score = await json("schema4-multibar");
    score.composition.title = "Independent source " + i;
    project = assignSource(
      project,
      registry,
      "track-" + (i + 1),
      JSON.stringify(score),
      { loop: false },
    );
  }
  assert.equal(project.tracks.length, 8);
  assert.equal(project.origins.length, 8);
  assert.equal(project.sources.length, 8);
  for (const source of project.sources)
    assert.equal(allMix(JSON.parse(source.text).composition).length, 15);
  assert.equal(
    project.sources.length * 15,
    120,
    "nested logical lanes are not eight outer buses",
  );
});

test("Q1 score retains independent native/accompaniment clocks, off-grid attacks/damps and editable A/B", async () => {
  const score = parseInstrumentProject(
    (await raw("schema4-independent-clocks")).toString(),
    registry,
  );
  assert.equal(score.clock.lengthTicks, 8 * PPQ);
  assert.equal(score.composition.chain.length * 4 * PPQ, 16 * PPQ);
  assert.deepEqual(
    score.events.map((e) => e.tick),
    [137, PPQ + 19],
  );
  for (const rate of [44100, 48000]) {
    assert.equal(eventFrame(137, 96, rate), 4);
    assert(
      takePlan(score, registry, rate).frames >= rate * 10,
      "four-bar accompaniment is not cut to two native bars",
    );
  }
  const events = arrangementEvents(score.composition);
  assert(events.some((e) => e.patternId === "p1"));
  assert(events.some((e) => e.patternId === "p2"));
  assert(
    events.some((e) => e.when >= 7.5),
    "later accompaniment bars survive",
  );
  assert.throws(() => gamelanRepeatPlan(score, registry, 48000), {
    code: "repeatNeedsEventOnly",
  });
});

test("Q1 FX/layer/alignment specimen has explicit destination and tested semantic inverse", async () => {
  const p = await json("schema5-eq-overdub-alignment"),
    t = p.tracks[0];
  const specimen = {
    fx: { eq: structuredClone(t.eq) },
    layering: {
      version: t.layering.version,
      basePlacementId: t.layering.baseClipId,
      overdubPlacementId: t.layering.overdubClipId,
    },
    placements: t.clips.map((c) => ({
      id: c.id,
      alignment: structuredClone(c.phaseAlignment),
    })),
  };
  assert.deepEqual(specimen.fx.eq, {
    version: 1,
    bypass: false,
    lowDb: -3,
    midDb: 2,
    highDb: 1,
  });
  assert.deepEqual(
    specimen.placements.map((c) => c.alignment.advanceFrames),
    [137, -211],
  );
  const restored = structuredClone(t);
  restored.eq = structuredClone(specimen.fx.eq);
  restored.layering = {
    version: specimen.layering.version,
    baseClipId: specimen.layering.basePlacementId,
    overdubClipId: specimen.layering.overdubPlacementId,
  };
  restored.clips.forEach((c, i) => {
    c.phaseAlignment = structuredClone(specimen.placements[i].alignment);
  });
  assert.deepEqual(restored, t);
  assert.equal(p.master.volume, 1);
  assert.equal(p.master.limiter.bypass, false);
  assert.equal(
    JSON.parse(p.sources[0].text).composition.master.volume,
    0.17,
    "nested master is distinct from outer master",
  );
  assert.notDeepEqual(
    eqGains(t.eq),
    eqGains(),
    "nonflat DSP identity remains nonflat",
  );
});

test("Q1 opposite circular advances preserve raw bytes, offset0 and exact period", async () => {
  const p = await json("schema5-eq-overdub-alignment"),
    pcm = fixturePCM();
  for (const [i, clip] of p.tracks[0].clips.entries()) {
    const ref = p.assetRefs.find((a) => a.id === clip.sourceId),
      bytes = Buffer.from(pcm[i].buffer);
    const hash = sha(bytes),
      advance = phaseAdvance(clip, ref, p.clock);
    assert.equal(hash, ref.sha256);
    assert.equal(clip.offsetFrames, 0);
    for (const frame of [0, 1, 60000, 119999]) {
      const index = (((frame + advance) % 120000) + 120000) % 120000;
      assert.equal(
        index,
        i === 0 ? (frame + 137) % 120000 : (frame + 120000 - 211) % 120000,
      );
    }
    assert.equal(sha(bytes), hash);
    assert(Object.is(pcm[i][0], -0));
  }
});

test("Q1 unsupported offset is preserved as metadata and rejects portable playback rather than zeroing", async () => {
  const p = parseLoopProject(
    (await raw("schema5-nonzero-offset")).toString(),
    registry,
  );
  assert.equal(p.tracks[0].clips[0].offsetFrames, 137);
  assert.equal(p.master.volume, 0);
  assert.throws(() => recordingProject(p, registry), {
    code: "recordingOffsetUnsupported",
  });
  assert.equal(p.tracks[0].clips[0].offsetFrames, 137);
});

test("Q1 missing/corrupt asset and portable roundtrip retain EQ/layers/alignment/credits and original PCM", async () => {
  const p = await json("schema5-eq-overdub-alignment"),
    pcm = fixturePCM(),
    memory = new AudioMemory();
  const entries = new Map(
    p.assetRefs.map((a, i) => [
      a.id,
      {
        blob: new Blob([pcm[i].buffer]),
        provenance:
          "Q1 synthetic fixture, generated in RAM; no hardware recording",
      },
    ]),
  );
  const before = JSON.stringify(p);
  await assert.rejects(exportAudioBundle(p, new Map(), { registry, memory }), {
    code: "missingRecording",
  });
  const corrupt = new Map(entries);
  corrupt.set(p.assetRefs[0].id, {
    ...entries.get(p.assetRefs[0].id),
    blob: new Blob([new Uint8Array(p.assetRefs[0].bytes)]),
  });
  await assert.rejects(exportAudioBundle(p, corrupt, { registry, memory }), {
    code: "recordingHashMismatch",
  });
  const pack = await exportAudioBundle(p, entries, { registry, memory });
  const original = new Uint8Array(await pack.blob.arrayBuffer()),
    originalHash = sha(original);
  const loaded = await importAudioBundle(pack.blob, { registry, memory });
  try {
    assert.deepEqual(loaded.project, p);
    for (const ref of p.assetRefs)
      assert.equal(
        sha(
          new Uint8Array(await loaded.entries.get(ref.id).blob.arrayBuffer()),
        ),
        ref.sha256,
      );
    assert.equal(
      sha(new Uint8Array(await pack.blob.arrayBuffer())),
      originalHash,
    );
    assert.equal(JSON.stringify(p), before);
  } finally {
    loaded.release();
    pack.release();
  }
  assert.equal(memory.snapshot().bytes, 0);
});

for (const [name, change] of [
  [
    "unknown EQ",
    (p) => {
      p.tracks[0].eq.unsupported = true;
    },
  ],
  [
    "swapped layers",
    (p) => {
      p.tracks[0].layering.baseClipId = p.tracks[0].clips[1].id;
    },
  ],
  [
    "wrong phase hash",
    (p) => {
      p.tracks[0].clips[0].phaseAlignment.sourceSHA256 = "f".repeat(64);
    },
  ],
  [
    "oversized phase",
    (p) => {
      p.tracks[0].clips[0].phaseAlignment.advanceFrames = 12001;
    },
  ],
])
  test(`Q1 rejection ${name} never changes the accepted original`, async () => {
    const p = await json("schema5-eq-overdub-alignment"),
      before = JSON.stringify(p),
      next = structuredClone(p);
    change(next);
    assert.throws(() => validateLoopProject(next, registry));
    assert.equal(JSON.stringify(p), before);
  });

const control = (extra = {}) => ({
  identity: {
    packId: "original-groove",
    packVersion: "0.1.0-candidate",
    processing: "bumi-presence-v1",
    role: "kick",
    variant: 1,
  },
  enabled: true,
  gate: true,
  volume: 0.7,
  pan: 0,
  phasePolicy: "continue-source",
  ...extra,
});
test("Q1 A/B two-bar phrase survives gain/pan/mute/solo gating without phase reset", () => {
  const a = control(),
    b = control({ volume: 0.2, pan: -0.5 });
  let r = phraseTransition(a, b, {
    phaseFrame: 0,
    elapsedFrames: 120000,
    periodFrames: 240000,
  });
  assert.deepEqual(r, {
    action: "continue",
    phaseFrame: 120000,
    audible: true,
  });
  r = phraseTransition(b, control({ gate: false }), {
    phaseFrame: r.phaseFrame,
    elapsedFrames: 120000,
    periodFrames: 240000,
  });
  assert.equal(r.phaseFrame, 0);
  assert.equal(r.audible, false);
  r = phraseTransition(control({ gate: false }), a, {
    phaseFrame: 0,
    elapsedFrames: 120000,
    periodFrames: 240000,
  });
  assert.equal(r.phaseFrame, 120000);
  assert.equal(r.action, "continue");
});
test("Q1 disable/re-enable, variant change and explicit restart have separate phase rules", () => {
  const a = control(),
    opts = { phaseFrame: 110000, elapsedFrames: 120000, periodFrames: 240000 };
  assert.equal(
    phraseTransition(a, control({ enabled: false }), opts).action,
    "exit",
  );
  assert.equal(
    phraseTransition(control({ enabled: false }), a, opts).phaseFrame,
    0,
  );
  const variant = control();
  variant.identity.variant = 2;
  assert.equal(phraseTransition(a, variant, opts).action, "restart");
  assert.equal(
    phraseTransition(a, control({ phasePolicy: "restart-on-entry" }), opts)
      .phaseFrame,
    0,
  );
  assert.equal(phraseTransition(null, a, opts).phaseFrame, 0);
  const snapshot = JSON.stringify(a);
  phraseTransition(a, control({ pan: 0.9 }), opts);
  assert.equal(JSON.stringify(a), snapshot);
});

test("Q1 chain expands bounded A→B→A with independent occurrence IDs and cumulative limits", () => {
  const sections = [
    { id: "A", lengthTicks: 4 * PPQ, candidateCount: 4 },
    { id: "B", lengthTicks: 8 * PPQ, candidateCount: 7 },
  ];
  const chain = [
    { id: "a1", sectionId: "A", repeats: 1 },
    { id: "b", sectionId: "B", repeats: 1 },
    { id: "a2", sectionId: "A", repeats: 1 },
  ];
  const result = planChainExpansion(sections, chain);
  assert.deepEqual(
    result.occurrences.map((o) => o.startTick),
    [0, 4 * PPQ, 12 * PPQ],
  );
  assert.equal(result.candidateCount, 15);
  assert.equal(result.lengthTicks, 16 * PPQ);
  assert(Object.isFrozen(result.occurrences));
  assert(Object.isFrozen(result.occurrences[0]));
  assert.throws(
    () =>
      planChainExpansion(sections, [
        ...chain.slice(0, 1),
        { id: "b", sectionId: "B", repeats: 8 },
      ]),
    { code: "arrangementExpansionLimit" },
  );
  assert.throws(
    () =>
      planChainExpansion(
        [{ id: "A", lengthTicks: 1, candidateCount: 140000 }],
        [chain[0]],
      ),
    { code: "arrangementExpansionLimit" },
  );
  assert.throws(
    () =>
      planChainExpansion(
        [
          {
            id: "A",
            lengthTicks: ARRANGEMENT_LIMITS.lengthTicks,
            candidateCount: 1,
          },
        ],
        [{ ...chain[0], repeats: 2 }],
      ),
    { code: "arrangementExpansionLimit" },
  );
});
test("Q1 malformed controls/refs/getters reject before invoking untrusted code", () => {
  let touched = false;
  const bad = {
    ...control(),
    get volume() {
      touched = true;
      return 1;
    },
  };
  assert.throws(() =>
    phraseTransition(null, bad, {
      phaseFrame: 0,
      elapsedFrames: 0,
      periodFrames: 240000,
    }),
  );
  assert.equal(touched, false);
  assert.throws(() =>
    phraseTransition(null, control(), {
      get phaseFrame() {
        touched = true;
        return 0;
      },
      elapsedFrames: 0,
      periodFrames: 240000,
    }),
  );
  assert.equal(touched, false, "options are validated before destructuring");
  assert.throws(() =>
    planChainExpansion(
      [{ id: "A", lengthTicks: 1, candidateCount: 1 }],
      [{ id: "x", sectionId: "missing", repeats: 1 }],
    ),
  );
});

test("Q1 strict master bounds and inspectable oversized asset metadata are not defaulted or decoded", async () => {
  const rhythm = await json("schema2-rhythm-ab");
  rhythm.master.volume = 1;
  assert.throws(
    () => parseProject(JSON.stringify(rhythm), compositionRegistry),
    { code: "invalidProject" },
  );
  const p = await json("schema5-eq-overdub-alignment");
  p.clock = { kind: "fixed-bar", sampleRate: 192000, framesPerBar: 480000 };
  delete p.tracks[0].layering;
  p.tracks[0].clips.length = 1;
  delete p.tracks[0].clips[0].phaseAlignment;
  Object.assign(p.tracks[0].clips[0], { loop: false, lengthTicks: 2 * PPQ });
  Object.assign(p.assetRefs[0], {
    sampleRate: 192000,
    frames: 6144000,
    bytes: 49152000,
  });
  const accepted = validateLoopProject(p, registry);
  assert.equal(accepted.master.volume, 1);
  assert.equal(accepted.assetRefs[0].bytes, 49152000);
  assert.throws(() => recordingProject(accepted, registry), {
    code: "recordingPackageTooLarge",
  });
});

test("Q1 two-layer fixture quota/abort failure retains accepted document, PCM, phase and foreign reservation", async () => {
  const p = await json("schema5-eq-overdub-alignment"),
    pcm = fixturePCM(),
    memory = new AudioMemory();
  const entries = new Map(
    p.assetRefs.map((a, i) => [
      a.id,
      { blob: new Blob([pcm[i].buffer]), provenance: "RAM fixture source" },
    ]),
  );
  const backend = {
    doc: null,
    assets: new Map(),
    fail: false,
    async entry(ref) {
      return this.assets.get(ref.id) ?? {};
    },
    async commit(text, refs, supplied, expected) {
      if (this.fail)
        throw Object.assign(Error("quota"), { code: "audioStorageFull" });
      assert.equal(expected, this.doc?.revision ?? null);
      const revision = (expected ?? 0) + 1;
      this.assets = new Map(refs.map((ref) => [ref.id, supplied.get(ref.id)]));
      this.doc = { text, revision };
      return revision;
    },
  };
  const store = new AudioDocument({ registry, memory, backend });
  const foreign = memory.reserve(32, "foreign-Q1-witness");
  try {
    await store.save(p, { entries });
    const before = structuredClone(backend.doc),
      current = store.current,
      revision = store.revision;
    const changed = structuredClone(p);
    changed.tracks[0].eq.lowDb = 3;
    backend.fail = true;
    await assert.rejects(store.save(changed, { entries }), {
      code: "audioStorageFull",
    });
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      store.save(changed, { entries, signal: abort.signal }),
      { code: "cancelled" },
    );
    assert.deepEqual(backend.doc, before);
    assert.equal(store.current, current);
    assert.equal(store.revision, revision);
    assert.equal(memory.snapshot().bytes, 32);
    for (const ref of p.assetRefs)
      assert.equal(
        sha(
          new Uint8Array(await backend.assets.get(ref.id).blob.arrayBuffer()),
        ),
        ref.sha256,
      );
    assert.deepEqual(
      JSON.parse(backend.doc.text).tracks[0].clips.map(
        (c) => c.phaseAlignment.advanceFrames,
      ),
      [137, -211],
    );
  } finally {
    foreign.release();
  }
  assert.equal(memory.snapshot().bytes, 0);
});

for (const rate of [44100, 48000])
  test(`Q1 ${rate}: mix-only transition phase equals independent absolute-frame oracle`, () => {
    const periodFrames = rate * 5;
    let previous = control(),
      phaseFrame = 0,
      absolute = 0;
    for (let i = 1; i <= 1000; i++) {
      const elapsedFrames = (i * 7919) % (rate * 3),
        next = control({
          volume: (i % 11) / 10,
          pan: ((i % 21) - 10) / 10,
          gate: i % 3 !== 0,
        });
      absolute += elapsedFrames;
      const result = phraseTransition(previous, next, {
        phaseFrame,
        elapsedFrames,
        periodFrames,
      });
      assert.equal(result.phaseFrame, absolute % periodFrames);
      assert.equal(result.action, "continue");
      phaseFrame = result.phaseFrame;
      previous = next;
    }
  });

test("Q1 expansion and control invalid boundaries refuse without partial accepted data", () => {
  const section = { id: "A", lengthTicks: 1, candidateCount: 0 },
    entry = { id: "e", sectionId: "A", repeats: 1 };
  for (const [sections, chain] of [
    [[], [entry]],
    [[section], []],
    [[section, { ...section }], [entry]],
    [[section], [entry, { ...entry }]],
    [[{ ...section, candidateCount: -1 }], [entry]],
    [[section], [{ ...entry, repeats: 0 }]],
    [[{ ...section, extra: 1 }], [entry]],
  ])
    assert.throws(() => planChainExpansion(sections, chain));
  const accepted = planChainExpansion([section], [{ ...entry, repeats: 8 }]);
  assert.equal(accepted.occurrences.length, 8);
  assert.equal(accepted.scheduleBytes, 1024 + 8 * 64);
  for (const next of [
    control({ phasePolicy: "guess" }),
    control({ volume: NaN }),
    control({ pan: 2 }),
  ])
    assert.throws(() =>
      phraseTransition(null, next, {
        phaseFrame: 0,
        elapsedFrames: 0,
        periodFrames: 240000,
      }),
    );
  assert.throws(() =>
    phraseTransition(null, control(), {
      phaseFrame: 240000,
      elapsedFrames: 0,
      periodFrames: 240000,
    }),
  );
  assert.equal(
    phraseTransition(control({ enabled: false }), control({ enabled: false }), {
      phaseFrame: 0,
      elapsedFrames: 0,
      periodFrames: 240000,
    }).action,
    "silent",
  );
});
