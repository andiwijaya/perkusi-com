import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { migrateLegacyMetadata } from "../src/project/canonical-metadata.js";
import {
  createCanonicalBundle,
  exportCanonicalPackage,
  importCanonicalPackage,
  importCanonicalFile,
  retainCanonicalBundle,
} from "../src/project/canonical-package.js";
import { createCanonicalEditor } from "../src/studio/canonical-editor.js";
import {
  canonicalFixtureRegistry as registry,
  fixturePCM,
} from "./helpers/canonical-fixtures.js";
import { exportAudioBundle } from "../src/loop-station/audio-bundle.js";
import { createCanonicalWorkflow } from "../src/studio/canonical-workflow.js";

test("one immutable original Blob shared with input backup stays owned once through independent consumers", async () => {
  const f = await specimen(),
    origin = f.bundle.project.origins.find((o) => o.kind === "file"),
    original = f.bundle.originals.get(origin.sha256),
    originals = new Map([[origin.sha256, original]]),
    before = f.memory.snapshot().bytes;
  const shared = await createCanonicalBundle(f.bundle.project, {
    registry,
    memory: f.memory,
    originals,
    backup: original,
  });
  const sharedBytes = f.memory.snapshot().bytes - before;
  assert.equal(sharedBytes, original.size + 8192);
  const distinct = await createCanonicalBundle(f.bundle.project, {
    registry,
    memory: f.memory,
    originals,
    backup: new Blob([original]),
  });
  assert.equal(
    f.memory.snapshot().bytes - before - sharedBytes,
    sharedBytes + original.size,
  );
  const retained = retainCanonicalBundle(shared);
  shared.dispose();
  f.bundle.dispose();
  assert.equal(retained.backup, original);
  assert.equal(retained.originals.get(origin.sha256), original);
  assert.deepEqual(new Uint8Array(await retained.backup.arrayBuffer()), f.raw);
  distinct.dispose();
  assert.equal(f.memory.snapshot().bytes, sharedBytes);
  retained.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});

