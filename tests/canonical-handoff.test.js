import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import {
  CanonicalHandoffStore,
  canonicalBundleHasInput,
} from "../src/project/canonical-handoff.js";
import { canonicalLocalSession } from "../src/studio/canonical-route.js";
import { instrumentHandoffText } from "../src/gamelan/v5-navigation.js";
test("Gamelan handoff pauses a replay and serializes only after the source preparation acknowledgment", async () => {
  const calls = [];
  let finish;
  const gate = new Promise((r) => (finish = r));
  const pending = instrumentHandoffText({
    snapshot: () => ({ replaying: true }),
    pause: () => calls.push("pause"),
    prepareStudio: async () => {
      calls.push("prepare");
      await gate;
      calls.push("ack");
    },
    toJSON: () => {
      calls.push("serialize");
      return "accepted current source";
    },
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["pause", "prepare"]);
  finish();
  assert.equal(await pending, "accepted current source");
  assert.deepEqual(calls, ["pause", "prepare", "ack", "serialize"]);
  let serialized = false;
  await assert.rejects(
    instrumentHandoffText({
      snapshot: () => ({ replaying: false }),
      prepareStudio: async () => {
        throw Object.assign(Error("recordBusy"), { code: "recordBusy" });
      },
      toJSON: () => {
        serialized = true;
      },
    }),
    (e) => e.code === "recordBusy",
  );
  assert.equal(serialized, false);
});
test("handoff refuses invalid identifiers/payloads before storage or a retained allocation", async () => {
  const memory = new AudioMemory(),
    inbox = new CanonicalHandoffStore({ memory, indexedDB: null });
  await assert.rejects(
    inbox.read("../current"),
    (e) => e.code === "invalidHandoff",
  );
  await assert.rejects(
    inbox.stage(new Blob([]), { kind: "gamelan" }),
    (e) => e.code === "invalidHandoff",
  );
  await assert.rejects(
    inbox.stage(new Blob(["data"]), { kind: "unknown" }),
    (e) => e.code === "invalidHandoff",
  );
  assert.equal(memory.snapshot().bytes, 0);
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    inbox.stage(new Blob(["data"]), { kind: "loop", signal: ac.signal }),
    (e) => e.code === "cancelled",
  );
  assert.equal(memory.snapshot().bytes, 0);
  inbox.close();
});
test("accepted-source detection requires the exact source hash in an original or retained archive", () => {
  const hash = "a".repeat(64),
    other = "b".repeat(64),
    empty = { backupHash: other, backupRefs: [], project: { origins: [] } };
  assert.equal(canonicalBundleHasInput(empty, hash), false);
  assert.equal(
    canonicalBundleHasInput({ ...empty, backupHash: hash }, hash),
    true,
  );
  assert.equal(
    canonicalBundleHasInput({ ...empty, backupRefs: [{ sha256: hash }] }, hash),
    true,
  );
  assert.equal(
    canonicalBundleHasInput(
      { ...empty, project: { origins: [{ kind: "file", sha256: hash }] } },
      hash,
    ),
    true,
  );
  assert.equal(
    canonicalBundleHasInput(
      { ...empty, project: { origins: [{ kind: "embedded", sha256: hash }] } },
      hash,
    ),
    false,
  );
});
test("producer opt-in stays development-local and explicit on all workspace routes", () => {
  for (const path of ["/gamelan/", "/loop-station/", "/studio/"]) {
    assert.equal(
      canonicalLocalSession(
        true,
        "http://127.0.0.1:6021" + path + "?candidate=canonical",
      ),
      true,
    );
    assert.equal(
      canonicalLocalSession(
        false,
        "http://127.0.0.1:6021" + path + "?candidate=canonical",
      ),
      false,
    );
    assert.equal(
      canonicalLocalSession(
        true,
        "https://perkusi.com" + path + "?candidate=canonical",
      ),
      false,
    );
    assert.equal(
      canonicalLocalSession(true, "http://127.0.0.1:6021" + path),
      false,
    );
  }
});
