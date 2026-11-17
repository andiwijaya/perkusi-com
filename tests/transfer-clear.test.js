import test from "node:test";
import assert from "node:assert/strict";
import { originalRegistry } from "../src/project/original-registry.js";
import { fromBeatbox } from "../src/project/composition-model.js";
import {
  prepareTransfer,
  incomingTransfer,
  clearTransferBackups,
  transferReceiptKey,
} from "../src/project/mode-transfer.js";

const KEY = "perkusi.mode-transfer.v3",
  MARKER = "perkusi.mode-transfer.pending.v3";
function memory() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, raw) => values.set(key, raw),
    removeItem: (key) => values.delete(key),
  };
}
async function setup() {
  const storage = memory(),
    session = memory();
  const b = {
    format: "perkusi-project",
    schemaVersion: 1,
    mode: "beatbox",
    title: "Keep this beat",
    pack: { id: originalRegistry.packId, version: originalRegistry.version },
    timing: { bpm: 96, meter: [4, 4] },
    master: { volume: 0.37 },
    export: { bars: 4 },
    tracks: originalRegistry.roleOrder.map((role, i) => ({
      role,
      enabled: i % 2 === 0,
      variant: (i % 2) + 1,
    })),
  };
  storage.setItem("perkusi.draft.v1", JSON.stringify(b));
  storage.setItem(
    "perkusi.draft.studio.v3",
    JSON.stringify(fromBeatbox({ ...b, title: "Old Studio draft" })),
  );
  for (const key of [
    "perkusi.projects.v1",
    "perkusi.projects.studio.v3",
    "perkusi.projects.studio.v2",
    "perkusi.draft.studio.v2",
    "unrelated.preference",
  ])
    storage.setItem(key, `preserve original bytes for ${key}`);
  prepareTransfer(b, "studio", {
    storage,
    session,
    makeId: () => "clear-test",
  });
  await incomingTransfer("studio", storage, session).deliver(() => {});
  storage.setItem(transferReceiptKey("beatbox"), "old opaque receipt");
  session.setItem(MARKER, "clear-test");
  session.setItem("unrelated.session", "keep");
  return { storage, session, raw: storage.getItem(KEY) };
}
const snapshot = (owner) => new Map(owner.values);

test("clearing transfer backups removes only the archive, two receipts and session marker", async () => {
  const { storage, session, raw } = await setup();
  const localBefore = snapshot(storage),
    sessionBefore = snapshot(session);
  clearTransferBackups(raw, { storage, session });
  for (const key of [
    KEY,
    transferReceiptKey("studio"),
    transferReceiptKey("beatbox"),
  ])
    localBefore.delete(key);
  sessionBefore.delete(MARKER);
  assert.deepEqual(storage.values, localBefore);
  assert.deepEqual(session.values, sessionBefore);
});

test("a newer archive written during confirmation cannot be cleared using the old snapshot", async () => {
  const { storage, session, raw } = await setup();
  const newer = {
    ...JSON.parse(raw),
    id: "new-pending-transfer",
    pending: true,
  };
  storage.setItem(KEY, JSON.stringify(newer));
  const before = snapshot(storage),
    beforeSession = snapshot(session);
  assert.throws(() => clearTransferBackups(raw, { storage, session }), {
    code: "transferChanged",
  });
  assert.deepEqual(storage.values, before);
  assert.deepEqual(session.values, beforeSession);
});

test("a pending transfer refuses cleanup without changing any project or metadata", async () => {
  const { storage, session, raw } = await setup();
  const pending = JSON.stringify({ ...JSON.parse(raw), pending: true });
  storage.setItem(KEY, pending);
  const before = snapshot(storage),
    beforeSession = snapshot(session);
  assert.throws(() => clearTransferBackups(pending, { storage, session }), {
    code: "transferPending",
  });
  assert.deepEqual(storage.values, before);
  assert.deepEqual(session.values, beforeSession);
});

for (const [owner, key] of [
  ["session", MARKER],
  ["storage", transferReceiptKey("studio")],
  ["storage", transferReceiptKey("beatbox")],
  ["storage", KEY],
])
  test(`denied removal of ${key} keeps the full archive and restores already removed metadata`, async () => {
    const state = await setup(),
      before = snapshot(state.storage),
      beforeSession = snapshot(state.session);
    const original = state[owner],
      wrapped = {
        ...original,
        removeItem(name) {
          if (name === key) throw new DOMException("Denied", "SecurityError");
          original.removeItem(name);
        },
      };
    assert.throws(
      () => clearTransferBackups(state.raw, { ...state, [owner]: wrapped }),
      { code: "storageUnavailable" },
    );
    assert.deepEqual(state.storage.values, before);
    assert.deepEqual(state.session.values, beforeSession);
  });

test("a reported failure after archive removal restores its raw bytes and prior metadata", async () => {
  const state = await setup(),
    before = snapshot(state.storage),
    beforeSession = snapshot(state.session);
  const wrapped = {
    ...state.storage,
    removeItem(key) {
      state.storage.removeItem(key);
      if (key === KEY) throw new Error("Interrupted removal");
    },
  };
  assert.throws(
    () => clearTransferBackups(state.raw, { ...state, storage: wrapped }),
    { code: "storageUnavailable" },
  );
  assert.deepEqual(state.storage.values, before);
  assert.deepEqual(state.session.values, beforeSession);
});

test("rollback never overwrites another tab's new archive or receipt during cleanup", async () => {
  const state = await setup();
  const newer = JSON.stringify({
    ...JSON.parse(state.raw),
    id: "another-tab",
    pending: true,
  });
  const wrapped = {
    ...state.session,
    removeItem(key) {
      state.session.removeItem(key);
      state.storage.setItem(KEY, newer);
      state.storage.setItem(
        transferReceiptKey("studio"),
        "new receipt from another tab",
      );
    },
  };
  assert.throws(
    () => clearTransferBackups(state.raw, { ...state, session: wrapped }),
    { code: "transferChanged" },
  );
  assert.equal(state.storage.getItem(KEY), newer);
  assert.equal(
    state.storage.getItem(transferReceiptKey("studio")),
    "new receipt from another tab",
  );
  assert.equal(state.session.getItem("unrelated.session"), "keep");
});
