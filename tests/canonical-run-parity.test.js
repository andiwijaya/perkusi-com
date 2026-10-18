import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import {
  prepareCanonicalScore,
  canonicalScoreFrame,
} from "../src/audio/canonical-score.js";
import { migrateLegacyMetadata } from "../src/project/canonical-metadata.js";
import { renderLegacyCycles } from "../src/audio/legacy-cycles.js";
import {
  canonicalScoreFixture,
  qaBuffer,
} from "./helpers/canonical-score-fixtures.js";
import { pcmHash } from "./helpers/canonical-timeline-fixtures.js";
import { PPQ } from "../src/project/instrument-project.js";

for (const rate of [44100, 48000])
  test(`Q1cb contiguous A/B/A placement IDs @${rate}: independent legacy cycle PCM/terminal tails`, async () => {
    const memory = new AudioMemory(),
      f = await canonicalScoreFixture(rate, memory),
      old = JSON.parse(JSON.parse(f.text).sources[0].text).composition;
    old.chain = ["p1"];
    old.clips = old.clips.filter((c) => c.role === "kick");
    old.clips[0].enabled = true;
    const text = JSON.stringify(old),
      { project } = await migrateLegacyMetadata(text, { registry: f.registry }),
      c = structuredClone(project);
    const a = c.sections[0];
    a.lengthTicks = 4 * PPQ;
    a.placements[0].lengthTicks = 4 * PPQ;
    const b = structuredClone(a);
    b.id = "b";
    b.name = "B";
    b.placements[0].id = "new-placement-b";
    c.sections.push(b);
    c.chain = [
      { id: "a1", sectionId: "a", repeats: 1 },
      { id: "b1", sectionId: "b", repeats: 1 },
      { id: "a2", sectionId: "a", repeats: 1 },
    ];
    const p = await prepareCanonicalScore(c, {
      ...f,
      rate,
      memory,
      command: { kind: "repeat", bars: null, cycles: 2 },
      createBuffer: qaBuffer,
      yieldTask: async () => {},
    });
    const loans = [],
      leases = [];
    async function entry(request) {
      const d = f.provider.describe(request);
      leases.push(
        memory.reserve(
          d.frames * d.channels * 8 + 8192,
          "QA/independent-cycle-source",
        ),
      );
      const loan = await f.provider.load(request);
      loans.push(loan);
      return { buffer: loan.buffer, stem: { gainTrim: d.gainTrim } };
    }
    const bank = new Map();
    for (const t of old.tracks)
      bank.set(
        t.role,
        await entry({ kind: "percussion", pack: old.pack, role: t.role }),
      );
    const instrument = new Map();
    for (const pitch of new Set(
      old.patterns
        .find((p) => p.id === "p1")
        .notes.filter(Boolean)
        .map((n) => n.pitch),
    ))
      instrument.set(
        pitch,
        await entry({
          kind: "bilah",
          pack: { id: old.instrument.id, version: old.instrument.version },
          pitch,
        }),
      );
    const loop = await entry({
      kind: "phrase",
      pack: old.clipPack,
      role: "kick",
      variant: old.clips[0].variant,
    });
    const context = {
      createBuffer(ch, n, r) {
        leases.push(memory.reserve(ch * n * 8, "QA/independent-cycle-PCM"));
        return qaBuffer(ch, n, r);
      },
    };
    try {
      const period = Math.round(2.5 * rate),
        oracle = await renderLegacyCycles({
          context,
          project: old,
          bank,
          extras: { banks: { loop: () => loop, instrument } },
          rate,
          periodFrames: period,
          yieldTask: async () => {},
        });
      const expected = context.createBuffer(
        2,
        5 * period + oracle.states[1].frames,
        rate,
      );
      for (let channel = 0; channel < 2; channel++) {
        for (let cycle = 0; cycle < 5; cycle++)
          expected
            .getChannelData(channel)
            .set(
              oracle.states[cycle === 0 ? 0 : 1 + ((cycle - 1) % 2)].buffer
                .getChannelData(channel)
                .subarray(0, period),
              cycle * period,
            );
        expected
          .getChannelData(channel)
          .set(oracle.states[1].buffer.getChannelData(channel), 5 * period);
      }
      assert.equal(
        p.program.events.length,
        1,
        "one continuing group reader across different placement IDs",
      );
      assert.equal(p.program.events[0].spec.buffer.length, expected.length);
      assert.equal(
        pcmHash(p.program.events[0].spec.buffer),
        pcmHash(expected),
        "zero-bit Float32 difference from independently parsed legacy cycles",
      );
      assert.ok(
        expected.length > 6 * period,
        "terminal release/natural tail retained",
      );
      for (let cycle = 1; cycle < 6; cycle++)
        for (const delta of [-1, 0, 1, 17]) {
          const frame = cycle * period + delta,
            q = canonicalScoreFrame(p, frame),
            kick = q.phases.find((s) => s.role === "kick");
          assert.equal(kick.phaseFrame, frame % (5 * rate));
          assert.equal(kick.anchorFrame, 0);
          assert.equal(kick.patternId, "p1");
          const occurrence = Math.floor(frame / period) % 3;
          assert.equal(
            kick.originalPlacementId,
            occurrence === 1 ? "new-placement-b" : a.placements[0].id,
          );
          assert.deepEqual(
            canonicalScoreFrame(p, frame),
            q,
            "same prepared frame is stable during pause",
          );
        }
    } finally {
      p.dispose();
      loans.forEach((l) => l.release());
      leases.forEach((l) => l.release());
    }
    assert.equal(memory.snapshot().bytes, 0);
  });
