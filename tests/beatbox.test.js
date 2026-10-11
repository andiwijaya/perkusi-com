import test from "node:test";
import assert from "node:assert/strict";
import { renderDocument } from "../src/app/document.js";
import { beatboxMessages } from "../src/beatbox/messages.js";
import { focusScrollDelta } from "../src/beatbox/focus-visibility.js";
test("Beatbox ID/EN copy and role parity; static output retains accessible disabled controls and candidacy disclosure", () => {
  assert.deepEqual(
    Object.keys(beatboxMessages.id).sort(),
    Object.keys(beatboxMessages.en).sort(),
  );
  assert.deepEqual(
    Object.keys(beatboxMessages.id.roles),
    Object.keys(beatboxMessages.en.roles),
  );
  for (const locale of ["id", "en"]) {
    const html = renderDocument("beatbox", locale),
      copy = beatboxMessages[locale];
    assert.equal((html.match(/class="character"/g) || []).length, 6);
    assert.equal((html.match(/data-variant-role=/g) || []).length, 12);
    assert(html.includes(`<noscript>${copy.jsRequired}</noscript>`));
    assert(html.includes(copy.soundNote));
    assert(html.includes('aria-live="polite"'));
    assert(html.includes('href="/src/beatbox/style.css"'));
    assert(
      html.includes('id="bb-play" class="bb-primary" type="button" disabled'),
    );
  }
});

test("P2-S4-02 focus scroll clears the actual sticky panel plus outline for both reported portrait rectangles", () => {
  for (const [height, top, bottom, panelTop, panelBottom] of [
    [700, 636.625, 680.625, 551, 692],
    [844, 744.65625, 788.65625, 697, 836],
  ]) {
    const target = { left: 62, right: 106, top, bottom },
      panel = { left: 20, right: 370, top: panelTop, bottom: panelBottom };
    const delta = focusScrollDelta(target, panel, height);
    assert(top - delta >= 12);
    assert(bottom - delta <= panelTop - 12);
    assert.equal(
      focusScrollDelta(
        { ...target, top: top - delta, bottom: bottom - delta },
        panel,
        height,
      ),
      0,
    );
  }
});
test("P2-S4-02 reverse focus and moved/offscreen panels use current viewport geometry", () => {
  const target = { left: 100, right: 144, top: -8, bottom: 36 },
    panel = { left: 20, right: 760, top: 280, bottom: 382 };
  const up = focusScrollDelta(target, panel, 390);
  assert.equal(target.top - up, 12);
  const below = { ...target, top: 300, bottom: 344 };
  assert.equal(focusScrollDelta(below, panel, 390), 76);
  const hidden = { ...panel, top: -140, bottom: -10 };
  assert.equal(focusScrollDelta(below, hidden, 390), 0);
});
