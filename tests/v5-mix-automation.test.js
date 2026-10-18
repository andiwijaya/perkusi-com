import test from "node:test";
import assert from "node:assert/strict";
import { LoopStationSession } from "../src/loop-station/session.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";

// Independent event-list interpreter. Getter deliberately lies/throws, like
// the native initialization/reset cases; it is never an automation oracle.
class Param {
  constructor(initial, throws = false) {
    this.intrinsic = initial;
    this.defaultValue = initial;
    this.throws = throws;
    this.events = [];
    this.reads = 0;
  }
  get value() {
    this.reads++;
    if (this.throws) throw Error("AudioParam getter is not authoritative");
    return this.defaultValue;
  }
  set value(value) {
    this.intrinsic = value;
  }
  setValueAtTime(value, time) {
    this.events.push({ kind: "set", value, time });
    this.events.sort((a, b) => a.time - b.time);
  }
  linearRampToValueAtTime(value, time) {
    this.events.push({ kind: "ramp", value, time });
    this.events.sort((a, b) => a.time - b.time);
  }
  cancelScheduledValues(time) {
    this.events = this.events.filter((e) => e.time < time);
  }
  at(time) {
    let prior = { time: 0, value: this.intrinsic };
    for (const e of this.events) {
      if (e.time > time) {
        if (e.kind === "set") return prior.value;
        return (
          prior.value +
          ((e.value - prior.value) * (time - prior.time)) /
            (e.time - prior.time)
        );
      }
      prior = e;
    }
    return prior.value;
  }
}
class Node {
  constructor(context, throws) {
    this.context = context;
    this.gain = new Param(1, throws);
    this.pan = new Param(0, throws);
  }
  connect() {}
  disconnect() {}
}
class Context extends EventTarget {
  state = "running";
  sampleRate = 48000;
  currentTime = 0;
  createGain() {
    return new Node(this, this.throws);
  }
  createStereoPanner() {
    return new Node(this, this.throws);
  }
}
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
function fixture(throws = false) {
  const c = new Context(),
    memory = new AudioMemory();
  c.throws = throws;
  const s = new LoopStationSession({
    context: c,
    wallNow: () => c.wall ?? c.currentTime * 1000,
    transport: new Transport(),
    memory,
    output: c.createGain(),
  });
  s.project = {
    format: "perkusi-project",
    schemaVersion: 5,
    mode: "loop-station",
    title: "Mixer test",
    timing: { bpm: 173, meter: [4, 4] },
    clock: { kind: "fixed-bar", framesPerBar: 66590, sampleRate: 48000 },
    origins: [],
    assetRefs: [],
    master: { volume: 0.5 },
    tracks: [
      {
        id: "one",
        kind: "event",
        gain: 0.5,
        pan: -1,
        mute: false,
        solo: false,
        clips: [],
      },
      {
        id: "two",
        kind: "event",
        gain: 0.125,
        pan: 0,
        mute: false,
        solo: false,
        clips: [],
      },
    ],
  };
  s.graph();
  const parameters = [
    s.graphs.get("one").gain.gain,
    s.graphs.get("one").pan.pan,
    s.master.gain,
  ];
  return {
    c,
    s,
    memory,
    parameters,
    change(time, values, extra = {}) {
      c.currentTime = time;
      const p = structuredClone(s.project);
      [p.tracks[0].gain, p.tracks[0].pan, p.master.volume] = values;
      Object.assign(p.tracks[0], extra);
      s.mixAutomation.apply(p, s.graphs, s.master, time);
      s.project = p;
    },
    at(time) {
      return parameters.map((p) => p.at(time));
    },
    async close() {
      await s.dispose();
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
}
const ramp = (from, to, u) => from.map((v, i) => v + (to[i] - v) * u);
function vector(actual, expected) {
  actual.forEach((v, i) => near(v, expected[i]));
}

test("graph initialization seeds intrinsic and scheduled values without querying unreliable getters", async () => {
  const f = fixture(true);
  try {
    vector(f.at(0), [0.5, -1, 0.5]);
    assert.deepEqual(
      f.parameters.map((p) => p.intrinsic),
      [0.5, -1, 0.5],
    );
    assert.deepEqual(
      f.parameters.map((p) => p.reads),
      [0, 0, 0],
    );
  } finally {
    await f.close();
  }
});
test("original time-zero gain/pan/master transition follows old values, not defaults", async () => {
  const f = fixture();
  try {
    f.change(0, [0.25, 1, 1]);
    for (let frame = 0; frame < 1536; frame++)
      vector(
        f.at(frame / 48000),
        ramp([0.5, -1, 0.5], [0.25, 1, 1], Math.min(frame / 960, 1)),
      );
    assert.deepEqual(
      f.parameters.map((p) => p.reads),
      [0, 0, 0],
    );
  } finally {
    await f.close();
  }
});
test("source .9 transition stays inside .9 absolute-channel envelope in the independent timeline", async () => {
  const f = fixture();
  try {
    f.change(0, [0.25, 1, 1]);
    for (let frame = 0; frame < 1536; frame++) {
      const [g, p, m] = f.at(frame / 48000),
        x = ((p <= 0 ? p + 1 : p) * Math.PI) / 2;
      const output =
        p <= 0
          ? [0.9 * g * m * (1 + Math.cos(x)), 0.9 * g * m * Math.sin(x)]
          : [0.9 * g * m * Math.cos(x), 0.9 * g * m * (1 + Math.sin(x))];
      assert.ok(output.every((v) => Math.abs(v) <= 0.9));
    }
    vector(f.at(0), [0.5, -1, 0.5]);
  } finally {
    await f.close();
  }
});
test("same-quantum replacements retain initial hold and remove superseded future ramps", async () => {
  const f = fixture();
  try {
    f.change(0, [0.25, 1, 1]);
    f.change(0, [0.375, -0.5, 0.75]);
    f.change(0, [0.125, 0, 0.5]);
    for (const t of [0, 0.002, 0.01, 0.02, 0.04])
      vector(
        f.at(t),
        ramp([0.5, -1, 0.5], [0.125, 0, 0.5], Math.min(t / 0.02, 1)),
      );
    assert.ok(
      f.parameters.every(
        (p) => p.events.filter((e) => e.kind === "ramp").length === 1,
      ),
    );
  } finally {
    await f.close();
  }
});
test("mid-ramp replacement holds evaluated values and preserves already scheduled prefix slope", async () => {
  const f = fixture();
  try {
    f.change(0, [0.25, 1, 1]);
    const prefix = Array.from({ length: 241 }, (_, i) => f.at(i / 48000));
    f.change(0.005, [0.375, -1, 0.75]);
    prefix.forEach((v, i) => vector(f.at(i / 48000), v));
    const held = [0.4375, -0.5, 0.625];
    for (const t of [0.005, 0.0075, 0.015, 0.025, 0.04])
      vector(
        f.at(t),
        ramp(held, [0.375, -1, 0.75], Math.min((t - 0.005) / 0.02, 1)),
      );
  } finally {
    await f.close();
  }
});
test("several interrupted ramps preserve every prefix and each held initial value", async () => {
  const f = fixture();
  try {
    f.change(0, [0.25, 1, 1]);
    let from = [0.5, -1, 0.5],
      to = [0.25, 1, 1],
      start = 0;
    for (const [time, target] of [
      [0.005, [0.375, -1, 0.75]],
      [0.009, [0.125, 0.5, 0.25]],
      [0.014, [0.5, 0, 0.5]],
    ]) {
      const prefix = Array.from(
        { length: Math.floor(time * 48000) + 1 },
        (_, i) => f.at(i / 48000),
      );
      const held = ramp(from, to, (time - start) / 0.02);
      f.change(time, target);
      prefix.forEach((v, i) => vector(f.at(i / 48000), v));
      vector(f.at(time), held);
      from = held;
      to = target;
      start = time;
    }
    vector(f.at(0.034), [0.5, 0, 0.5]);
  } finally {
    await f.close();
  }
});
test("replacement at exact endpoint retains the complete preceding ramp", async () => {
  const f = fixture();
  try {
    f.change(0, [0.25, 1, 1]);
    f.change(0.02, [0.5, -1, 0.5]);
    for (const t of [0, 0.005, 0.015, 0.02])
      vector(f.at(t), ramp([0.5, -1, 0.5], [0.25, 1, 1], t / 0.02));
    vector(f.at(0.03), [0.375, 0, 0.75]);
  } finally {
    await f.close();
  }
});
test("delayed first edit preserves initialized mix until the requested time", async () => {
  const f = fixture();
  try {
    f.change(0.005, [0.25, 1, 1]);
    for (const t of [0, 0.001, 0.004, 0.005]) vector(f.at(t), [0.5, -1, 0.5]);
    vector(f.at(0.015), [0.375, 0, 0.75]);
    vector(f.at(0.025), [0.25, 1, 1]);
  } finally {
    await f.close();
  }
});
test("mute and mid-ramp unmute start from audible held gain rather than canonical zero", async () => {
  const f = fixture();
  try {
    f.change(0, [0.5, -1, 0.5], { mute: true });
    near(f.at(0.006)[0], 0.35);
    f.change(0.006, [0.25, -1, 0.5], { mute: false });
    near(f.at(0.006)[0], 0.35);
    near(f.at(0.016)[0], 0.3);
    near(f.at(0.026)[0], 0.25);
  } finally {
    await f.close();
  }
});
test("solo handoff updates both track envelopes from their actual held values", async () => {
  const f = fixture();
  try {
    const p = structuredClone(f.s.project);
    p.tracks[1].solo = true;
    f.s.mixAutomation.apply(p, f.s.graphs, f.s.master, f.c.currentTime);
    f.s.project = p;
    near(f.at(0.006)[0], 0.35);
    const other = f.s.graphs.get("two").gain.gain;
    near(other.at(0.006), 0.125);
    f.c.currentTime = 0.006;
    p.tracks[1].solo = false;
    p.tracks[0].solo = true;
    f.s.mixAutomation.apply(p, f.s.graphs, f.s.master, f.c.currentTime);
    near(f.at(0.006)[0], 0.35);
    near(other.at(0.006), 0.125);
    near(f.at(0.026)[0], 0.5);
    near(other.at(0.026), 0);
  } finally {
    await f.close();
  }
});
test("master-only interrupted replacement retains held project volume and prefix", async () => {
  const f = fixture();
  try {
    f.change(0, [0.5, -1, 1]);
    f.change(0.01, [0.5, -1, 0.25]);
    vector(f.at(0), [0.5, -1, 0.5]);
    near(f.at(0.005)[2], 0.625);
    near(f.at(0.01)[2], 0.75);
    near(f.at(0.02)[2], 0.5);
    near(f.at(0.03)[2], 0.25);
  } finally {
    await f.close();
  }
});
test("released graph does not retain prior segments when recreated with a fresh project", async () => {
  const f = fixture();
  try {
    f.change(0, [0.25, 1, 1]);
    f.c.currentTime = 0.005;
    f.s.releaseGraphs();
    f.s.project = {
      master: { volume: 0.25 },
      tracks: [
        {
          id: "one",
          kind: "event",
          gain: 0.125,
          pan: 0,
          mute: false,
          solo: false,
          clips: [],
        },
      ],
    };
    f.s.graph();
    const g = f.s.graphs.get("one");
    vector(
      [g.gain.gain.at(0.005), g.pan.pan.at(0.005), f.s.master.gain.at(0.005)],
      [0.125, 0, 0.25],
    );
  } finally {
    await f.close();
  }
});

test("several replacements at the same nonzero time preserve the incoming prefix", async () => {
  const f = fixture();
  try {
    f.change(0, [0.25, 1, 1]);
    const prefix = Array.from({ length: 241 }, (_, i) => f.at(i / 48000));
    for (const target of [
      [0.375, -1, 0.75],
      [0.1, 0, 0.25],
      [0.5, 0.5, 1],
    ]) {
      f.change(0.005, target);
      prefix.forEach((values, i) => vector(f.at(i / 48000), values));
      vector(f.at(0.005), [0.4375, -0.5, 0.625]);
    }
    vector(f.at(0.025), [0.5, 0.5, 1]);
  } finally {
    await f.close();
  }
});

test("repeated delayed first edits preserve the constant initial prefix", async () => {
  const f = fixture();
  try {
    for (const target of [
      [0.25, 1, 1],
      [0.375, 0, 0.25],
      [0.125, -0.5, 0.75],
    ]) {
      f.change(0.005, target);
      for (const time of [0, 0.001, 0.004, 0.005])
        vector(f.at(time), [0.5, -1, 0.5]);
    }
    vector(f.at(0.025), [0.125, -0.5, 0.75]);
  } finally {
    await f.close();
  }
});

function preparedFixture() {
  const f = fixture(true);
  f.s.plan = {
    project: f.s.project,
    tracks: f.s.project.tracks,
    clock: { rate: 48000, framesPerTick: 1 },
    trackDocuments: new Map(),
    release() {},
  };
  f.commit = (time, target, program) => {
    f.c.currentTime = time;
    const p = structuredClone(f.s.project);
    [p.tracks[0].gain, p.tracks[0].pan, p.master.volume] = target;
    return f.s.setMix(p, program);
  };
  return f;
}
test("controller publishes one future program for every parameter and holds the old prefix", async () => {
  const f = preparedFixture();
  try {
    f.commit(0, [0.25, 1, 1]);
    const p = f.s.scheduledMix;
    assert.equal(p.startFrame, 2400);
    assert.equal(p.endFrame, 3360);
    assert.equal(p.graceFrame, 3488);
    for (const t of [0, 0.01, 0.049, 0.05]) vector(f.at(t), [0.5, -1, 0.5]);
    vector(f.at(0.06), [0.375, 0, 0.75]);
    vector(f.at(0.07), [0.25, 1, 1]);
    assert.ok(
      f.parameters.every((x) => x.events.at(-1).time === p.endFrame / 48000),
    );
  } finally {
    await f.close();
  }
});
test("controller same-clock replacement coalesces and overlapping future programs preserve prefixes", async () => {
  const f = preparedFixture();
  try {
    f.commit(0, [0.375, 0, 0.75]);
    f.commit(0, [0.25, 1, 1]);
    const prefix = Array.from({ length: 2641 }, (_, i) => f.at(i / 48000));
    f.commit(0.005, [0.375, -1, 0.75]);
    prefix.forEach((v, i) => vector(f.at(i / 48000), v));
    vector(f.at(0.055), [0.4375, -0.5, 0.625]);
    vector(f.at(0.075), [0.375, -1, 0.75]);
    assert.equal(f.s.scheduledMix.startFrame, 2640);
  } finally {
    await f.close();
  }
});
for (const clock of ["audio", "wall"])
  test(`late ${clock} proposal refuses before publication without retiming`, async () => {
    const f = preparedFixture();
    try {
      f.c.wall = 0;
      const p = f.s.prepareMixProgram(),
        before = f.parameters.map((x) => JSON.stringify(x.events));
      if (clock === "wall") f.c.wall = 60;
      assert.throws(
        () => f.commit(clock === "audio" ? 0.051 : 0, [0.25, 1, 1], p),
        { code: "mixProgramLate" },
      );
      assert.deepEqual(
        f.parameters.map((x) => JSON.stringify(x.events)),
        before,
      );
      assert.equal(f.s.scheduledMix.instant, true);
      assert.equal(f.s.mixProgramFault, null);
      f.c.wall = 60;
      f.commit(0.06, [0.25, 1, 1]);
      assert.equal(f.s.scheduledMix.startFrame, 5280);
    } finally {
      await f.close();
    }
  });
test("consumed proposal and backdated primitive each refuse before native mutations", async () => {
  const f = preparedFixture();
  try {
    const p = f.s.prepareMixProgram();
    f.commit(0, [0.25, 1, 1], p);
    const before = f.parameters.map((x) => JSON.stringify(x.events));
    assert.throws(() => f.commit(0, [0.375, 0, 0.75], p), {
      code: "mixProgramLate",
    });
    assert.throws(
      () => f.s.mixAutomation.apply(f.s.project, f.s.graphs, f.s.master, 0.04),
      { code: "mixProgramLate" },
    );
    assert.deepEqual(
      f.parameters.map((x) => JSON.stringify(x.events)),
      before,
    );
  } finally {
    await f.close();
  }
});
test("deadline crossed during native submission becomes a terminal reported scheduling fault", async () => {
  const f = preparedFixture();
  try {
    const native = f.s.master.gain.linearRampToValueAtTime.bind(
      f.s.master.gain,
    );
    f.s.master.gain.linearRampToValueAtTime = (...args) => {
      native(...args);
      f.c.currentTime = 0.051;
    };
    assert.throws(() => f.commit(0, [0.25, 1, 1]), { code: "mixProgramLate" });
    assert.equal(f.s.mixProgramFault.program.startFrame, 2400);
    assert.equal(f.s.status, "error");
    assert.throws(() => f.s.play(), { code: "mixProgramLate" });
    assert.throws(() => f.commit(0.1, [0.375, 0, 0.75]), {
      code: "mixProgramLate",
    });
  } finally {
    await f.close();
  }
});

for (const delayed of [false, true])
  test(`initialization proposal is refused atomically by non-initial setMix${delayed ? " after 100ms" : " immediately"}`, async () => {
    const f = preparedFixture();
    try {
      const proposal = f.s.prepareMixProgram(true),
        before = {
          project: f.s.project,
          program: f.s.scheduledMix,
          sequence: f.s.mixSequence,
          events: f.parameters.map((p) => JSON.stringify(p.events)),
          segments: f.parameters.map((p) => f.s.mixAutomation.segments.get(p)),
        };
      f.c.wall = delayed ? 100 : 0;
      assert.throws(() => f.commit(delayed ? 0.1 : 0, [0.25, 1, 1], proposal), {
        code: "mixProgramLate",
      });
      assert.equal(f.s.project, before.project);
      assert.equal(f.s.scheduledMix, before.program);
      assert.equal(f.s.mixSequence, before.sequence);
      assert.deepEqual(
        f.parameters.map((p) => JSON.stringify(p.events)),
        before.events,
      );
      f.parameters.forEach((p, i) =>
        assert.equal(f.s.mixAutomation.segments.get(p), before.segments[i]),
      );
      assert.equal(f.s.mixProgramFault, null);
      assert.equal(f.s.applyingMix, null);
      f.commit(f.c.currentTime, [0.25, 1, 1]);
      assert.equal(f.s.scheduledMix.instant, false);
      assert.equal(
        f.s.scheduledMix.endFrame - f.s.scheduledMix.startFrame,
        960,
      );
    } finally {
      await f.close();
    }
  });

test("raw session apply refuses mode disagreement and immediate execution outside graph initialization", async () => {
  const f = preparedFixture();
  try {
    const immediate = f.s.prepareMixProgram(true),
      future = f.s.prepareMixProgram(false),
      before = f.parameters.map((p) => JSON.stringify(p.events)),
      sequence = f.s.mixSequence;
    for (const [mode, program] of [
      [false, immediate],
      [true, future],
      [true, immediate],
    ])
      assert.throws(() => f.s.applyMix(f.s.project, mode, program), {
        code: "mixProgramLate",
      });
    for (const mode of [0, 1, null, "false"])
      assert.throws(() => f.s.prepareMixProgram(mode), {
        code: "mixProgramLate",
      });
    assert.deepEqual(
      f.parameters.map((p) => JSON.stringify(p.events)),
      before,
    );
    assert.equal(f.s.mixSequence, sequence);
    assert.equal(f.s.mixProgramFault, null);
    f.s.applyMix(f.s.project, false, future);
    assert.equal(f.s.scheduledMix, future);
  } finally {
    await f.close();
  }
});

test("legitimate graph initialization and recreation publish immediate native events matching metadata", async () => {
  const f = preparedFixture();
  try {
    const old = f.s.prepareMixProgram();
    for (const frame of [0, 4800]) {
      if (frame) {
        f.c.currentTime = frame / 48000;
        f.s.releaseGraphs();
        f.s.graph();
      }
      const p = f.s.scheduledMix;
      assert.equal(p.instant, true);
      assert.equal(p.startFrame, frame);
      assert.equal(p.endFrame, frame);
      assert.equal(p.graceFrame, frame + 128);
      for (const g of [...f.s.graphs.values(), { gain: f.s.master }])
        for (const param of [g.gain.gain, ...(g.pan ? [g.pan.pan] : [])]) {
          const segment = f.s.mixAutomation.segments.get(param);
          assert.equal(segment.start, frame / 48000);
          assert.equal(segment.end, frame / 48000);
          assert.equal(segment.from, segment.to);
          assert.ok(
            param.events.every(
              (e) => e.kind === "set" && e.time === frame / 48000,
            ),
          );
          assert.equal(param.reads, 0);
        }
    }
    assert.throws(() => f.s.applyMix(f.s.project, false, old), {
      code: "mixProgramLate",
    });
    assert.throws(() => f.s.applyMix(f.s.project, true), {
      code: "mixProgramLate",
    });
    f.commit(0.1, [0.25, 1, 1]);
    assert.equal(f.s.scheduledMix.startFrame, 7200);
  } finally {
    await f.close();
  }
});

test("failed graph initialization drops its private permission and permits a clean legitimate retry", async () => {
  const f = preparedFixture();
  try {
    f.s.releaseGraphs();
    const apply = f.s.mixAutomation.apply;
    f.s.mixAutomation.apply = () => {
      throw Error("native construction failure");
    };
    assert.throws(() => f.s.graph(), /native construction failure/);
    assert.equal(f.s.master, null);
    assert.equal(f.s.graphs.size, 0);
    assert.equal(f.s.mixProgramFault, null);
    f.s.mixAutomation.apply = apply;
    assert.throws(() => f.s.applyMix(f.s.project, true), {
      code: "mixProgramLate",
    });
    f.s.graph();
    assert.equal(f.s.scheduledMix.instant, true);
    f.commit(0, [0.25, 1, 1]);
    assert.equal(f.s.scheduledMix.instant, false);
  } finally {
    await f.close();
  }
});
