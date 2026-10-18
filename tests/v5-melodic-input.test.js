import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  createLiveInstrumentInput,
  activateInstrumentMonitor,
} from "../src/loop-station/instrument-input.js";
import {
  melodicBanks,
  isMelodicAssignment,
  melodicManifest,
  melodicAttribution,
} from "../src/loop-station/melodic-sources.js";
import {
  liveAssignment,
  SessionTakes,
} from "../src/loop-station/session-takes.js";
import { recordSource } from "../src/loop-station/record-sources.js";
import { gamelanWavAttribution } from "../src/gamelan/attribution.js";
const parameter = () => ({
  value: 1,
  events: [],
  setValueAtTime(v, t) {
    this.events.push(["set", v, t]);
  },
  linearRampToValueAtTime(v, t) {
    this.events.push(["ramp", v, t]);
  },
  cancelScheduledValues(t) {
    this.events.push(["cancel", t]);
  },
});
class NativeNode {
  constructor(context) {
    this.context = context;
    this.gain = parameter();
    this.offset = parameter();
    this.playbackRate = parameter();
    this.stops = [];
  }
  connect(to) {
    this.connected = to;
  }
  disconnect() {}
  start(t) {
    this.when = t;
  }
  stop(t) {
    this.stops.push(t);
  }
  end() {
    this.onended?.();
  }
}
class Context extends EventTarget {
  sampleRate = 48000;
  currentTime = 0;
  state = "running";
  sources = [];
  createGain() {
    return new NativeNode(this);
  }
  createBufferSource() {
    const n = new NativeNode(this);
    this.sources.push(n);
    return n;
  }
  createConstantSource() {
    return this.createBufferSource();
  }
  async decodeAudioData(raw) {
    const d = new DataView(raw),
      rate = d.getUint32(24, true),
      channels = d.getUint16(22, true),
      length = d.getUint32(40, true) / (channels * 4),
      data = Array.from({ length: channels }, () => new Float32Array(length));
    for (let n = 0; n < length; n++)
      for (let c = 0; c < channels; c++)
        data[c][n] = d.getFloat32(44 + 4 * (n * channels + c), true);
    return {
      length,
      numberOfChannels: channels,
      sampleRate: rate,
      duration: length / rate,
      getChannelData: (c) => data[c],
    };
  }
}
test("melodic sources retain CC0 original/derivative/license identity at both native profiles", async () => {
  for (const rate of [44100, 48000])
    for (const b of melodicBanks(rate))
      for (const s of b.samples) {
        const row = melodicManifest.assets.find(
          (a) => a.sampleId === s.id && a.profileRate === rate,
        );
        assert(row.commercialUse && row.rawRedistribution);
        assert.equal(row.license, "CC0-1.0");
        for (const [path, hash] of [
          [row.originalPath, row.originalSHA256],
          ["internal/loop-instruments/" + row.derivative.path, s.sha256],
          [row.licenseEvidencePath, row.licenseEvidenceSHA256],
        ])
          assert.equal(
            createHash("sha256")
              .update(await readFile(path))
              .digest("hex"),
            hash,
          );
      }
});
test("three-note qualification rejects incomplete or mutated descriptors and never calls recordings original synthesis", () => {
  const r = new InstrumentRegistry(melodicBanks());
  for (const b of melodicBanks()) {
    const config = recordSource(b.samples[0].instrumentId),
      a = liveAssignment(
        "track-1",
        r,
        config.bankId,
        config.bankVersion,
        config.sampleIds,
      );
    assert.equal(a.sampleIds.length, 3);
    assert.equal(
      isMelodicAssignment(b.id, b.version, a.sampleIds, b.samples),
      true,
    );
    const changed = structuredClone(b.samples);
    changed[0].gainTrim = 0.5;
    assert.throws(() =>
      isMelodicAssignment(b.id, b.version, a.sampleIds, changed),
    );
    assert.throws(() =>
      liveAssignment("track-1", r, b.id, b.version, a.sampleIds.slice(0, 2)),
    );
    const events = a.sampleIds.map((sampleId) => ({
      action: "strike",
      sampleId,
      bankId: b.id,
    }));
    const credit = gamelanWavAttribution({ events });
    assert.match(credit, /FreePats/);
    assert.match(credit, /original SHA256/);
    assert.doesNotMatch(credit, /original synthesised/);
    assert.equal(melodicAttribution(events), credit);
  }
});
for (const rate of [44100, 48000])
  for (const family of ["electric-bass", "classical-guitar"])
    test(`${family} ${rate}: real asset geometry, release policy and native pins until ended`, async (t) => {
      t.mock.method(
        globalThis,
        "fetch",
        async (path) =>
          new Response(
            await readFile(
              String(path).replace(
                "/sounds/loop-instruments/",
                "internal/loop-instruments/audio/",
              ),
            ),
          ),
      );
      const context = new Context();
      context.sampleRate = rate;
      const memory = new AudioMemory(),
        registry = new InstrumentRegistry(melodicBanks(rate)),
        config = recordSource(family),
        source = await createLiveInstrumentInput({
          context,
          memory,
          registry,
          transport: new Transport(),
          framesPerBar: rate * 2.5,
          ...config,
        });
      activateInstrumentMonitor(source, {
        destination: context.createGain(),
        admitVoice() {},
      });
      const close = async () => {
        const p = source.dispose();
        context.sources.forEach((n) => n.end());
        await p;
        assert.equal(memory.snapshot().bytes, 0);
      };
      t.after(close);
      source.press("A", config.sampleIds[0], { when: 0.1, velocity: 0.5 });
      source.release("A", { when: 0.2 });
      const n = context.sources[1];
      assert(n);
      assert.equal(source.snapshot().voices.length, 1);
      assert(memory.snapshot().bytes > 0);
      assert.equal(
        n.connected.gain.events.find((e) => e[0] === "set")[1],
        0.5 * 0.25 * (family === "classical-guitar" ? 0.5 : 1),
      );
      if (family === "classical-guitar") {
        assert(
          source.peak <= 0.800001,
          "calibrated polyphonic input must retain its absolute headroom budget",
        );
        const actualFullVelocityPeak =
          source.metrics[0].peak *
          n.connected.connected.gain.value *
          0.25 *
          0.5;
        assert(
          actualFullVelocityPeak * 3 <= source.peak + 1e-6,
          "admission must count the actual calibrated native path",
        );
      }
      assert.equal(
        Math.round(n.stops[0] * rate),
        Math.round((0.2 + (family === "electric-bass" ? 0.3 : 1.5)) * rate),
      );
      n.end();
      assert.equal(source.snapshot().voices.length, 0);
      context.currentTime = 1;
      source.press("B", config.sampleIds[1]);
      context.currentTime = 1.15;
      source.release("B");
      const later = context.sources[2];
      assert.equal(
        later.connected.gain.events.find((e) => e[0] === "cancel")[1],
        1.2,
      );
      assert.equal(source.snapshot().voices.length, 1);
      later.end();
      const takeStore = new SessionTakes({
        pool: {},
        controller: { registry },
        captureTrack: "track-1",
        capture: {
          retained: new Map([
            ["partial", { trackId: "track-1", record: { source } }],
          ]),
        },
      });
      const text = takeStore.attribution("partial");
      assert.match(text, /FreePats/);
      assert.match(text, /CC0-1.0/);
      assert.doesNotMatch(text, /no CDM recording referenced/);
    });
