import test from "node:test";
import assert from "node:assert/strict";
import {
  FRAME_PERIOD as P,
  nativeWorkletFrame,
  installWorkletFrameClock,
  frameClockDescriptors,
} from "../src/audio/worklet-frame-clock.js";
import {
  nativeParameters,
  fakeWorkletParams,
} from "./helpers/worklet-frame-clock.js";

test("native frame coordinates preserve every sample across epoch boundaries and long-lived contexts", () => {
  for (const frame of [
    0,
    101,
    P - 13,
    P + 29,
    2 ** 32 + P - 64,
    10000000 * P + 63,
  ])
    for (const size of [1, 64, 128, 192, 16384])
      assert.equal(
        nativeWorkletFrame(nativeParameters(frame, size), size),
        frame,
      );
  assert(frameClockDescriptors().every((d) => d.automationRate === "a-rate"));
});

test("clock validates every native parameter sample and refuses missing, frozen and corrupt timelines", () => {
  for (const parameters of [
    undefined,
    {},
    { frameEpoch: Float32Array.of(0), framePhase: Float32Array.of(0) },
  ])
    assert(Number.isNaN(nativeWorkletFrame(parameters, 128)));
  for (const [key, value] of [
    ["framePhase", NaN],
    ["framePhase", 0.5],
    ["frameEpoch", 1.5],
    ["frameEpoch", -1],
  ]) {
    const p = nativeParameters(1000, 128);
    p[key][64] = value;
    assert(Number.isNaN(nativeWorkletFrame(p, 128)));
  }
  const p = nativeParameters(1000, 128);
  p.framePhase[64] = p.framePhase[63];
  assert(Number.isNaN(nativeWorkletFrame(p, 128)));
  assert.equal(
    nativeWorkletFrame(
      {
        frameEpoch: Float32Array.of(-1),
        framePhase: new Float32Array(128).fill(-1),
      },
      128,
    ),
    null,
  );
});

test("native ramp endpoint and simultaneous epoch reset encode the same exact absolute wrap frame", () => {
  // Actual retained Chromium48k receipt at frame7P: the first sample is
  // epoch6/phaseP, followed by epoch7/phase1..127. Every absolute frame is exact.
  const p = nativeParameters(7 * P, 128);
  p.frameEpoch[0] = 6;
  p.framePhase[0] = P;
  assert.equal(nativeWorkletFrame(p, 128), 7 * P);
  const crossing = nativeParameters(7 * P - 64, 128);
  crossing.frameEpoch[64] = 6;
  crossing.framePhase[64] = P;
  assert.equal(nativeWorkletFrame(crossing, 128), 7 * P - 64);
  for (const value of [P + 1, P - 1, P - 0.25]) {
    const wrong = nativeParameters(7 * P, 128);
    wrong.frameEpoch[0] = 6;
    wrong.framePhase[0] = value;
    assert(Number.isNaN(nativeWorkletFrame(wrong, 128)));
  }
  const frozen = nativeParameters(7 * P, 128);
  frozen.frameEpoch.fill(6);
  frozen.framePhase.fill(P);
  assert(Number.isNaN(nativeWorkletFrame(frozen, 128)));
});

test("host schedules a future absolute anchor and exact phase wrap without past-event clamp or unbounded events", () => {
  const context = {
      sampleRate: 48000,
      currentTime: (P - 10000) / 48000,
      state: "running",
    },
    node = { parameters: fakeWorkletParams() },
    start = P - 512;
  const owner = installWorkletFrameClock(node, context, start, P + 512);
  try {
    const epoch = node.parameters.get("frameEpoch").events,
      phase = node.parameters.get("framePhase").events;
    assert.deepEqual(epoch[0], ["set", 0, start / 48000]);
    assert.deepEqual(phase[0], ["set", start, start / 48000]);
    assert.deepEqual(phase.slice(1, 3), [
      ["ramp", P, P / 48000],
      ["set", 0, P / 48000],
    ]);
    assert.deepEqual(epoch[1], ["set", 1, P / 48000]);
    assert(phase.length <= 9 && epoch.length <= 5);
    assert.equal(owner.fault, null);
  } finally {
    owner.dispose();
    owner.dispose();
  }
  context.currentTime = start / 48000;
  assert.throws(
    () => installWorkletFrameClock(node, context, start),
    /workletClockStartMissed/,
  );
});

