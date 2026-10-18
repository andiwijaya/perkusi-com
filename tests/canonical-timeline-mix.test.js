import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compileCanonicalTimeline } from "../src/project/canonical-timeline.js";
import { renderCanonicalComposition } from "../src/audio/canonical-composition-render.js";
import { canonicalLegacyRender } from "../src/audio/canonical-legacy.js";
import { renderPortableMix } from "../src/loop-station/portable-mix.js";
import { prepareLoopPlan } from "../src/loop-station/plan.js";
import { finalMixProgram } from "../src/loop-station/final-program.js";
import { parseLoopProject } from "../src/loop-station/project.js";
import {
  parseInstrumentProject,
  PPQ,
} from "../src/project/instrument-project.js";
import { takePlan } from "../src/project/instrument-take.js";
import { addInstrumentFrames } from "../src/audio/frame-dsp.js";
import { gamelanPlaybackScale } from "../src/audio/gamelan-level.js";
import { migrateLegacyMetadata } from "../src/project/canonical-metadata.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { fixturePCM } from "./helpers/canonical-fixtures.js";
import {
  timelineFixture,
  timelineSamples,
  pcmHash,
} from "./helpers/canonical-timeline-fixtures.js";

const peak = (b) => {
  let maximum = 0;
  for (let c = 0; c < b.numberOfChannels; c++)
    for (const x of b.getChannelData(c))
      maximum = Math.max(maximum, Math.abs(x));
  return maximum;
};
function arena(memory) {
  const leases = [];
  return {
    context: {
      createBuffer(channels, length, rate) {
        leases.push(
          memory.reserve(
            channels * length * 4,
            "QA/PCM-oracle-and-shared-provider",
          ),
        );
        const data = Array.from(
          { length: channels },
          () => new Float32Array(length),
        );
        return {
          length,
          numberOfChannels: channels,
          sampleRate: rate,
          duration: length / rate,
          getChannelData: (c) => data[c],
        };
      },
    },
    dispose: () => leases.forEach((l) => l.release()),
  };
}
function nativeProvider(registry, arena) {
  const entries = new Map();
  const acquire = async (bankId, version, sampleId) => {
    const key = bankId + "/" + version + "/" + sampleId;
    if (!entries.has(key)) {
      const d = registry.sample(bankId, version, sampleId),
        b = arena.context.createBuffer(d.channels, d.frames, d.sampleRate);
      for (let c = 0; c < d.channels; c++)
        for (let i = 0; i < d.frames; i++)
          b.getChannelData(c)[i] =
            0.011 *
            Math.exp(-i / d.frames) *
            (Math.sin(i * (0.019 + c * 0.002)) + 0.2 * Math.cos(i * 0.071));
      entries.set(key, { buffer: b, metrics: { peak: peak(b) }, release() {} });
    }
    return entries.get(key);
  };
  return { acquire, trim() {}, entries };
}

// Test adapter ONLY. Direct logical plan -> physical DSP specs. This deliberately
// does not grant a native-live/voice/headroom/portable capability. Sharing the
// existing low-level final DSP is allowed; its two planners are independent.
async function proofProgram(
  timeline,
  { samples, memory, native, recordings, registry },
) {
  const events = [],
    outputs = [];
  for (const p of timeline.placements) {
    if (p.composition) {
      const result = await renderCanonicalComposition(timeline, p.id, {
        samples,
        memory,
        yieldTask: async () => {},
      });
      outputs.push(result);
      events.push({
        trackId: p.trackId,
        spec: {
          buffer: result.buffer,
          frames: result.buffer.length,
          startFrame: p.composition.startFrame,
          naturalEndFrame: p.composition.endFrame,
          endFrame: p.composition.endFrame,
          dampFrame: null,
          velocity: 1,
          scale: 4,
          pan: 0,
        },
      });
    }
    for (const v of p.native?.voices ?? []) {
      const e = v.event,
        entry = await native.acquire(e.bankId, e.version, e.sampleId);
      events.push({
        trackId: p.trackId,
        spec: {
          buffer: entry.buffer,
          frames: entry.buffer.length,
          startFrame: v.startFrame,
          naturalEndFrame: v.naturalEndFrame,
          endFrame: v.endFrame,
          dampFrame: v.dampFrame,
          velocity: e.velocity,
          scale:
            e.masterVolume *
            e.mix.volume *
            gamelanPlaybackScale(
              registry.bank(e.bankId, e.version),
              entry.metrics.peak,
            ),
          pan: e.mix.pan,
        },
      });
    }
    if (p.recording) {
      assert.equal(p.recording.playbackIssue, null);
      const b = recordings.get(p.recording.asset.id).buffer,
        endFrame = p.startFrame + b.length;
      events.push({
        trackId: p.trackId,
        spec: {
          buffer: b,
          frames: b.length,
          startFrame: p.startFrame,
          naturalEndFrame: endFrame,
          endFrame,
          dampFrame: null,
          velocity: 1,
          scale: 4,
          pan: 0,
          ...(p.alignment
            ? {
                phaseOffsetFrames: p.alignment.advanceFrames,
                loopFrames: b.length,
                stopFrame: endFrame,
              }
            : {}),
        },
      });
    }
  }
  return {
    program: {
      rate: timeline.rate,
      frames: timeline.proposedFrames,
      bodyFrames: timeline.bodyFrames,
      events,
    },
    dispose: () => outputs.forEach((r) => r.dispose()),
  };
}
const comparable = (program) =>
  program.events
    .map(({ trackId, spec: s }) => ({
      trackId,
      start: s.startFrame,
      end: s.endFrame,
      natural: s.naturalEndFrame,
      damp: s.dampFrame,
      velocity: s.velocity,
      scale: s.scale,
      pan: s.pan,
      phase: s.phaseOffsetFrames ?? null,
      loop: s.loopFrames ?? null,
      pcm: pcmHash(s.buffer),
    }))
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.trackId.localeCompare(b.trackId) ||
        a.pcm.localeCompare(b.pcm),
    );

