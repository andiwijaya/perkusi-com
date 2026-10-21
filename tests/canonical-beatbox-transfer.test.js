import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareTransfer,
  incomingTransfer,
} from "../src/project/mode-transfer.js";
import { stageBeatboxTransfer } from "../src/project/canonical-beatbox-transfer.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { migrateProject } from "../src/project/schema.js";
import { originalRegistry } from "../src/project/original-registry.js";
const storage = () => {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};
const beatbox = () =>
  migrateProject(
    {
      format: "perkusi-project",
      schemaVersion: 0,
      title: "Three original layers",
      packId: originalRegistry.packId,
      packVersion: originalRegistry.version,
      bpm: 96,
      volume: 0.65,
      exportBars: 4,
      layers: Object.fromEntries(
        originalRegistry.roleOrder.map((role, i) => [
          role,
          { enabled: i < 3, variant: 1 },
        ]),
      ),
    },
    originalRegistry,
  );
test("Beatbox legacy envelope stages one stable canonical source without an early ACK or legacy destination write", async () => {
  const s = storage(),
    session = storage(),
    memory = new AudioMemory(),
    rows = new Map(),
    store = {
      async stage(blob, { id, ...meta }) {
        const text = await blob.text(),
          prior = rows.get(id);
        if (prior) assert.equal(prior.text, text);
        else rows.set(id, { text, ...meta });
        return { id };
      },
    };
  prepareTransfer(beatbox(), "studio", {
    storage: s,
    session,
    makeId: () => "legacy-non-uuid-id",
  });
  const before = s.getItem("perkusi.mode-transfer.v3"),
    first = await stageBeatboxTransfer({ store, memory, storage: s, session });
  assert.equal(s.getItem("perkusi.mode-transfer.v3"), before);
  assert.equal(s.getItem("perkusi.draft.studio.v3"), null);
  const second = await stageBeatboxTransfer({
    store,
    memory,
    storage: s,
    session,
  });
  assert.equal(first.id, second.id);
  assert.equal(rows.size, 1);
  assert.equal(
    JSON.parse(rows.get(first.id).text).clips.filter((c) => c.enabled).length,
    3,
  );
  first.acknowledge();
  assert.equal(
    JSON.parse(s.getItem("perkusi.mode-transfer.v3")).pending,
    false,
  );
  assert.equal(incomingTransfer("studio", s, session), null);
  assert.equal(
    await stageBeatboxTransfer({ store, memory, storage: s, session }),
    null,
  );
  assert.equal(memory.snapshot().bytes, 0);
});
test("failed canonical staging preserves legacy source/marker and newer transfer cannot be ACKed by an old adapter", async () => {
  const s = storage(),
    session = storage(),
    memory = new AudioMemory();
  prepareTransfer(beatbox(), "studio", {
    storage: s,
    session,
    makeId: () => "old",
  });
  const raw = s.getItem("perkusi.mode-transfer.v3");
  await assert.rejects(
    stageBeatboxTransfer({
      store: {
        stage: () => {
          throw Error("quota fault");
        },
      },
      memory,
      storage: s,
      session,
    }),
  );
  assert.equal(s.getItem("perkusi.mode-transfer.v3"), raw);
  assert.equal(memory.snapshot().bytes, 0);
  const old = await stageBeatboxTransfer({
    store: { stage: async (b, { id }) => ({ id }) },
    memory,
    storage: s,
    session,
  });
  prepareTransfer(beatbox(), "studio", {
    storage: s,
    session,
    makeId: () => "new",
  });
  assert.throws(() => old.acknowledge());
  assert.equal(JSON.parse(s.getItem("perkusi.mode-transfer.v3")).pending, true);
  assert.equal(memory.snapshot().bytes, 0);
});
