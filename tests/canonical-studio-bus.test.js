import test from "node:test";
import assert from "node:assert/strict";
import { createCanonicalStudioBus } from "../src/audio/canonical-studio-bus.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import {
  programmeSample,
  PROGRAMME_OUTPUT_BYTES,
} from "../src/audio/programme-output.js";
function fixture({ failCurve = false } = {}) {
  const nodes = [],
    context = {
      currentTime: 7,
      createGain: () => node("gain"),
      createWaveShaper: () => {
        if (failCurve) throw Error("curve unavailable");
        return node("ceiling");
      },
    };
  function node(kind) {
    const n = {
      kind,
      context,
      connections: [],
      disconnected: false,
      gain: {
        value: 0,
        setValueAtTime(value, at) {
          this.value = value;
          this.at = at;
        },
      },
      connect(other) {
        this.connections.push(other);
      },
      disconnect() {
        this.disconnected = true;
        this.connections.length = 0;
      },
    };
    nodes.push(n);
    return n;
  }
  const destination = node("destination"),
    memory = new AudioMemory();
  return { context, destination, memory, nodes };
}
test("every job shares one unchanged programme gain/ceiling after the sum; gain is fixed while any job lives", () => {
  const f = fixture(),
    foreign = f.memory.reserve(313, "foreign"),
    bus = createCanonicalStudioBus(f.context, f.memory, f.destination);
  bus.configure(9.785368393493233);
  const a = bus.acquire(),
    b = bus.acquire();
  assert.deepEqual(bus.snapshot(), {
    activeJobs: 2,
    gain: 9.785368393493233,
    outputStages: 1,
    closed: false,
    masterLimiter: false,
  });
  assert.equal(f.nodes.filter((n) => n.kind === "ceiling").length, 1);
  const ceiling = f.nodes.find((n) => n.kind === "ceiling"),
    gain = bus.input.connections[0];
  assert.equal(gain.connections[0], ceiling);
  assert.equal(ceiling.connections[0], f.destination);
  assert.equal(ceiling.curve.length, 65537);
  assert.equal(ceiling.oversample, "none");
  assert.throws(
    () => bus.configure(2),
    (e) => e.code === "canonicalOutputBusy",
  );
  bus.configure(9.785368393493233);
  assert.throws(
    () => bus.dispose(),
    (e) => e.code === "canonicalOutputStillOwned",
  );
  a();
  a();
  assert.equal(bus.snapshot().activeJobs, 1);
  b();
  bus.configure(2);
  bus.dispose();
  bus.dispose();
  assert.equal(f.memory.snapshot().bytes, 313);
  assert.equal(bus.snapshot().closed, true);
  foreign.release();
});
test("enabled master is one owned exact-kernel stage after the shared sum and before unchanged programme safety; policy cannot drift", () => {
  const f = fixture(),
    foreign = f.memory.reserve(313, "foreign"),
    limiter = { version: 1, bypass: false, kind: "soft-knee-v1" },
    bus = createCanonicalStudioBus(f.context, f.memory, f.destination, {
      limiter,
      createMaster(memory) {
        const held = memory.reserve(16384, "test/master-worklet"),
          node = f.context.createGain();
        return {
          input: node,
          output: node,
          dispose() {
            node.disconnect();
            held.release();
          },
        };
      },
    });
  bus.configure(3, limiter);
  const release = bus.acquire();
  const master = bus.input.connections[0],
    programmeGain = master.connections[0],
    safety = programmeGain.connections[0];
  assert.equal(safety.kind, "ceiling");
  assert.equal(f.nodes.filter((n) => n.kind === "ceiling").length, 1);
  assert.equal(safety.connections[0], f.destination);
  assert.equal(bus.snapshot().masterLimiter, true);
  assert.throws(
    () => bus.configure(3, { ...limiter, bypass: true }),
    (e) => e.code === "canonicalOutputPolicyMismatch",
  );
  release();
  bus.dispose();
  assert.equal(f.memory.snapshot().bytes, 313);
  foreign.release();
});
test("existing programme curve bounds the actual SUM instead of summing individually calibrated outputs", () => {
  const a = 0.7598987817764282,
    b = 0.6321051716804504;
  assert(a + b > 0.95);
  assert(Math.abs(programmeSample(a + b)) < 0.9);
  for (const value of [-100, -2, -1, -0.85, 0, 0.85, 1, 2, 100])
    assert(Math.abs(programmeSample(value)) < 0.9);
  assert(
    Math.abs(programmeSample(a) - a) < 1e-7,
    "single-programme linear region is unchanged",
  );
});
test("failed shared-stage construction releases its own reservation and never changes a foreign lease", () => {
  const f = fixture({ failCurve: true }),
    foreign = f.memory.reserve(313, "foreign");
  assert.throws(
    () => createCanonicalStudioBus(f.context, f.memory, f.destination),
    /curve unavailable/,
  );
  assert.equal(f.memory.snapshot().bytes, 313);
  foreign.release();
  const g = fixture(),
    lease = g.memory.reserve(64 * 1024 * 1024 - PROGRAMME_OUTPUT_BYTES, "busy");
  assert.throws(
    () => createCanonicalStudioBus(g.context, g.memory, g.destination),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.equal(g.nodes.length, 1);
  lease.release();
  assert.equal(g.memory.snapshot().bytes, 0);
});