for (const [rate, bars] of [
  [48000, 4],
  [48000, 8],
  [44100, 4],
])
  test(`Q1c schema5 ${rate}/${bars}bars old Loop planner vs direct canonical specs/PCM: EQ, layers and masters`, async () => {
    const f = await timelineFixture("schema5-eq-overdub-alignment", rate),
      memory = new AudioMemory(),
      a = arena(memory);
    if (rate === 44100) {
      // Explicit derived QA capture, not a resample or an altered original file.
      // Generate matching raw-period metadata/hashes from the finite RAM fixture.
      const raw = JSON.parse(f.text),
        pcm = fixturePCM();
      raw.clock = { kind: "fixed-bar", sampleRate: rate, framesPerBar: 110250 };
      for (const [i, ref] of raw.assetRefs.entries()) {
        ref.sampleRate = rate;
        ref.frames = 110250;
        ref.bytes = ref.frames * ref.channels * 4;
        ref.sha256 = createHash("sha256")
          .update(new Uint8Array(pcm[i].buffer, 0, ref.bytes))
          .digest("hex");
      }
      for (const track of raw.tracks)
        for (const clip of track.clips)
          if (clip.phaseAlignment)
            clip.phaseAlignment.sourceSHA256 = raw.assetRefs.find(
              (r) => r.id === clip.sourceId,
            ).sha256;
      f.text = JSON.stringify(raw);
      f.project = (
        await migrateLegacyMetadata(f.text, { registry: f.registry })
      ).project;
    }
    const samples = timelineSamples(rate, memory),
      native = nativeProvider(f.registry, a);
    const recordings = new Map();
    for (const [i, pcm] of fixturePCM().entries()) {
      const ref = f.project.assets[i],
        buffer = a.context.createBuffer(
          ref.channels,
          ref.frames,
          ref.sampleRate,
        );
      for (let frame = 0; frame < ref.frames; frame++)
        for (let c = 0; c < ref.channels; c++)
          buffer.getChannelData(c)[frame] = pcm[frame * ref.channels + c];
      recordings.set(ref.id, {
        buffer,
        sha256: ref.sha256,
        peak: peak(buffer),
        release() {},
      });
    }
    const before = samples.hashes(),
      originalBytes = Buffer.from(f.bytes);
    const timeline = await compileCanonicalTimeline(f.project, {
      registry: f.registry,
      rate,
      memory,
      command: { kind: "window", bars, cycles: 1 },
    });
    // Independent old baseline receives the original schema5 text, old source
    // parser and actual old composition renderer, never canonical metadata.
    const old = await prepareLoopPlan(parseLoopProject(f.text, f.registry), {
      registry: f.registry,
      rate,
      memory,
      cache: native,
      recordedLoops: true,
      resolveRecording: async (ref) => recordings.get(ref.id),
      prepareLegacy: async (doc) => {
        const buffer = await canonicalLegacyRender({
          context: a.context,
          project: doc.composition,
          bank: samples.percussion,
          extras: {
            banks: { loop: samples.phrase, instrument: samples.bilah },
          },
          rate,
          yieldTask: async () => {},
        });
        return {
          buffer,
          frames: buffer.length,
          peak: peak(buffer),
          release() {},
        };
      },
    });
    let direct;
    try {
      const oracle = finalMixProgram(old, bars, { backend: "live-readers" });
      direct = await proofProgram(timeline, {
        samples,
        memory,
        native,
        recordings,
        registry: f.registry,
      });
      assert.deepEqual(comparable(direct.program), comparable(oracle));
      assert.equal(direct.program.frames, oracle.frames);
      const mixProject = {
        master: timeline.project.master,
        tracks: timeline.project.tracks.map((t) => ({
          id: t.id,
          gain: t.mix.volume,
          pan: t.mix.pan,
          mute: t.mix.mute,
          solo: t.mix.solo,
          eq: t.fx.eq,
        })),
      };
      const expected = await renderPortableMix(a.context, old.project, oracle, {
        yieldTask: async () => {},
      });
      const actual = await renderPortableMix(
        a.context,
        mixProject,
        direct.program,
        { yieldTask: async () => {} },
      );
      assert.equal(
        pcmHash(actual),
        pcmHash(expected),
        "all four pre/post limiter channels exact Float32 bits",
      );
      assert.ok(peak(actual) > 0);
      assert.equal(actual.length, bars * 2.5 * rate + Math.ceil(0.1 * rate));
      assert.deepEqual(samples.hashes(), before);
      assert.deepEqual(f.bytes, originalBytes);
      assert.equal(
        timeline.admission.audioAdmitted,
        false,
        "proof adapter grants no runtime capability",
      );
    } finally {
      direct?.dispose();
      old.release();
      timeline.dispose();
      samples.dispose();
      a.dispose();
    }
    assert.equal(memory.snapshot().bytes, 0);
  });

