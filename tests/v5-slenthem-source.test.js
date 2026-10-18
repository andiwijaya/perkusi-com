import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { recordSource } from "../src/loop-station/record-sources.js";
import { liveAssignment } from "../src/loop-station/session-takes.js";
import { SelectedRecorder } from "../src/loop-station/selected-recorder.js";
import { RecordPanel } from "../src/loop-station/record-panel.js";
const registry = new InstrumentRegistry(catalog.banks);
test("bounded Slenthem assignment retains exact same-set source IDs, rejects mixed families and caller mutation", () => {
  const s = recordSource("slenthem"),
    a = liveAssignment(
      "track-1",
      registry,
      s.bankId,
      s.bankVersion,
      s.sampleIds,
    );
  assert.deepEqual(a.sampleIds, ["fs-261898", "fs-261896"]);
  assert.ok(
    a.sampleIds.every(
      (id) =>
        registry.sample(a.bankId, a.bankVersion, id).instrumentId ===
        "slenthem",
    ),
  );
  s.sampleIds[0] = "fs-261953";
  assert.equal(recordSource("slenthem").sampleIds[0], "fs-261898");
  assert.equal(a.sampleIds[0], "fs-261898");
  assert.throws(
    () =>
      liveAssignment("track-1", registry, a.bankId, a.bankVersion, [
        "fs-261898",
        "fs-261724",
      ]),
    (e) => e.code === "invalidCaptureSource",
  );
  assert.throws(
    () => recordSource("guitar"),
    (e) => e.code === "invalidCaptureSource",
  );
});
test("SelectedRecorder passes Slenthem identity through the actual assignment dispatcher; rejected choices never assign", async () => {
  let received,
    assigns = 0;
  const owner = {
    pool: {},
    claims: new Set(),
    controller: { context: { sampleRate: 48000 }, registry },
    assignInstrument: async (trackId, options) => {
      assigns++;
      received = { trackId, ...options };
      return {
        descriptors: options.sampleIds.map((id) =>
          registry.sample(options.bankId, options.bankVersion, id),
        ),
      };
    },
  };
  const r = new SelectedRecorder(owner);
  await r.prepare("track-2", { instrumentId: "slenthem" });
  assert.equal(received.trackId, "track-2");
  assert.deepEqual(received.sampleIds, ["fs-261898", "fs-261896"]);
  assert.equal(r.source.descriptors[0].instrumentId, "slenthem");
  await assert.rejects(
    r.prepare("track-2", { instrumentId: "guitar" }),
    (e) => e.code === "invalidCaptureSource",
  );
  assert.equal(assigns, 1);
  assert.equal(r.busy, false);
  assert.equal(r.assignment.sampleIds[0], "fs-261898");
});
test("selecting a different next instrument cannot play old ready-source pads until prepared", () => {
  const r = {
    source: {
      descriptors: [{ instrumentId: "saron-barung" }],
      snapshot: () => ({ accepting: true }),
    },
    assignment: { trackId: "track-1" },
  };
  const panel = {
    element: { isConnected: true },
    recorder: () => r,
    selected: () => "track-1",
    instrumentId: "slenthem",
    busy: () => false,
    owner: {
      boundaries: new Set(),
      savedBlocked: () => false,
      producers: new Map([["track-1", {}]]),
      engine: { context: { state: "running" } },
    },
  };
  assert.equal(RecordPanel.prototype.playable.call(panel), false);
  panel.instrumentId = "saron-barung";
  assert.equal(RecordPanel.prototype.playable.call(panel), true);
});
