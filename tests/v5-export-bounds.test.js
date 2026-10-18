import test from "node:test";
import assert from "node:assert/strict";
import {
  SourceWindows,
  SOURCE_WINDOW_COUNT,
} from "../src/loop-station/source-windows.js";
import { encodeStreamWav } from "../src/loop-station/stream-wav.js";
import { encodeFinalWav } from "../src/loop-station/final-wav.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { programmeSample } from "../src/audio/programme-output.js";
import { renderPortableMix } from "../src/loop-station/portable-mix.js";

test("bounded source windows preserve every portable mix frame with loop phase, overlap, damping, stereo pan and EQ", async () => {
  for (const rate of [44100, 48000]) {
    const channels = [0, 1].map((c) =>
        Float32Array.from(
          { length: 5003 },
          (_, i) => 0.01 * Math.sin(i / 37 + c),
        ),
      ),
      source = {
        length: 5003,
        numberOfChannels: 2,
        getChannelData: (c) => channels[c],
        copyFromChannel(out, c, from) {
          out.set(channels[c].subarray(from, from + out.length));
        },
      },
      project = {
        master: {
          volume: 1,
          limiter: { version: 1, kind: "soft", bypass: true },
        },
        tracks: [
          {
            id: "t",
            gain: 0.7,
            pan: 0.25,
            eq: { version: 1, bypass: false, lowDb: 3, midDb: -2, highDb: 1 },
          },
        ],
      },
      program = {
        rate,
        frames: 7007,
        events: Array.from({ length: 16 }, (_, i) => ({
          trackId: "t",
          spec: {
            buffer: source,
            startFrame: i * 5,
            endFrame: 6500,
            dampFrame: 4500 + i,
            velocity: 0.5,
            scale: 4,
            pan: i % 2 ? 0.2 : -0.2,
            loopFrames: 2003,
            phaseOffsetFrames: i * 17,
          },
        })),
      };
    const context = {
      createBuffer(C, F, R) {
        const cs = Array.from({ length: C }, () => new Float32Array(F));
        return { length: F, sampleRate: R, getChannelData: (c) => cs[c] };
      },
    };
    const full = await renderPortableMix(context, project, program, {
        yieldTask: async () => {},
      }),
      out = Array.from({ length: 4 }, () => []);
    source.getChannelData = () => {
      throw Error("Unbounded view forbidden");
    };
    await renderPortableMix(context, project, program, {
      analysisOnly: true,
      boundedSourceViews: true,
      onChunk: (cs) => cs.forEach((c, i) => out[i].push(...c)),
      yieldTask: async () => {},
    });
    for (let c = 0; c < 4; c++)
      assert.deepEqual(Float32Array.from(out[c]), full.getChannelData(c));
  }
});

test("source windows recycle32 physical buffers across long-source offsets without full channel views", () => {
  const reader = new SourceWindows(),
    physical = new Set();
  let copies = 0;
  const buffers = Array.from({ length: 40 }, (_, b) => ({
    length: 5003,
    numberOfChannels: 2,
    getChannelData() {
      throw Error("Full view forbidden");
    },
    copyFromChannel(out, c, from) {
      copies++;
      for (let i = 0; i < out.length && from + i < this.length; i++)
        out[i] = Math.fround((b + c + (from + i) / 5003) / 100);
    },
  }));
  for (let cycle = 0; cycle < 3; cycle++)
    for (const [b, buffer] of buffers.entries())
      for (const frame of [0, 2047, 2048, 4096, 5002])
        for (let c = 0; c < 2; c++) {
          assert.equal(
            reader.read(buffer, c, frame),
            Math.fround((b + c + frame / 5003) / 100),
          );
          for (const row of reader.recent.keys()) physical.add(row.data);
          assert(reader.recent.size <= SOURCE_WINDOW_COUNT);
        }
  assert.equal(physical.size, 32);
  assert(copies > 32);
});

test("streamed Float32 WAV matches full writer including signed samples, complete tail and attribution", async () => {
  const memory = new AudioMemory(),
    frames = 5003,
    channels = [0, 1].map((c) =>
      Float32Array.from({ length: frames }, (_, i) =>
        i < 4900 ? Math.sin(i / 71 + c) * 0.4 : 0,
      ),
    ),
    meta = { credits: "Provenance — sumber asli", render: { frames } },
    buffer = {
      length: frames,
      sampleRate: 44100,
      getChannelData: (c) => channels[c],
    };
  const expected = await encodeFinalWav(buffer, meta, {
    memory,
    yieldTask: async () => {},
  });
  let released = false;
  const streamed = await encodeStreamWav({ frames, sampleRate: 44100 }, meta, {
    memory,
    beforeAssemble: () => {
      released = true;
    },
    produce: async (write) => {
      for (let i = 0; i < frames; i += 2048)
        write(
          channels[0].subarray(i, i + 2048),
          channels[1].subarray(i, i + 2048),
        );
    },
  });
  assert(released);
  assert.deepEqual(
    new Uint8Array(await streamed.blob.arrayBuffer()),
    new Uint8Array(await expected.blob.arrayBuffer()),
  );
  streamed.release();
  streamed.release();
  expected.release();
  assert.equal(memory.snapshot().bytes, 0);
});

test("stream cancellation, incomplete output, unsafe data and assembly denial release their own leases", async () => {
  for (const kind of ["cancel", "incomplete", "unsafe", "assembly"]) {
    const memory = new AudioMemory(),
      foreign = memory.reserve(1024, "preserved foreign owner"),
      abort = new AbortController();
    await assert.rejects(
      encodeStreamWav(
        { frames: 2049, sampleRate: 48000 },
        {},
        {
          memory,
          signal: abort.signal,
          produce: async (write) => {
            write(
              new Float32Array(2048).fill(kind === "unsafe" ? 1 : 0.1),
              new Float32Array(2048),
            );
            if (kind === "cancel") abort.abort();
            if (kind !== "incomplete")
              write(new Float32Array(1), new Float32Array(1));
          },
          beforeAssemble: () => {
            if (kind === "assembly") throw Error("assembly denied");
          },
        },
      ),
    );
    assert.equal(memory.snapshot().bytes, 1024);
    foreign.release();
    assert.equal(memory.snapshot().bytes, 0);
  }
});

test("shared programme protection is linear at nominal peaks, smooth and signed at upper-master peaks", () => {
  for (const v of [0, 0.2, 0.82, -0.82])
    assert.equal(programmeSample(v), Math.fround(v));
  assert(Math.abs(programmeSample((0.82 * 0.75) / 0.65) - 0.89269) < 0.00001);
  let prior = 0;
  for (let i = 0; i <= 2000; i++) {
    const x = i / 1000,
      y = programmeSample(x);
    assert(y >= prior);
    assert(y < 0.9);
    assert(Math.abs(y + programmeSample(-x)) < 1e-7);
    prior = y;
  }
  assert.throws(() => programmeSample(NaN));
});
