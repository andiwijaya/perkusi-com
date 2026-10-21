import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { canonicalRegisteredAssets } from "../src/audio/canonical-registered-assets.js";
import {
  prepareCanonicalCaptureBacking,
  captureBackingCommand,
} from "../src/studio/canonical-capture-backing.js";
import { newRecordingProject } from "../src/loop-station/model.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { adoptRecording, digest } from "../src/loop-station/recording-data.js";
import { exportAudioBundle } from "../src/loop-station/audio-bundle.js";
import { importCanonicalFile } from "../src/project/canonical-package.js";
import { qaBuffer } from "./helpers/canonical-score-fixtures.js";
import { PPQ } from "../src/project/instrument-project.js";
const registry = canonicalRegisteredAssets(48000, (d) => "/" + d.path).registry;
async function fixture(memory) {
  const p = structuredClone(newRecordingProject(registry));
  p.timing.bpm = 120;
  p.clock = { kind: "fixed-bar", sampleRate: 48000, framesPerBar: 96000 };
  const pool = new TakePool(memory),
    n = 96000,
    cs = [0, 1].map((c) =>
      Float32Array.from({ length: n }, (_, f) =>
        f === 0 ? -0 : 0.03 * Math.sin(f / (c ? 37 : 23)),
      ),
    ),
    take = pool.adopt(
      pool.reserve({ capacity: n, channels: 2, sampleRate: 48000 }),
      {
        capacity: n,
        frames: n,
        channels: 2,
        sampleRate: 48000,
        startFrame: 0,
        reason: "complete",
      },
      cs.map((c) => c.buffer),
    ),
    copy = pool.copyPCM(take.id),
    adopted = adoptRecording(
      p,
      registry,
      "track-1",
      take,
      await digest(copy.buffer),
    ),
    packed = await exportAudioBundle(
      adopted.project,
      new Map([
        [
          adopted.ref.id,
          {
            blob: new Blob([copy.buffer]),
            provenance: "Synthetic backing contract test; no physical input",
          },
        ],
      ]),
      { registry, memory },
    );
  copy.release();
  pool.release(take.id);
  try {
    return await importCanonicalFile(packed.blob, { registry, memory });
  } finally {
    packed.release();
  }
}
function context() {
  const calls = [],
    ctx = {
      sampleRate: 48000,
      currentTime: 0,
      state: "running",
      createBuffer: qaBuffer,
    },
    param = () => ({
      value: 1,
      cancelScheduledValues() {},
      setValueAtTime() {},
      linearRampToValueAtTime() {},
    }),
    node = () => ({ context: ctx, connect() {}, disconnect() {} });
  ctx.createGain = () => ({ ...node(), gain: param() });
  ctx.createBufferSource = () => {
    const n = {
      ...node(),
      playbackRate: param(),
      buffer: null,
      start(at) {
        calls.push({ type: "start", at, buffer: this.buffer });
      },
      stop(at) {
        calls.push({ type: "stop", at });
      },
    };
    ctx.source = n;
    return n;
  };
  return { ctx, calls };
}
test("complete recorded backing retains original bytes, native clock, unity output, full tail and ownership until actual end/close", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    bundle = await fixture(memory),
    original = structuredClone(bundle.project),
    raw = await bundle.entries
      .get(bundle.project.assets[0].id)
      .blob.arrayBuffer(),
    { ctx, calls } = context();
  let backing;
  try {
    backing = await prepareCanonicalCaptureBacking({
      bundle,
      context: ctx,
      memory,
      clock: bundle.project.timing.clock,
      bars: 4,
      resolveUrl: (d) => "/" + d.path,
      fetcher: () => {
        throw Error(
          "No registered assets required by this recorded-only programme",
        );
      },
    });
    assert(backing.peak > 0);
    assert(backing.peak <= 0.95);
    assert.equal(backing.voices, 1);
    assert.equal(calls.length, 0);
    assert.deepEqual(bundle.project, original);
    assert.deepEqual(
      await bundle.entries.get(bundle.project.assets[0].id).blob.arrayBuffer(),
      raw,
    );
    assert.equal(backing.snapshot().bodyFrames, 4 * 96000);
    assert.equal(backing.snapshot().frames, backing.snapshot().bodyFrames);
    backing.start(4800, { context: ctx });
    assert.equal(calls[0].at, 0.1);
    assert.equal(calls[0].buffer.sampleRate, 48000);
    assert.equal(ctx.source.playbackRate.value, 1);
    assert(calls[0].buffer.getChannelData(0).some((x) => x !== 0));
    assert.throws(
      () => backing.dispose(),
      (e) => e.code === "canonicalVoiceStillOwned",
    );
    const stop = backing.stop();
    assert.throws(
      () => backing.dispose(),
      (e) => e.code === "canonicalVoiceStillOwned",
    );
    ctx.source.onended();
    await stop;
    backing.dispose();
    backing.dispose();
  } finally {
    ctx.state = "closed";
    backing?.dispose();
    bundle.dispose();
  }
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});
test("capture repeat command preserves all chain occurrences and refuses an excessive expansion", () => {
  const p = {
    transport: { kind: "chain" },
    sections: [{ id: "a", lengthTicks: 4 * PPQ }],
    chain: [{ sectionId: "a", repeats: 1 }],
    activeSection: "a",
  };
  assert.deepEqual(captureBackingCommand(p, 8), {
    kind: "repeat",
    bars: null,
    cycles: 8,
  });
  p.sections[0].lengthTicks = PPQ;
  assert.throws(
    () => captureBackingCommand(p, 8),
    (e) => e.code === "arrangementExpansionLimit",
  );
  p.transport.kind = "legacy-continuous";
  assert.deepEqual(captureBackingCommand(p, 8), {
    kind: "window",
    bars: 8,
    cycles: 1,
  });
});
