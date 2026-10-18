import test from "node:test";
import assert from "node:assert/strict";
import { FinalPanel } from "../src/loop-station/final-panel.js";
import { AudioMemory } from "../src/audio/audio-memory.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function setup(t, { maxBytes = 1024 * 1024 } = {}) {
  const saved = Object.fromEntries(
    ["navigator", "document", "setTimeout", "clearTimeout", "File"].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  const create = URL.createObjectURL,
    revoke = URL.revokeObjectURL;
  const urls = new Map(),
    timers = new Map(),
    downloads = [];
  let sequence = 0;
  const setGlobal = (k, value) =>
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value,
    });
  setGlobal("navigator", {});
  setGlobal("document", {
    createElement: () => ({
      click() {
        downloads.push({ blob: urls.get(this.href), name: this.download });
      },
    }),
  });
  setGlobal("setTimeout", (fn) => {
    const id = ++sequence;
    timers.set(id, fn);
    return id;
  });
  setGlobal("clearTimeout", (id) => timers.delete(id));
  URL.createObjectURL = (blob) => {
    const url = "blob:unit/" + ++sequence;
    urls.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => urls.delete(url);
  t.after(() => {
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    for (const [k, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, k, descriptor);
      else delete globalThis[k];
    }
  });
  const memory = new AudioMemory({ maxBytes });
  const owner = {
    memory,
    producers: new Map(),
    requireDisposition() {},
    hasTakeWork: () => false,
  };
  const exporter = {
    cancel: async () => {},
    render: async () => {
      throw Error("unsupplied render");
    },
  };
  const panel = new FinalPanel({
    owner,
    exporter,
    project: () => ({}),
    locale: () => "en",
    busy: () => false,
    refresh: () => panel.update(),
  });
  function result(text, bars = 4) {
    const blob = new Blob([text], { type: "audio/wav" }),
      bytes = blob.size * 2 + 256,
      lease = memory.reserve(bytes, "unit-ready-WAV");
    return {
      blob,
      stats: { bars },
      bytes,
      releases: 0,
      release() {
        assert.equal(this.releases++, 0, "release exactly once");
        this.blob = null;
        lease.release();
      },
    };
  }
  return {
    panel,
    memory,
    exporter,
    result,
    downloads,
    urls,
    timers,
    setGlobal,
    expire() {
      for (const fn of [...timers.values()]) fn();
    },
  };
}

test("Share4 -> Clear -> Render8 -> rejection suppresses stale fallback and retains original accounting until settlement", async (t) => {
  const h = setup(t),
    { panel: p, memory } = h,
    d = deferred();
  p.ready = h.result("FOUR", 4);
  const old = p.ready;
  let file;
  navigator.canShare = () => true;
  navigator.share = ({ files }) => {
    file = files[0];
    return d.promise;
  };
  const pending = p.share();
  assert.equal(file.name, "perkusi-final-4bar.wav");
  assert.equal(await file.text(), "FOUR");
  const held = old.bytes + file.size + 8192;
  assert.equal(memory.snapshot().bytes, held);
  p.release();
  assert.equal(old.releases, 0);
  assert.equal(memory.snapshot().bytes, held);
  const next = h.result("EIGHT", 8);
  h.exporter.render = async () => next;
  p.bars = 8;
  await p.render();
  assert.equal(p.ready, next);
  assert.equal(memory.snapshot().bytes, held + next.bytes);
  const before = memory.snapshot().bytes;
  await assert.rejects(p.share(), /finalShareBusy/);
  assert.equal(memory.snapshot().bytes, before);
  d.reject(Object.assign(Error("denied"), { name: "NotAllowedError" }));
  await pending;
  assert.deepEqual(h.downloads, []);
  assert.equal(p.ready, next);
  assert.equal(p.message, "");
  assert.equal(old.releases, 1);
  assert.equal(memory.snapshot().bytes, next.bytes);
  assert.equal(p.shares.size, 0);
  assert.equal(p.pins.size, 0);
  p.release();
  assert.equal(memory.snapshot().bytes, 0);
});

test("ordinary native rejection downloads the captured file and keeps URL/result ownership until explicit disposal", async (t) => {
  const h = setup(t),
    p = h.panel,
    d = deferred();
  p.ready = h.result("ORIGINAL", 4);
  const original = p.ready;
  navigator.canShare = () => true;
  navigator.share = () => d.promise;
  const pending = p.share();
  d.reject(Error("failed"));
  await pending;
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].name, "perkusi-final-4bar.wav");
  assert.equal(await h.downloads[0].blob.text(), "ORIGINAL");
  assert.equal(p.ready, original);
  assert.equal(h.memory.snapshot().bytes, original.bytes);
  assert.equal(p.pins.get(original), 1);
  assert.equal(p.shares.size, 0);
  p.release();
  assert.equal(original.releases, 1);
  assert.equal(h.urls.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.memory.snapshot().bytes, 0);
  h.expire();
  assert.equal(original.releases, 1);
});

for (const capability of ["unsupported", "missing", "throws"])
  test(`Share capability ${capability} falls back to the same WAV and releases File reservation`, async (t) => {
    const h = setup(t),
      p = h.panel;
    p.ready = h.result(capability);
    if (capability === "unsupported") navigator.canShare = () => false;
    if (capability === "throws")
      navigator.canShare = () => {
        throw Error("capability failed");
      };
    await p.share();
    assert.equal(await h.downloads[0].blob.text(), capability);
    assert.equal(h.memory.snapshot().bytes, p.ready.bytes);
    assert.equal(p.shares.size, 0);
    h.expire();
    assert.equal(p.pins.size, 0);
    p.release();
    assert.equal(h.memory.snapshot().bytes, 0);
  });

