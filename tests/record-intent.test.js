import test from "node:test";
import assert from "node:assert/strict";
import { armSelectedRecording } from "../src/loop-station/record-intent.js";
import {
  emptyLoopProject,
  newRecordingProject,
} from "../src/loop-station/model.js";
import { originalRegistry } from "../src/project/original-registry.js";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { drumBanks } from "../src/loop-station/drum-sources.js";
import { melodicBanks } from "../src/loop-station/melodic-sources.js";
import { eightTrackDemo } from "../src/loop-station/demo.js";
import { starterContent, createStarter } from "../src/loop-station/starters.js";
import { parseLoopProject } from "../src/loop-station/project.js";

function fixture(running = false) {
  const log = [],
    transport = { running },
    receipt = {};
  const owner = {
    engine: { transport },
    claims: new Map(),
    playbacks: new Map(),
    controller: {
      stop() {
        log.push("stop");
        transport.running = false;
      },
      async waitVoices() {
        log.push("closed");
      },
    },
    producers: new Map([["track-1", { retained: true }]]),
  };
  const error = Object.assign(Error("headroom"), { code: "voiceHeadroom" });
  const recorder = {
    current: { take: { id: "retained" } },
    arm() {
      log.push("arm");
      throw error;
    },
  };
  return {
    owner,
    recorder,
    log,
    error,
    receipt,
    async start() {
      log.push("start");
      transport.running = true;
      return receipt;
    },
    current: (r) => r === receipt,
  };
}
test("failed first arm closes only its transport start and retains prepared input/take", async () => {
  const f = fixture(),
    take = f.recorder.current,
    producer = f.owner.producers.get("track-1");
  await assert.rejects(armSelectedRecording(f, {}), (e) => e === f.error);
  assert.deepEqual(f.log, ["start", "arm", "stop", "closed"]);
  assert.equal(f.owner.engine.transport.running, false);
  assert.equal(f.recorder.current, take);
  assert.equal(f.owner.producers.get("track-1"), producer);
  f.recorder.arm = () => ({ state: "armed" });
  assert.deepEqual(await armSelectedRecording(f, {}), { state: "armed" });
  assert.equal(f.owner.engine.transport.running, true);
});
test("refusal during existing playback does not stop it", async () => {
  const f = fixture(true);
  await assert.rejects(armSelectedRecording(f, {}), (e) => e === f.error);
  assert.deepEqual(f.log, ["arm"]);
  assert.equal(f.owner.engine.transport.running, true);
});
test("cancelled start never arms or rolls back a newer command", async () => {
  const f = fixture();
  f.current = () => false;
  await assert.rejects(armSelectedRecording(f, {}), { code: "cancelled" });
  assert.deepEqual(f.log, ["start"]);
});
for (const kind of ["claims", "playbacks", "new-command"])
  test(`failed arm preserves accepted ${kind}`, async () => {
    const f = fixture();
    let current = true;
    f.current = () => current;
    f.recorder.arm = () => {
      if (kind === "new-command") current = false;
      else f.owner[kind].set("accepted", {});
      throw f.error;
    };
    await assert.rejects(armSelectedRecording(f, {}), (e) => e === f.error);
    assert.deepEqual(f.log, ["start"]);
    assert.equal(f.owner.engine.transport.running, true);
  });
test("accepted arm returns its exact handle without waiting for capture readiness", async () => {
  const f = fixture(),
    handle = { prepared: new Promise(() => {}) };
  f.recorder.arm = () => handle;
  assert.equal(await armSelectedRecording(f, {}), handle);
  assert.deepEqual(f.log, ["start"]);
});
test("unconfirmed cleanup surfaces its error instead of pretending ready", async () => {
  const f = fixture();
  f.owner.controller.waitVoices = async () => {
    throw Object.assign(Error(), { code: "loopClosePending" });
  };
  await assert.rejects(armSelectedRecording(f, {}), {
    code: "loopClosePending",
  });
});
test("new recording default leaves legacy factory and imported mixer values intact", () => {
  const old = emptyLoopProject(originalRegistry),
    fresh = newRecordingProject(originalRegistry);
  assert.equal(old.master.volume, 1);
  assert.equal(fresh.master.volume, 0.5);
  assert.ok(Object.isFrozen(fresh.master));
  assert.equal(newRecordingProject(originalRegistry).master.volume, 0.5);
  assert.equal(old.master.volume, 1);
});

test("new-recording default cannot attenuate demo, starter or stored project values", () => {
  const registry = new InstrumentRegistry([
    ...catalog.banks,
    ...drumBanks,
    ...melodicBanks(),
  ]);
  const demo = eightTrackDemo(registry);
  assert.equal(demo.master.volume, 1);
  for (const recipe of starterContent) {
    const p = createStarter(recipe.id, registry),
      text = JSON.stringify(p);
    assert.equal(p.master.volume, 1);
    newRecordingProject(registry);
    assert.equal(JSON.stringify(parseLoopProject(text, registry)), text);
  }
  const stored = structuredClone(emptyLoopProject(registry));
  for (const volume of [0, 0.17, 0.5, 1]) {
    stored.master.volume = volume;
    assert.equal(
      parseLoopProject(JSON.stringify(stored), registry).master.volume,
      volume,
    );
  }
});