test("a missed rolling horizon is terminal and cannot clamp past events into a silently rebased clock", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const context = { sampleRate: 48000, currentTime: 0, state: "running" },
    node = { parameters: fakeWorkletParams() },
    owner = installWorkletFrameClock(node, context, 4800),
    before = structuredClone(
      [...node.parameters].map(([name, p]) => [name, p.events]),
    );
  try {
    context.currentTime = (5 * P) / 48000;
    t.mock.timers.tick((P / 48000) * 500 + 1);
    assert.equal(owner.fault?.message, "workletClockHorizonMissed");
    assert.deepEqual(
      [...node.parameters].map(([name, p]) => [name, p.events]),
      before,
    );
  } finally {
    owner.dispose();
  }
});

for (const contract of ["rolling-horizon", "start-anchor"])
  test(`${contract} rejects equality in the scheduled seconds representation, including inverse-rounding coordinates`, (t) => {
    let callback;
    t.mock.method(globalThis, "setInterval", (fn) => {
      callback = fn;
      return { unref() {} };
    });
    t.mock.method(globalThis, "clearInterval", () => {});
    for (const [rate, epoch] of [
      [48000, 49],
      [48000, 51],
      [44100, 15],
    ])
      for (const offset of [-128, 0, 128]) {
        const horizon = epoch * P,
          anchor = horizon - 4 * P + 128,
          context = {
            sampleRate: rate,
            currentTime:
              contract === "start-anchor"
                ? (horizon + offset) / rate
                : (anchor - 128) / rate,
            state: "running",
          },
          parameters = fakeWorkletParams(),
          snapshot = () =>
            structuredClone([...parameters].map(([k, p]) => [k, p.events]));
        let owner;
        try {
          if (contract === "start-anchor" && offset >= 0) {
            assert.throws(
              () => installWorkletFrameClock({ parameters }, context, horizon),
              /workletClockStartMissed/,
              `${rate}/${epoch}/${offset}`,
            );
            assert(snapshot().every(([, events]) => events.length === 0));
            continue;
          }
          owner = installWorkletFrameClock(
            { parameters },
            context,
            contract === "start-anchor" ? horizon : anchor,
          );
          if (contract === "start-anchor") {
            assert.equal(owner.fault, null);
            continue;
          }
          const before = snapshot();
          context.currentTime = (horizon + offset) / rate;
          callback();
          if (offset >= 0) {
            assert.equal(
              owner.fault?.message,
              "workletClockHorizonMissed",
              `${rate}/${epoch}/${offset}`,
            );
            assert.deepEqual(snapshot(), before);
          } else {
            assert.equal(owner.fault, null);
            assert.notDeepEqual(snapshot(), before);
          }
        } finally {
          owner?.dispose();
        }
      }
  });

test("installation that reaches its anchor while scheduling still refuses publication at the exact observable deadline", () => {
  for (const [rate, epoch] of [
    [48000, 49],
    [44100, 15],
  ]) {
    const anchor = epoch * P,
      context = {
        sampleRate: rate,
        currentTime: (anchor - 128) / rate,
        state: "running",
      },
      parameters = fakeWorkletParams(),
      epochParam = parameters.get("frameEpoch"),
      set = epochParam.setValueAtTime;
    epochParam.setValueAtTime = function (...args) {
      set.apply(this, args);
      context.currentTime = anchor / rate;
    };
    assert.throws(
      () => installWorkletFrameClock({ parameters }, context, anchor),
      /workletClockStartMissed/,
    );
  }
});

test("a suspended context keeps its coordinate and future schedule; resume appends only future events without rebasing", (t) => {
  let callback;
  t.mock.method(globalThis, "setInterval", (fn) => {
    callback = fn;
    return { unref() {} };
  });
  t.mock.method(globalThis, "clearInterval", () => {});
  const horizon = 49 * P,
    anchor = horizon - 4 * P + 128,
    context = {
      sampleRate: 48000,
      currentTime: (anchor - 128) / 48000,
      state: "suspended",
    },
    parameters = fakeWorkletParams(),
    owner = installWorkletFrameClock({ parameters }, context, anchor),
    before = structuredClone([...parameters].map(([k, p]) => [k, p.events]));
  try {
    for (let i = 0; i < 100; i++) callback();
    assert.equal(owner.fault, null);
    assert.deepEqual(
      [...parameters].map(([k, p]) => [k, p.events]),
      before,
    );
    context.state = "running";
    context.currentTime = (horizon - 128) / 48000;
    callback();
    assert.equal(owner.fault, null);
    let added = 0;
    for (const [k, events] of before)
      for (const event of parameters.get(k).events.slice(events.length)) {
        added++;
        assert(event[2] > context.currentTime);
      }
    assert(added > 0);
    const after = structuredClone(
      [...parameters].map(([k, p]) => [k, p.events]),
    );
    owner.dispose();
    context.currentTime = (horizon + 128) / 48000;
    callback();
    assert.deepEqual(
      [...parameters].map(([k, p]) => [k, p.events]),
      after,
    );
  } finally {
    owner.dispose();
  }
});