for (const outcome of ["success", "AbortError", "NotAllowedError"])
  test(`Clear during pending Share ${outcome} keeps ownership until actual settlement, without stale download`, async (t) => {
    const h = setup(t),
      p = h.panel,
      d = deferred();
    p.ready = h.result(outcome);
    const original = p.ready;
    navigator.canShare = () => true;
    navigator.share = () => d.promise;
    const pending = p.share();
    p.release();
    p.release();
    assert.equal(original.releases, 0);
    assert.ok(h.memory.snapshot().bytes >= original.bytes + 8192);
    if (outcome === "success") d.resolve();
    else d.reject(Object.assign(Error(outcome), { name: outcome }));
    await pending;
    assert.equal(original.releases, 1);
    assert.deepEqual(h.downloads, []);
    assert.equal(h.memory.snapshot().bytes, 0);
  });

test("AbortError and success preserve current ready, release only operation-owned bytes and allow subsequent Share", async (t) => {
  const h = setup(t),
    p = h.panel;
  p.ready = h.result("KEPT");
  const original = p.ready;
  navigator.canShare = () => true;
  navigator.share = async () => {
    throw Object.assign(Error("cancel"), { name: "AbortError" });
  };
  await p.share();
  assert.equal(p.ready, original);
  assert.equal(original.releases, 0);
  assert.equal(h.memory.snapshot().bytes, original.bytes);
  navigator.share = async () => {};
  await p.share();
  assert.equal(p.ready, original);
  assert.deepEqual(h.downloads, []);
  assert.equal(p.shares.size, 0);
  p.release();
  assert.equal(h.memory.snapshot().bytes, 0);
});

test("close invalidates Share synchronously before render cancellation yields; a hanging native share remains accounted", async (t) => {
  const h = setup(t),
    p = h.panel,
    d = deferred(),
    cancel = deferred();
  p.ready = h.result("CLOSE");
  const original = p.ready;
  navigator.canShare = () => true;
  navigator.share = () => d.promise;
  const pending = p.share();
  h.exporter.cancel = () => cancel.promise;
  const closing = p.close();
  assert.equal(p.ready, null);
  assert.equal(original.releases, 0);
  assert.ok(h.memory.snapshot().bytes > original.bytes);
  d.reject(Error("late failure"));
  await pending;
  assert.deepEqual(h.downloads, []);
  assert.equal(h.memory.snapshot().bytes, 0);
  assert.equal(original.releases, 1);
  cancel.resolve();
  await closing;
  await p.close();
  assert.equal(original.releases, 1);
});

test("close can finish audio disposal before native Share; later settlement drops its accounting with no fallback", async (t) => {
  const h = setup(t),
    p = h.panel,
    d = deferred();
  p.ready = h.result("NAVIGATION");
  const original = p.ready;
  navigator.canShare = () => true;
  navigator.share = () => d.promise;
  const pending = p.share();
  await p.close();
  assert.equal(original.releases, 0);
  assert.ok(h.memory.snapshot().bytes > original.bytes);
  assert.equal(p.shares.size, 1);
  d.reject(Error("after navigation"));
  await pending;
  assert.deepEqual(h.downloads, []);
  assert.equal(h.memory.snapshot().bytes, 0);
});

test("late render resolution after close cannot publish a new ready result", async (t) => {
  const h = setup(t),
    p = h.panel,
    d = deferred();
  h.exporter.render = () => d.promise;
  const rendering = p.render();
  await p.close();
  const late = h.result("LATE");
  d.resolve(late);
  await rendering;
  assert.equal(p.ready, null);
  assert.equal(late.releases, 1);
  assert.equal(p.pending, false);
  assert.equal(h.memory.snapshot().bytes, 0);
});

test("Share allocation refusal preserves ready and prevents native API entry", async (t) => {
  const h = setup(t, { maxBytes: 8500 }),
    p = h.panel;
  p.ready = h.result("X".repeat(100));
  let calls = 0;
  navigator.canShare = () => {
    calls++;
    return true;
  };
  await assert.rejects(p.share(), /combinedMemoryLimit/);
  assert.equal(calls, 0);
  assert.equal(p.shares.size, 0);
  assert.equal(p.pins.size, 0);
  assert.equal(h.memory.snapshot().bytes, p.ready.bytes);
  p.release();
  assert.equal(h.memory.snapshot().bytes, 0);
});

test("File construction failure releases temporary accounting and preserves ready", async (t) => {
  const h = setup(t),
    p = h.panel;
  p.ready = h.result("FILE");
  h.setGlobal(
    "File",
    class {
      constructor() {
        throw Error("file construction");
      }
    },
  );
  await assert.rejects(p.share(), /file construction/);
  assert.equal(p.shares.size, 0);
  assert.equal(p.pins.size, 0);
  assert.equal(h.memory.snapshot().bytes, p.ready.bytes);
  p.release();
  assert.equal(h.memory.snapshot().bytes, 0);
});

test("download URL failure releases its pin without releasing current ready early", (t) => {
  const h = setup(t),
    p = h.panel;
  p.ready = h.result("URL");
  URL.createObjectURL = () => {
    throw Error("URL failed");
  };
  assert.throws(() => p.download(), /URL failed/);
  assert.equal(p.pins.size, 0);
  assert.equal(h.memory.snapshot().bytes, p.ready.bytes);
  p.release();
  assert.equal(h.memory.snapshot().bytes, 0);
});
