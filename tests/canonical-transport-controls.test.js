import test from "node:test";
import assert from "node:assert/strict";
import { canonicalTransportControls } from "../src/studio/canonical-transport-controls.js";
import { createCanonicalStudioController } from "../src/studio/canonical-controller.js";
import { canonicalLocalRoute } from "../src/studio/canonical-route.js";

function fixture() {
  let resolveDone, job;
  const controller = createCanonicalStudioController({
    createOwner: async () => ({
      prepare: async () => ({
        playableVerified: true,
        admission: { maxOwned: 1, maxPeak: 0.2 },
        program: { rate: 48000, frames: 48000 },
        timeline: { bodyFrames: 48000 },
        provenance: "qa",
        dispose() {},
      }),
      resume: async () => {},
      pause: async () => {},
      start: (_score, { repeat }) => {
        job = {
          continuous: repeat,
          ready: Promise.resolve(),
          done: new Promise((r) => (resolveDone = r)),
          finish() {
            job.finishing = true;
          },
          cycle: 1,
        };
        return job;
      },
      interrupt: async () => {},
      dispose: async () => resolveDone?.({ closed: true }),
    }),
  });
  return {
    controller,
    get job() {
      return job;
    },
  };
}
test("finite playback capability remains disabled after workspace lock/unlock; controller refuses the same invalid repeat", async () => {
  const f = fixture();
  try {
    await f.controller.play({ title: "finite" });
    const s = f.controller.snapshot();
    assert.equal(s.status, "playing");
    assert.equal(s.repeatEnabled, false);
    assert.throws(() => f.controller.setRepeat(true), {
      code: "canonicalRepeatNeedsRestart",
    });
    assert.equal(canonicalTransportControls(s).repeatDisabled, true);
    assert.equal(
      canonicalTransportControls(s, { locked: true }).repeatDisabled,
      true,
    );
    assert.equal(
      canonicalTransportControls(s, { locked: false }).repeatDisabled,
      true,
    );
    assert.equal(canonicalTransportControls(s).repeatChecked, false);
  } finally {
    await f.controller.dispose();
  }
});
test("idle seek is disabled and actual controller rejects it; paused repeat permits seek but finishing cannot reenable repeat", async () => {
  const f = fixture();
  try {
    assert.equal(
      canonicalTransportControls(f.controller.snapshot()).seekDisabled,
      true,
    );
    assert.throws(() => f.controller.seek(0));
    f.controller.setRepeat(true);
    await f.controller.play({ title: "repeat" });
    await f.controller.pause();
    assert.equal(
      canonicalTransportControls(f.controller.snapshot()).seekDisabled,
      false,
    );
    f.controller.setRepeat(false);
    const s = f.controller.snapshot();
    assert(s.finishing);
    assert.equal(canonicalTransportControls(s).repeatDisabled, true);
    assert.equal(canonicalTransportControls(s).repeatChecked, false);
    assert.throws(() => f.controller.setRepeat(true), {
      code: "canonicalRepeatFinishing",
    });
  } finally {
    await f.controller.dispose();
  }
});
for (const status of [
  "idle",
  "preparing",
  "playing",
  "paused",
  "prepared",
  "ended",
  "error",
  "cleanup-pending",
  "closed",
])
  test("transport capability matrix " + status, () => {
    for (const repeatEnabled of [false, true]) {
      const s = {
        status,
        repeatEnabled,
        closed: status === "closed",
        finishing: false,
        capability: ["playing", "paused", "prepared"].includes(status)
          ? {}
          : null,
      };
      const c = canonicalTransportControls(s);
      assert.equal(c.repeatChecked, repeatEnabled);
      assert.equal(
        Boolean(c.seekDisabled),
        !["playing", "paused"].includes(status),
      );
      if (["preparing", "cleanup-pending", "closed"].includes(status))
        assert(c.repeatDisabled);
      assert(canonicalTransportControls(s, { locked: true }).seekDisabled);
      assert(canonicalTransportControls(s, { locked: true }).repeatDisabled);
    }
  });
test("Preview is explicit across ID/EN aliases while legacy/default remains selected", () => {
  for (const route of [
    "/studio",
    "/studio/",
    "/studio/index.html",
    "/en/studio",
    "/en/studio/",
    "/en/studio/index.html",
  ]) {
    assert.equal(
      canonicalLocalRoute(true, "https://perkusi.com" + route, true, false),
      false,
    );
    assert.equal(
      canonicalLocalRoute(
        true,
        "https://perkusi.com" + route + "?workspace=legacy",
        true,
        false,
      ),
      false,
    );
    assert.equal(
      canonicalLocalRoute(
        true,
        "https://perkusi.com" + route + "?candidate=canonical",
        true,
        false,
      ),
      true,
    );
  }
});
