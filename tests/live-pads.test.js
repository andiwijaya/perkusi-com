import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_PAD_GROUPS,
  renderInstrumentPads,
  shortcutAction,
  initLivePads,
} from "../src/studio/live-pads.js";
import { STUDIO_ROLES } from "../src/project/studio-model.js";
const keyboard = (key, extra = {}) => ({
  key,
  target: { closest: () => null },
  ...extra,
});
test("live-pad registry has unique pitch/key identities and accessible bilingual groups", () => {
  const keys = LIVE_PAD_GROUPS.flatMap((g) => g.keys),
    ids = LIVE_PAD_GROUPS.flatMap((g) =>
      g.pitches.map((p) => g.family + ":" + p),
    );
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(ids).size, ids.length);
  for (const lang of ["id", "en"]) {
    const html = renderInstrumentPads(lang);
    assert.equal((html.match(/data-live-pad=/g) || []).length, ids.length);
    for (const g of LIVE_PAD_GROUPS) {
      assert(html.includes(g[lang]));
      for (const p of g.pitches)
        assert(html.includes(`data-live-pad="${g.family}:${p}"`));
    }
    assert.equal((html.match(/aria-keyshortcuts=/g) || []).length, ids.length);
  }
});
test("drum shortcuts and each available instrument route to their existing family", () => {
  for (let i = 1; i <= 8; i++)
    assert.deepEqual(shortcutAction(keyboard(String(i))), {
      family: "drum",
      pitch: STUDIO_ROLES[i - 1],
    });
  for (const g of LIVE_PAD_GROUPS)
    for (let i = 0; i < g.keys.length; i++)
      assert.deepEqual(
        shortcutAction(keyboard(g.keys[i].toUpperCase()), { insidePads: true }),
        { family: g.family, pitch: g.pitches[i] },
      );
  assert.equal(shortcutAction(keyboard("9")), null);
  assert.equal(shortcutAction(keyboard("z")), null);
  assert.deepEqual(shortcutAction(keyboard("z"), { insidePads: true }), {
    family: "bilah",
    pitch: "d4",
  });
  assert.equal(
    shortcutAction(keyboard("z", { shiftKey: true }), { insidePads: true }),
    null,
  );
});
test("shortcuts respect typing, dialog, busy, modifiers, prior handling and repeat", () => {
  for (const field of [
    "ctrlKey",
    "metaKey",
    "altKey",
    "shiftKey",
    "repeat",
    "defaultPrevented",
  ])
    assert.equal(shortcutAction(keyboard("a", { [field]: true })), null);
  for (const state of [{ locked: true }, { dialogOpen: true }])
    assert.equal(shortcutAction(keyboard("a"), state), null);
  assert.equal(
    shortcutAction(keyboard("a", { target: { isContentEditable: true } })),
    null,
  );
  assert.equal(
    shortcutAction(keyboard("a", { target: { closest: () => ({}) } })),
    null,
  );
});
class Button {
  constructor(family, pitch) {
    this.dataset =
      family === "drum" ? { stPad: pitch } : { livePad: family + ":" + pitch };
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = {
      add: (k) => this.classes.add(k),
      remove: (k) => this.classes.delete(k),
      toggle: (k, v) => (v ? this.classes.add(k) : this.classes.delete(k)),
    };
    this.disabled = false;
  }
  closest(selector) {
    return selector === "button.st-pad" ? this : null;
  }
  focus() {}
  setPointerCapture() {}
  setAttribute(k, v) {
    this.attributes.set(k, v);
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }
}
function harness(options = {}) {
  const buttons = [
      new Button("drum", "kick"),
      new Button("kendhang", "tak"),
      new Button("kendhang", "thung"),
      new Button("bilah", "d4"),
    ],
    panel = new EventTarget(),
    doc = new EventTarget(),
    win = new EventTarget();
  let locked = false;
  const calls = [],
    errors = [];
  Object.assign(panel, {
    contains: (b) => buttons.includes(b),
    querySelector: (s) =>
      buttons.find((b) => s.includes(b.dataset.livePad || b.dataset.stPad)),
    querySelectorAll: () => buttons,
  });
  Object.assign(doc, { defaultView: win, querySelector: () => null });
  const root = { ownerDocument: doc, querySelector: () => panel },
    controller = initLivePads({
      root,
      playDrum: (p) => calls.push(["drum", p]),
      playInstrument: (f, p) => calls.push([f, p]),
      locked: () => locked,
      onError: (e) => errors.push(e),
      ...options,
    });
  return {
    buttons,
    panel,
    doc,
    win,
    calls,
    errors,
    controller,
    setLocked: (v) => (locked = v),
  };
}
function send(target, type, node, props = {}) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, props);
  Object.defineProperty(e, "target", { value: node });
  target.dispatchEvent(e);
  return e;
}
test("multitouch is single-trigger per pointer, synthesized clicks do not duplicate, cancel clears visual ownership", () => {
  const h = harness(),
    b = h.buttons[1];
  send(h.panel, "pointerdown", b, { button: 0, pointerId: 1 });
  send(h.panel, "pointerdown", b, { button: 0, pointerId: 1 });
  send(h.panel, "click", b, { detail: 1, pointerType: "touch" });
  assert.equal(h.calls.length, 1);
  send(h.panel, "pointerdown", h.buttons[2], { button: 0, pointerId: 2 });
  assert.equal(h.calls.length, 2);
  send(h.panel, "pointercancel", b, { pointerId: 1 });
  assert(!b.classes.has("st-pressed"));
  assert(h.buttons[2].classes.has("st-pressed"));
  send(h.win, "blur", null);
  assert(!h.buttons[2].classes.has("st-pressed"));
  h.controller.dispose();
});
test("Bilah outside the pad panel is opt-in for standalone; Studio and typing guards stay unchanged", () => {
  const outside = { closest: () => null };
  const studio = harness();
  send(studio.doc, "keydown", outside, { key: "z", code: "KeyZ" });
  assert.equal(studio.calls.length, 0);
  studio.controller.dispose();
  const standalone = harness({ bilahAnywhere: true });
  send(standalone.doc, "keydown", outside, { key: "z", code: "KeyZ" });
  send(standalone.doc, "keyup", outside, { key: "z", code: "KeyZ" });
  assert.deepEqual(standalone.calls, [["bilah", "d4"]]);
  send(
    standalone.doc,
    "keydown",
    { closest: () => ({}) },
    { key: "z", code: "KeyZ" },
  );
  assert.equal(standalone.calls.length, 1);
  standalone.controller.dispose();
});
test("key ownership rejects repeated downs; Enter/Space activation suppresses native duplicate and modifiers", () => {
  const h = harness(),
    b = h.buttons[1];
  for (const extra of [{}, { repeat: true }, {}])
    send(h.doc, "keydown", b, { key: "a", code: "KeyA", ...extra });
  assert.equal(h.calls.length, 1);
  send(h.doc, "keyup", b, { key: "a", code: "KeyA" });
  const e = send(h.doc, "keydown", b, { key: "Enter", code: "Enter" });
  assert(e.defaultPrevented);
  assert.equal(h.calls.length, 2);
  send(h.doc, "keyup", b, { key: "Enter", code: "Enter" });
  for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"])
    send(h.doc, "keydown", b, {
      key: "Enter",
      code: "Enter",
      [modifier]: true,
    });
  assert.equal(h.calls.length, 2);
  h.controller.dispose();
});
test("busy/dispose release visuals and abort all input listeners without touching audio ownership", () => {
  const h = harness(),
    b = h.buttons[1];
  send(h.panel, "pointerdown", b, { button: 0, pointerId: 1 });
  h.setLocked(true);
  h.controller.update();
  assert(b.disabled);
  assert(!b.classes.has("st-pressed"));
  send(h.panel, "pointerdown", b, { button: 0, pointerId: 2 });
  assert.equal(h.calls.length, 1);
  h.controller.dispose();
  h.setLocked(false);
  b.disabled = false;
  send(h.panel, "pointerdown", b, { button: 0, pointerId: 3 });
  send(h.doc, "keydown", b, { key: "a", code: "KeyA" });
  assert.equal(h.calls.length, 1);
  assert.equal(h.errors.length, 0);
});
