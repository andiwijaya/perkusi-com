import test from "node:test";
import assert from "node:assert/strict";
import {
  partialTakeStatus,
  recordCopy,
} from "../src/loop-station/record-copy.js";
import { RecordPanel } from "../src/loop-station/record-panel.js";

function suspended(frames = 15423) {
  return {
    take: {
      partial: true,
      frames,
      capacity: 120000,
      sampleRate: 48000,
      startFrame: 258753,
    },
    plan: { startFrame: 258753, endFrame: 378753 },
    outcome: {
      acknowledgedFrames: frames,
      acknowledgedEndFrame: 258753 + frames,
      terminalCause: {
        code: "contextSuspended",
        acknowledgedFramesAtCancel: 12288,
      },
    },
  };
}

test("suspended partial includes a received closing suffix in both languages without changing audio state", () => {
  const s = suspended(),
    original = structuredClone(s);
  for (const locale of ["id", "en"]) {
    const status = partialTakeStatus(s, locale),
      t = recordCopy[locale];
    assert.equal(status.retainedFrames, 15423);
    assert.equal(status.receivedFrames, 15423);
    assert.equal(status.intendedFrames, 120000);
    assert.equal(status.recoveredFrames, 3135);
    assert.equal(status.retainedEndFrame, 274176);
    assert.match(status.text, /0\.321/);
    assert.match(status.text, /5\.712/);
    for (const [label, value] of [
      [t.retainedFrames, 15423],
      [t.receivedFrames, 15423],
      [t.intendedFrames, 120000],
      [t.recoveredFrames, 3135],
    ])
      assert(status.text.includes(`${label}: ${value}`));
    assert(status.text.startsWith(t.partial));
    assert(status.text.endsWith(t.suspended));
    assert.doesNotMatch(
      status.text,
      /not part of this take|tidak termasuk take/,
    );
  }
  assert.deepEqual(s, original);
});

test("received and retained counts can differ; position describes actual retained audio", () => {
  const s = suspended(8192);
  s.outcome.acknowledgedFrames = 12288;
  s.outcome.acknowledgedEndFrame = 271041;
  s.outcome.terminalCause.acknowledgedFramesAtCancel = 8192;
  const status = partialTakeStatus(s, "en");
  assert.equal(status.retainedFrames, 8192);
  assert.equal(status.receivedFrames, 12288);
  assert.equal(status.retainedEndFrame, 266945);
  assert.equal(status.acknowledgedEndFrame, 271041);
  assert.equal(status.recoveredFrames, 0);
  assert.match(status.text, /Frames in take: 8192/);
  assert.match(status.text, /Frames received: 12288/);
  assert.match(status.text, /position 5\.561/);
  assert(!status.text.includes(recordCopy.en.recoveredFrames));
});

test("missing receipt counts stay unavailable rather than inventing zero or a recovered suffix", () => {
  const s = suspended();
  delete s.outcome;
  delete s.plan;
  for (const locale of ["id", "en"]) {
    const status = partialTakeStatus(s, locale),
      t = recordCopy[locale];
    assert.equal(status.receivedFrames, null);
    assert.equal(status.recoveredFrames, null);
    assert.equal(status.intendedFrames, 120000);
    assert(status.text.includes(`${t.receivedFrames}: ${t.unknownCount}`));
    assert(!status.text.includes(t.recoveredFrames));
    assert.doesNotMatch(status.text, /NaN|undefined/);
  }
});

test("partial panel refresh advances received suffix counts, switches locale, and clears stale state for a complete take", () => {
  const element = { hidden: true, textContent: "", dataset: {} };
  let locale = "id";
  const panel = { $: () => element, locale: () => locale },
    update = (s) => RecordPanel.prototype.updatePartialStatus.call(panel, s);
  update(suspended(12288));
  assert.equal(element.hidden, false);
  assert.equal(element.dataset.recoveredFrames, "0");
  update(suspended());
  assert.equal(element.dataset.retainedFrames, "15423");
  assert.equal(element.dataset.receivedFrames, "15423");
  assert.equal(element.dataset.intendedFrames, "120000");
  assert.equal(element.dataset.recoveredFrames, "3135");
  assert.equal(element.dataset.cause, "contextSuspended");
  locale = "en";
  update(suspended());
  assert.match(element.textContent, /^Partial/);
  const complete = suspended(120000);
  complete.take.partial = false;
  update(complete);
  assert.equal(element.hidden, true);
  assert.equal(element.textContent, "");
  assert.deepEqual(element.dataset, {});
  update(null);
  assert.equal(element.hidden, true);
});

test("partial classification survives a full received window and ordinary non-suspend interruption", () => {
  const s = suspended(120000);
  s.take.sampleRate = 44100;
  s.outcome.terminalCause.code = "instrumentInputLost";
  const status = partialTakeStatus(s, "id");
  assert(status.text.startsWith(recordCopy.id.partial));
  assert(status.text.endsWith(recordCopy.id.interrupted));
  assert.equal(s.take.partial, true);
  assert.match(status.text, /2\.721/);
});

test("periodic panel refresh does not rewrite unchanged live status text", () => {
  let text = "",
    writes = 0;
  const element = {
      hidden: true,
      dataset: {},
      get textContent() {
        return text;
      },
      set textContent(value) {
        text = value;
        writes++;
      },
    },
    panel = { $: () => element, locale: () => "en" },
    update = (s) => RecordPanel.prototype.updatePartialStatus.call(panel, s);
  update(suspended());
  update(suspended());
  assert.equal(writes, 1);
  update(null);
  update(null);
  assert.equal(writes, 2);
});
