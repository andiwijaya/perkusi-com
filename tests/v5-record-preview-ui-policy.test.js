import test from "node:test";
import assert from "node:assert/strict";
import { SelectedRecorder } from "../src/loop-station/selected-recorder.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
import { recordCopy } from "../src/loop-station/record-copy.js";
import { RECORD_INSTRUMENTS } from "../src/loop-station/record-sources.js";
test("partial stays partial under a root fault and retains cause/ACK position for the view", () => {
  const r = Object.create(SelectedRecorder.prototype),
    outcome = {
      reason: "suspended",
      frames: 127,
      acknowledgedEndFrame: 1127,
      terminalCause: { code: "contextSuspended" },
    };
  Object.assign(r, {
    owner: {
      lastFault: "contextSuspended",
      engine: { context: { sampleRate: 48000, currentTime: 1 } },
      producers: new Map(),
      playbacks: new Set(),
      capture: { retained: new Map([["take", {}]]) },
    },
    current: {
      state: "closed",
      plan: { startFrame: 1000, framesPerBar: 120000 },
      take: { id: "take", partial: true, frames: 127 },
      outcome,
    },
    takes: { saved: new Map(), snapshot: () => [] },
    source: null,
  });
  assert.equal(r.snapshot().state, "partial");
  assert.equal(r.snapshot().outcome, outcome);
  assert.equal(r.snapshot().pendingTake, true);
});
test("recovered owner cannot detach running or held state; explicit closed disposition permits a fresh attachment", () => {
  const memory = new AudioMemory(),
    owner = new WorkspaceAudioOwner({ memory, getProject: () => null }),
    transport = new Transport(),
    context = { state: "running" },
    master = {},
    engine = { context, transport, master },
    controller = {
      memory,
      transport,
      output: master,
      disposed: true,
      snapshot: () => ({ finiteCaptureBridge: false }),
    };
  owner.attach(engine, controller);
  assert.throws(() => owner.detachClosed(), { code: "recordBusy" });
  context.state = "closed";
  const pin = memory.reserve(128, "foreign"),
    claim = {};
  owner.claims.add(claim);
  assert.throws(() => owner.detachClosed(), { code: "recordBusy" });
  owner.claims.clear();
  owner.detachClosed();
  assert.equal(owner.engine, null);
  assert.equal(memory.snapshot().bytes, 128);
  pin.release();
  const next = {
    ...engine,
    context: { state: "running" },
    transport: new Transport(),
  };
  owner.attach(next, { ...controller, transport: next.transport });
  assert.equal(owner.engine, next);
});
test("record preview and interruption copy has exact ID/EN key parity", () => {
  assert.deepEqual(
    Object.keys(recordCopy.id).sort(),
    Object.keys(recordCopy.en).sort(),
  );
  assert.deepEqual(
    Object.keys(recordCopy.id.errors).sort(),
    Object.keys(recordCopy.en.errors).sort(),
  );
});

test("approved V5 suling deferral stays unavailable in the rack and both languages without promising a later version", () => {
  assert(!RECORD_INSTRUMENTS.includes("suling"));
  assert(!RECORD_INSTRUMENTS.some((id) => id.includes("suling")));
  assert.match(recordCopy.id.sulingPending, /ditunda.*V5.*belum tersedia/);
  assert.match(recordCopy.en.sulingPending, /deferred.*V5.*not available/);
  assert.doesNotMatch(
    recordCopy.id.sulingPending + recordCopy.en.sulingPending,
    /V[6-9]/,
  );
});