test("released bundle access refuses while an independent retained consumer preserves the exact original owner", async () => {
  const f = await specimen(),
    retained = retainCanonicalBundle(f.bundle),
    o = retained.project.origins.find((o) => o.kind === "file");
  f.bundle.dispose();
  assert.throws(
    () => f.bundle.originals.get(o.sha256),
    (e) => e.code === "canonicalBundleReleased",
  );
  assert.deepEqual(
    new Uint8Array(await retained.originals.get(o.sha256).arrayBuffer()),
    f.raw,
  );
  assert.ok(f.memory.snapshot().bytes > 0);
  retained.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("file import staged before a newer editor commit cannot overwrite the newer accepted revision", async () => {
  const f = await specimen(),
    editor = await createCanonicalEditor(f.bundle, {
      registry,
      memory: f.memory,
    });
  let finish, enter;
  const gate = new Promise((r) => (finish = r)),
    entered = new Promise((r) => (enter = r));
  class Delayed extends Blob {
    async arrayBuffer() {
      enter();
      await gate;
      return super.arrayBuffer();
    }
  }
  const workflow = createCanonicalWorkflow({
      editor,
      registry,
      memory: f.memory,
      storage: { close() {} },
    }),
    task = workflow.importFile(new Delayed([f.raw]));
  await entered;
  await editor.edit((p) => (p.title = "newer editor value"));
  const before = editor.snapshot();
  finish();
  await assert.rejects(task, (e) => e.code === "draftConflict");
  assert.equal(editor.snapshot().project, before.project);
  assert.equal(editor.snapshot().revision, before.revision);
  await workflow.dispose();
  await editor.dispose();
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});

test("explicit import cancellation reports pending ownership until actual read settles and leaves history intact", async () => {
  const f = await specimen(),
    editor = await createCanonicalEditor(f.bundle, {
      registry,
      memory: f.memory,
    }),
    before = editor.snapshot();
  let finish, enter;
  const gate = new Promise((r) => (finish = r)),
    entered = new Promise((r) => (enter = r));
  class Delayed extends Blob {
    async arrayBuffer() {
      enter();
      await gate;
      return super.arrayBuffer();
    }
  }
  const workflow = createCanonicalWorkflow({
      editor,
      registry,
      memory: f.memory,
      storage: { close() {} },
    }),
    task = workflow.importFile(new Delayed([f.raw]));
  await entered;
  workflow.cancel();
  assert.equal(workflow.snapshot().status, "cancelling");
  assert.equal(workflow.snapshot().pending, 1);
  assert.equal(editor.snapshot().project, before.project);
  finish();
  await assert.rejects(task, (e) => e.code === "cancelled");
  assert.equal(workflow.snapshot().status, "cancelled");
  assert.equal(editor.snapshot().revision, before.revision);
  await workflow.dispose();
  await editor.dispose();
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("portable memory refusal preserves the accepted bundle and foreign pressure owner", async () => {
  const f = await specimen(),
    baseline = f.memory.snapshot().bytes,
    pressure = f.memory.reserve(67108864 - baseline - 1024, "foreign pressure"),
    id = f.memory.snapshot().owners.at(-1).id;
  await assert.rejects(
    exportCanonicalPackage(f.bundle, { memory: f.memory }),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.ok(f.memory.snapshot().owners.some((o) => o.id === id));
  assert.equal(f.memory.snapshot().bytes, 67108864 - 1024);
  pressure.release();
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});

test("superseded import stays charged through actual read settlement and cannot replace document/history/status", async () => {
  const f = await specimen(),
    editor = await createCanonicalEditor(f.bundle, {
      registry,
      memory: f.memory,
    }),
    base = editor.snapshot();
  let finishRead, entered;
  const gate = new Promise((r) => (finishRead = r)),
    started = new Promise((r) => (entered = r));
  class DelayedBlob extends Blob {
    async arrayBuffer() {
      entered();
      await gate;
      return super.arrayBuffer();
    }
  }
  const delayed = new DelayedBlob([f.raw]),
    bad = new Blob(["invalid project"]),
    workflow = createCanonicalWorkflow({
      editor,
      registry,
      memory: f.memory,
      storage: { close() {} },
    }),
    older = workflow.importFile(delayed);
  await started;
  const olderHeld = f.memory
    .snapshot()
    .owners.find((o) => o.label === "canonical/import-input-backup").id;
  await assert.rejects(workflow.importFile(bad));
  assert.ok(
    f.memory.snapshot().owners.some((o) => o.id === olderHeld),
    "unsettled read owner released early",
  );
  const status = workflow.snapshot().status;
  finishRead();
  await assert.rejects(older, (e) => e.code === "cancelled");
  assert.equal(workflow.snapshot().status, status);
  assert.equal(editor.snapshot().project, base.project);
  assert.equal(editor.snapshot().revision, base.revision);
  assert.equal(workflow.snapshot().inputBackup, bad);
  assert.equal(
    f.memory.snapshot().owners.some((o) => o.id === olderHeld),
    false,
  );
  await workflow.dispose();
  await editor.dispose();
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("save/export capture a retained snapshot before scheduling and disposal before their first await releases it", async () => {
  for (const method of ["save", "exportProject"]) {
    const f = await specimen(),
      editor = await createCanonicalEditor(f.bundle, {
        registry,
        memory: f.memory,
      }),
      workflow = createCanonicalWorkflow({
        editor,
        registry,
        memory: f.memory,
        storage: {
          async save(_, options) {
            if (options.signal.aborted)
              throw Object.assign(Error("cancelled"), { code: "cancelled" });
          },
          close() {},
        },
      }),
      task = workflow[method](),
      close = workflow.dispose();
    await assert.rejects(task, (e) => e.code === "cancelled");
    await close;
    await editor.dispose();
    f.bundle.dispose();
    assert.equal(f.memory.snapshot().bytes, 0);
  }
});
async function specimen({ version = 3, memory = new AudioMemory() } = {}) {
  const name =
      version === 5 ? "schema5-eq-overdub-alignment" : "schema3-fifteen-lanes",
    raw = new Uint8Array(
      await readFile(
        new URL(
          "./fixtures/v5-canonical/" + name + ".perkusi.json",
          import.meta.url,
        ),
      ),
    ),
    migrated = await migrateLegacyMetadata(raw, { registry }),
    entries = new Map();
  if (version === 5) {
    const pcm = fixturePCM();
    for (const [a, i] of migrated.project.assets.map((a, i) => [a, i]))
      entries.set(a.id, {
        blob: new Blob([pcm[i].buffer]),
        provenance: "QA synthetic memory-only take, exact original hashes",
      });
  }
  const bundle = await createCanonicalBundle(migrated.project, {
    registry,
    memory,
    entries,
    originals: migrated.originals,
  });
  return { memory, raw, bundle };
}
test("canonical portable roundtrip retains exact original BOM/whitespace and independently hashed recording layers", async () => {
  const f = await specimen({ version: 5 }),
    foreign = f.memory.reserve(313, "foreign"),
    out = await exportCanonicalPackage(f.bundle, { memory: f.memory }),
    copy = await importCanonicalPackage(out.blob, {
      registry,
      memory: f.memory,
    });
  assert.deepEqual(copy.project, f.bundle.project);
  for (const a of copy.project.assets)
    assert.deepEqual(
      new Uint8Array(await copy.entries.get(a.id).blob.arrayBuffer()),
      new Uint8Array(await f.bundle.entries.get(a.id).blob.arrayBuffer()),
    );
  const o = copy.project.origins.find((o) => o.kind === "file");
  assert.deepEqual(
    new Uint8Array(await copy.originals.get(o.sha256).arrayBuffer()),
    f.raw,
  );
  copy.dispose();
  out.release();
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 313);
  foreign.release();
});
test("package manifest corruption, extra bytes and raw original corruption reject without touching another accepted bundle", async () => {
  const f = await specimen(),
    out = await exportCanonicalPackage(f.bundle, { memory: f.memory }),
    baseline = f.memory.snapshot().bytes,
    bytes = new Uint8Array(await out.blob.arrayBuffer());
  const badManifest = bytes.slice();
  badManifest[55] ^= 1;
  await assert.rejects(
    importCanonicalPackage(new Blob([badManifest]), {
      registry,
      memory: f.memory,
    }),
  );
  await assert.rejects(
    importCanonicalPackage(new Blob([bytes, new Uint8Array(1)]), {
      registry,
      memory: f.memory,
    }),
  );
  const badOriginal = bytes.slice();
  badOriginal[badOriginal.length - 1] ^= 1;
  await assert.rejects(
    importCanonicalPackage(new Blob([badOriginal]), {
      registry,
      memory: f.memory,
    }),
    (e) => e.code === "originalHashMismatch",
  );
  assert.equal(f.memory.snapshot().bytes, baseline);
  out.release();
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("legacy JSON keeps exact original bytes and legacy portable keeps its entire original container", async () => {
  const f = await specimen({ version: 5 }),
    old = JSON.parse(new TextDecoder().decode(f.raw)),
    entries = new Map(
      old.assetRefs.map((a) => [a.id, f.bundle.entries.get(a.id)]),
    ),
    portable = await exportAudioBundle(old, entries, {
      registry,
      memory: f.memory,
    }),
    migrated = await importCanonicalFile(portable.blob, {
      registry,
      memory: f.memory,
    }),
    origin = migrated.project.origins.find(
      (o) => o.id === migrated.project.compatibility.rootOriginId,
    );
  assert.deepEqual(
    new Uint8Array(await migrated.originals.get(origin.sha256).arrayBuffer()),
    new Uint8Array(await portable.blob.arrayBuffer()),
  );
  migrated.dispose();
  portable.release();
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
  const memory = new AudioMemory(),
    text = new TextDecoder().decode(
      await readFile(
        new URL(
          "./fixtures/v5-canonical/schema3-fifteen-lanes.perkusi.json",
          import.meta.url,
        ),
      ),
    ),
    bytes = new Uint8Array([
      239,
      187,
      191,
      ...new TextEncoder().encode(" \n" + text + "\n"),
    ]),
    json = await importCanonicalFile(new Blob([bytes]), { registry, memory }),
    o = json.project.origins.find((o) => o.kind === "file");
  assert.deepEqual(
    new Uint8Array(await json.originals.get(o.sha256).arrayBuffer()),
    bytes,
  );
  json.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});
test("owned A/B/A pattern edit/clone/undo/redo leaves A, native identities and original bytes unchanged", async () => {
  const f = await specimen(),
    editor = await createCanonicalEditor(f.bundle, {
      registry,
      memory: f.memory,
      controller: { edited: async () => {}, stop: async () => {} },
    }),
    source = f.bundle.project.sourceDefs.find((d) => d.kind === "composition"),
    id = source.id,
    A = source.programme.activePattern,
    originals = JSON.stringify(f.bundle.project.origins);
  await editor.clonePattern(id, "owned-b", "B");
  await editor.setBeatbox(id, "kick", "volume", 0.23);
  await editor.setChain(id, [A, "owned-b", A]);
  const accepted = editor.snapshot().project,
    g = accepted.sourceDefs.find((d) => d.id === id).programme;
  assert.equal(
    g.patterns.find((p) => p.id === "owned-b").beatbox[0].volume,
    0.23,
  );
  assert.notEqual(g.patterns.find((p) => p.id === A).beatbox[0].volume, 0.23);
  assert.deepEqual(g.chain, [A, "owned-b", A]);
  assert.equal(JSON.stringify(accepted.origins), originals);
  await editor.undo();
  assert.notDeepEqual(
    editor.snapshot().project.sourceDefs.find((d) => d.id === id).programme
      .chain,
    g.chain,
  );
  await editor.redo();
  assert.deepEqual(editor.snapshot().project, accepted);
  await assert.rejects(editor.setBeatbox(id, "kick", "volume", 9));
  assert.deepEqual(editor.snapshot().project, accepted);
  await editor.dispose();
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("stale editor candidate and failed cleanup cannot replace accepted history; dispose retries actual ownership", async () => {
  const f = await specimen();
  let acknowledge = false,
    waiter;
  const gate = new Promise((r) => (waiter = r)),
    controller = {
      edited: async () => gate,
      stop: async () => {
        if (!acknowledge) throw Error("still owned");
      },
    },
    editor = await createCanonicalEditor(f.bundle, {
      registry,
      memory: f.memory,
      controller,
    }),
    before = editor.snapshot().project;
  const a = editor.edit((p) => (p.title = "older")),
    b = editor.edit((p) => (p.title = "newer"));
  waiter();
  await assert.rejects(a, (e) => e.code === "cancelled");
  await b;
  assert.equal(editor.snapshot().project.title, "newer");
  assert.equal(before.title, f.bundle.project.title);
  await assert.rejects(editor.dispose());
  assert.ok(f.memory.snapshot().bytes > 0);
  acknowledge = true;
  await editor.dispose();
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
