import test from "node:test";
import assert from "node:assert/strict";
import { RecordPanel } from "../src/loop-station/record-panel.js";
import { SelectedRecorder } from "../src/loop-station/selected-recorder.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { AudioMemory } from "../src/audio/audio-memory.js";

test("mic layout extraction preserves full-panel record readiness and pending Stop availability", () => {
  const nodes = new Map(),
    node = (id) => {
      if (!nodes.has(id))
        nodes.set(id, {
          dataset: {},
          textContent: "",
          setAttribute() {},
          querySelectorAll: () => [],
        });
      return nodes.get(id);
    };
  let ready = true;
  const producer = {
      voices: [],
      tokens: [],
      monitoring: "disabled",
      meter: { peak: 0.2, rms: 0.03, clips: 0 },
    },
    owner = {
      boundaries: new Set(),
      savedBlocked: () => false,
      producers: new Map([["track-1", producer]]),
      micInput: { state: "ready" },
      micStatus: "ready",
    },
    recorder = {
      source: { isCurrent: () => ready, channels: 2, sampleRate: 48000 },
      takes: { layers: () => [], tracks: new Set() },
      snapshot: () => ({
        assignment: {
          trackId: "track-1",
          format: "perkusi-mic-assignment",
          sampleIds: [],
        },
        producer: ready ? producer : null,
        state: "ready",
      }),
    },
    panel = Object.assign(Object.create(RecordPanel.prototype), {
      element: { isConnected: true, dataset: {} },
      $: node,
      instrumentId: "microphone",
      owner,
      locale: () => "id",
      selected: () => "track-1",
      recorder: () => recorder,
      project: () => ({ tracks: [{ id: "track-1", clips: [] }] }),
      busy: () => false,
      playable: () => false,
      canPreview: () => false,
      listSignature: "[]",
      pending: false,
    });
  panel.update();
  assert.equal(
    node("record").disabled,
    false,
    "ready microphone can still record through full update",
  );
  assert.equal(node("mic-details").hidden, false);
  panel.recordError = "recordHeadroom";
  panel.update();
  assert.equal(node("record-error").hidden, false);
  assert.match(node("record-error").textContent, /Turunkan Master/);
  assert.equal(node("record").disabled, false);
  assert.equal(node("cancel").disabled, true);
  assert.equal(node("wav").disabled, true);
  assert.equal(node("mic-meter").value, 0.2);
  ready = false;
  owner.producers.clear();
  owner.micInput = null;
  owner.micStatus = "off";
  panel.update();
  assert.equal(node("record").disabled, true);
  assert.equal(node("mic-details").hidden, true);
  assert.equal(
    node("mic-meter").value,
    0,
    "inactive input cannot show a stale live level",
  );
  owner.micInput = { state: "requesting" };
  owner.micStatus = "requesting";
  panel.pending = true;
  panel.update();
  assert.equal(
    node("mic-stop").disabled,
    false,
    "Stop remains reachable while an enable operation is pending",
  );
  assert.equal(node("mic-enable").disabled, true);
});

test("arm error explains headroom and retry clears the stale alert", async () => {
  const failure = Object.assign(Error("headroom"), { code: "voiceHeadroom" });
  const panel = {
    bars: 2,
    record: () => {
      throw failure;
    },
  };
  await assert.rejects(
    RecordPanel.prototype.recordAttempt.call(panel),
    (e) => e === failure,
  );
  assert.equal(panel.recordError, "recordHeadroom");
  const handle = { state: "armed" };
  panel.record = (options) => {
    assert.deepEqual(options, { bars: 2, countInBars: 1 });
    return handle;
  };
  assert.equal(await RecordPanel.prototype.recordAttempt.call(panel), handle);
  assert.equal(panel.recordError, null);
});

test("rejected prepare refreshes shared selector status after pending clears", async () => {
  const states = [];
  let selectorDisabled = false,
    error;
  const panel = {
    pending: false,
    confirming: null,
    refresh() {
      selectorDisabled = this.pending;
      states.push(selectorDisabled);
    },
    async act(fn) {
      try {
        await fn();
      } catch (e) {
        error = e;
      } finally {
        this.refresh();
      }
    },
  };
  await RecordPanel.prototype.run.call(panel, () => {
    throw Error("occupied target");
  });
  assert.match(error.message, /occupied target/);
  assert.equal(panel.pending, false);
  assert.equal(selectorDisabled, false);
  assert.deepEqual(states, [true, true, false]);
});
test("pending async setup excludes duplicate commands and restores shared controls on completion", async () => {
  let resolve,
    runs = 0,
    selectorDisabled = false;
  const gate = new Promise((r) => {
    resolve = r;
  });
  const panel = {
    pending: false,
    confirming: null,
    refresh() {
      selectorDisabled = this.pending;
    },
    act: (fn) => fn(),
  };
  const first = RecordPanel.prototype.run.call(panel, async () => {
    runs++;
    await gate;
  });
  assert.equal(selectorDisabled, true);
  await RecordPanel.prototype.run.call(panel, () => {
    runs++;
  });
  assert.equal(runs, 1);
  resolve();
  await first;
  assert.equal(selectorDisabled, false);
  assert.equal(panel.pending, false);
});

test("a closed replay fault is surfaced as error without hiding or discarding its complete take", () => {
  const owner = new WorkspaceAudioOwner({
    memory: new AudioMemory(),
    getProject: () => null,
  });
  owner.capture = { retained: new Map() };
  const r = new SelectedRecorder(owner),
    take = { id: "take-retained", partial: false },
    fault = { reason: "replay-frame-gap" };
  r.current = {
    state: "closed",
    take,
    playbackOutcome: fault,
    plan: { startFrame: 0, framesPerBar: 66590 },
  };
  const view = r.snapshot();
  assert.equal(view.state, "error");
  assert.equal(view.take, take);
  assert.equal(view.playbackOutcome, fault);
  assert.equal(r.current.take, take);
});

test("a retained session copy remains stoppable and discardable after project adoption unloads the prepared plan", async () => {
  let stopped = 0,
    discarded = 0;
  const r = new SelectedRecorder({
    pool: {},
    controller: { project: null },
    capture: null,
    beginTakeOperation: () => ({ finish() {} }),
    stopSaved: async () => {
      stopped++;
    },
  });
  r.assignment = { trackId: "track-1" };
  r.current = { state: "closed", take: { id: "retained-session" } };
  r.takes = {
    discard: async () => {
      discarded++;
    },
  };
  await r.discardAll();
  assert.equal(stopped, 1);
  assert.equal(discarded, 1);
  assert.equal(r.current, null);
});
