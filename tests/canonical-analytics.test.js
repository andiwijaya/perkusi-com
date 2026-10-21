import test from "node:test";
import assert from "node:assert/strict";
import { createCanonicalEventReporter } from "../src/studio/canonical-analytics.js";

test("canonical analytics counts actual playback and durable saves once, never preparation/ACK notifications", () => {
  const sent = [],
    r = createCanonicalEventReporter((...e) => sent.push(e));
  r.open();
  r.open();
  r.workflow({ status: "saving", documentId: "private", savedRevision: 1 });
  const saved = { status: "saved", documentId: "private", savedRevision: 1 };
  r.workflow(saved);
  r.workflow(saved);
  r.workflow({ ...saved, savedRevision: 2 });
  r.position({ frame: 50 }, "prepared", { generation: 1 });
  r.position({ frame: 0 }, "playing", { generation: 1 });
  r.position({ frame: 1 }, "playing", { generation: 1 });
  r.position({ frame: 80 }, "playing", { generation: 1, cycle: 2 });
  r.position({ frame: 2 }, "playing", { generation: 2 });
  r.exported();
  r.exported({ code: "cancelled" });
  r.exported({ code: "assetFailed" });
  assert.deepEqual(sent, [
    ["studio_open"],
    ["project_saved"],
    ["project_saved"],
    ["audio_started"],
    ["audio_started"],
    ["export_succeeded"],
    ["export_failed", "asset"],
  ]);
  assert(!JSON.stringify(sent).includes("private"));
});
test("analytics rejection never changes application control flow", () => {
  const r = createCanonicalEventReporter(() => {
    throw Error("send denied");
  });
  assert.doesNotThrow(() => {
    r.open();
    r.exported();
    r.workflow({ status: "saved", documentId: "x", savedRevision: 1 });
    r.position({ frame: 1 }, "playing", { generation: 1 });
  });
});
