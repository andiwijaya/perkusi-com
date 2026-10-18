import test from "node:test";
import assert from "node:assert/strict";
import { leaveInstrumentWorkspace } from "../src/gamelan/v5-navigation.js";
import { renderSiteShell } from "../src/app/site-shell.js";

function fixture({ busy = false, saved = true, cleanup = true } = {}) {
  const events = [];
  const project = Object.freeze({
    originalJSON: ' { "schemaVersion": 4 }\n',
    tuning: "pelog",
    events: ["strike", "damp"],
  });
  const options = {
    session: {
      project,
      async prepareStudio() {
        events.push("prepare");
      },
      async dispose() {
        events.push("dispose");
        if (!cleanup) throw Error("closing");
      },
    },
    blocked: () => busy,
    flushDraft: () => {
      events.push("flush");
      return saved;
    },
    releaseOutputs: () => events.push("release"),
    navigate: (href) => events.push(href),
  };
  return { options, events, project };
}
test("workspace links cannot discard an active capture or draft that failed to save", async () => {
  for (const [config, code, expected] of [
    [{ busy: true }, "recordBusy", []],
    [{ saved: false }, "routeConflict", ["prepare", "flush"]],
  ]) {
    const f = fixture(config);
    const before = JSON.stringify(f.project);
    await assert.rejects(leaveInstrumentWorkspace(f.options, "/?lang=id"), {
      code,
    });
    assert.deepEqual(f.events, expected);
    assert.equal(JSON.stringify(f.options.session.project), before);
  }
});
test("cleanup failure retains project outputs and prevents page navigation", async () => {
  const f = fixture({ cleanup: false });
  await assert.rejects(leaveInstrumentWorkspace(f.options, "/en/"), {
    code: "routeCleanup",
  });
  assert.deepEqual(f.events, ["prepare", "flush", "dispose"]);
  assert.equal(f.options.session.project, f.project);
});
test("successful departure saves before closing its owner and navigating, preserving exact project text", async () => {
  const f = fixture(),
    before = JSON.stringify(f.project);
  await leaveInstrumentWorkspace(f.options, "/?lang=id");
  assert.deepEqual(f.events, [
    "prepare",
    "flush",
    "dispose",
    "release",
    "/?lang=id",
  ]);
  assert.equal(JSON.stringify(f.project), before);
});
test("shared brand keeps explicit Indonesian home and English home while Gamelan locale links retain workspace", () => {
  const id = renderSiteShell("studio", "id", {
    languageHref: (lang) => "/studio/?workspace=gamelan&lang=" + lang,
  });
  const en = renderSiteShell("studio", "en");
  assert.match(id.brand, /href="\/\?lang=id"/);
  assert.match(en.brand, /href="\/en\/"/);
  assert.match(
    id.header,
    /data-locale="en" href="\/studio\/\?workspace=gamelan&lang=en"/,
  );
  assert.match(id.header, /<a class="brand"[^>]*aria-label=/);
  assert.match(id.header, /aria-controls="navigation"/);
});

test("home pauses an active replay before prepare, but a busy capture still refuses before pause", async () => {
  const f = fixture();
  f.options.session.snapshot = () => ({ replaying: true });
  f.options.session.pause = () => f.events.push("pause");
  await leaveInstrumentWorkspace(f.options, "/?lang=id");
  assert.deepEqual(f.events, [
    "pause",
    "prepare",
    "flush",
    "dispose",
    "release",
    "/?lang=id",
  ]);
  const busy = fixture({ busy: true });
  busy.options.session.snapshot = () => ({ replaying: true });
  busy.options.session.pause = () => busy.events.push("pause");
  await assert.rejects(leaveInstrumentWorkspace(busy.options, "/"), {
    code: "recordBusy",
  });
  assert.deepEqual(busy.events, []);
});
