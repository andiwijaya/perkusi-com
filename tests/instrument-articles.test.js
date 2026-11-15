import test from "node:test";
import assert from "node:assert/strict";
import { createArticlePlayer } from "../src/instruments/player.js";
import { instruments } from "../src/instruments/catalog.js";
import { articleContent } from "../src/instruments/content.js";
import { renderDocument } from "../src/app/document.js";

function fixture({ count = 3, duration = 1.2, deferredResume = false } = {}) {
  const starts = [],
    stops = [];
  let resolveResume;
  const resume = new Promise((resolve) => {
    resolveResume = resolve;
  });
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    cancelScheduledValues() {},
  });
  const node = () => ({ connect() {}, disconnect() {}, gain: param() });
  const frames = Math.round(8000 * duration),
    samples = Float32Array.from(
      { length: frames },
      (_, i) => 0.8 * Math.sin(i / 8),
    );
  const context = Object.assign(new EventTarget(), {
    currentTime: 2,
    sampleRate: 8000,
    state: deferredResume ? "suspended" : "running",
    destination: {},
    createGain: node,
    createWaveShaper: node,
    createBufferSource() {
      return {
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {},
        start() {
          starts.push(this);
        },
        stop(when) {
          stops.push(when);
        },
      };
    },
    async decodeAudioData() {
      return {
        length: frames,
        duration,
        numberOfChannels: 1,
        sampleRate: 8000,
        getChannelData: () => samples,
      };
    },
    async resume() {
      if (deferredResume) await resume;
      this.state = "running";
    },
    async close() {
      this.state = "closed";
    },
  });
  const pack = {
    schemaVersion: 1,
    id: "article-fixture",
    kind: "one-shot",
    version: "1",
    bpm: 120,
    beatsPerBar: 4,
    bars: 1,
    key: null,
    stems: Array.from({ length: count }, (_, i) => ({
      id: "note-" + i,
      url: "/note-" + i + ".wav",
      licenseId: "fixture",
      durationSeconds: duration,
      gainTrim: 0.55,
    })),
  };
  const player = createArticlePlayer(
    { pack },
    {
      family: "bass-elektrik",
      contextFactory: () => context,
      bankOptions: {
        fetcher: async () => ({
          ok: true,
          headers: new Headers(),
          arrayBuffer: async () => new ArrayBuffer(1),
        }),
      },
    },
  );
  return { player, starts, stops, context, resolveResume };
}

test("article instruments admit independent notes without treating them as simultaneous loop stems", async () => {
  const f = fixture();
  await f.player.prepare();
  assert(f.player.isReady());
  assert.equal(f.starts.length, 0);
  for (const id of ["note-0", "note-1", "note-2"]) await f.player.play(id);
  assert.equal(f.starts.length, 3);
  assert(f.starts.every((source) => !source.loop));
  assert(f.stops.length >= 2, "bass changes fade earlier notes");
  await f.player.dispose();
  assert.equal(f.context.state, "closed");
  assert.equal(f.player.snapshot().voices, 0);
});

test("long article samples retain their complete tail without autoplay", async () => {
  const f = fixture({ count: 1, duration: 20 });
  await f.player.prepare();
  assert.equal(f.starts.length, 0);
  await f.player.play("note-0");
  assert.equal(f.starts[0].buffer.duration, 20);
  await f.player.dispose();
});

test("Stop fences a pending context resume without canceling prepared samples", async () => {
  const f = fixture({ deferredResume: true });
  await f.player.prepare();
  const pending = f.player.play("note-0");
  f.player.stop();
  f.resolveResume();
  await pending;
  assert.equal(f.starts.length, 0);
  assert(f.player.isReady());
  await f.player.play("note-1");
  assert.equal(f.starts.length, 1);
  await f.player.dispose();
});

test("every instrument has substantive bilingual static reading, credits, original art and matching pads", () => {
  assert.equal(instruments.length, 16);
  assert.equal(
    instruments.reduce((n, i) => n + i.count, 0),
    110,
  );
  for (const instrument of instruments)
    for (const locale of ["id", "en"]) {
      const content = articleContent[instrument.slug][locale];
      assert.equal(content.sections.length, 6);
      const words = [
        content.dek,
        ...content.sections.flatMap((s) => s.paragraphs),
      ]
        .join(" ")
        .split(/\s+/).length;
      assert(words >= 550, instrument.slug + ": substantial reading");
      assert(articleContent[instrument.slug].sources.length >= 3);
      const document = renderDocument(instrument.page, locale);
      assert(document.includes("data-article-schema"));
      assert(document.includes('data-state="idle"'));
      assert(document.includes(instrument.image));
      assert(document.includes('id="article-prepare" disabled'));
      assert.equal(
        (document.match(/data-article-note=/g) || []).length,
        instrument.banks[0].notes.length,
      );
    }
});