for (const rate of [44100, 48000])
  test(`Q1c native natural/release tails @${rate}: independent legacy take frames and PCM`, async () => {
    const f = await timelineFixture("schema4-multibar", rate),
      raw = JSON.parse(f.text),
      memory = new AudioMemory(),
      a = arena(memory);
    // Four-bar native body, two-bar accompaniment; a final off-grid strike needs a real tail.
    raw.clock.lengthTicks = 16 * PPQ;
    raw.composition.chain = ["p1", "p2"];
    raw.events = [{ ...raw.events[0], tick: 16 * PPQ - 137 }];
    const { project } = await migrateLegacyMetadata(JSON.stringify(raw), {
      registry: f.registry,
    });
    const timeline = await compileCanonicalTimeline(project, {
      registry: f.registry,
      rate,
      memory,
    });
    const oracle = takePlan(
      parseInstrumentProject(JSON.stringify(raw), f.registry),
      f.registry,
      rate,
      { includeMuted: true },
    );
    const native = nativeProvider(f.registry, a);
    assert.equal(timeline.naturalEndFrame, oracle.frames);
    assert.ok(timeline.naturalEndFrame > timeline.bodyFrames);
    const expected = [
      new Float32Array(oracle.frames),
      new Float32Array(oracle.frames),
    ];
    const actual = [
      new Float32Array(oracle.frames),
      new Float32Array(oracle.frames),
    ];
    for (const v of oracle.voices) {
      const e = await native.acquire(v.bankId, v.version, v.sampleId),
        scale = gamelanPlaybackScale(
          f.registry.bank(v.bankId, v.version),
          e.metrics.peak,
        );
      addInstrumentFrames(
        expected,
        e.buffer,
        { ...v, mix: { ...v.mix, volume: v.mix.volume * scale } },
        0,
        rate,
        raw.composition.master.volume,
      );
    }
    for (const v of timeline.placements[0].native.voices) {
      const e = v.event,
        s = await native.acquire(e.bankId, e.version, e.sampleId),
        scale = gamelanPlaybackScale(
          f.registry.bank(e.bankId, e.version),
          s.metrics.peak,
        );
      addInstrumentFrames(
        actual,
        s.buffer,
        {
          startFrame: v.startFrame,
          endFrame: v.endFrame,
          dampFrame: v.dampFrame,
          velocity: e.velocity,
          mix: { volume: e.mix.volume * scale, pan: e.mix.pan },
        },
        0,
        rate,
        e.masterVolume,
      );
    }
    for (let c = 0; c < 2; c++) assert.deepEqual(actual[c], expected[c]);
    assert.ok(
      actual.some((channel) =>
        channel.subarray(timeline.bodyFrames).some((x) => x !== 0),
      ),
    );
    timeline.dispose();
    a.dispose();
    assert.equal(memory.snapshot().bytes, 0);
  });
