import test from "node:test";
import assert from "node:assert/strict";
import { createPadOwner } from "../src/pads/owner.js";
import { renderPadStation, padMessages } from "../src/pads/page.js";
import { renderPadGroups } from "../src/studio/live-pads.js";
import { renderExtraButtons } from "../src/pads/extra-page.js";
import { renderDocument } from "../src/app/document.js";
import { pagePath, pageFromPath } from "../src/app/routes.js";
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function setup() {
  const context = new EventTarget();
  context.state = "running";
  const calls = [],
    statuses = [],
    jobs = [];
  const engine = {
    context,
    operation: 0,
    error: null,
    triggerPad(p) {
      calls.push(["drum", p]);
      return jobs.shift()?.promise;
    },
    rewind() {
      this.operation++;
      calls.push(["stop"]);
    },
    setVolume(v) {
      calls.push(["volume", v]);
    },
    dispose() {
      calls.push(["dispose"]);
      return Promise.resolve();
    },
    play() {
      throw Error("Pad Station must not start transport");
    },
  };
  const playback = {
    configure(config) {
      calls.push(["config", config]);
    },
    pad(p, family) {
      calls.push([family, p]);
      return jobs.shift()?.promise;
    },
  };
  return {
    owner: createPadOwner({
      engine,
      playback,
      onStatus: (s) => statuses.push(s),
    }),
    engine,
    context,
    calls,
    statuses,
    jobs,
  };
}
test("standalone retains 21 core pads plus two isolated Kethuk strikes without score/recording UI", () => {
  assert.deepEqual(Object.keys(padMessages.id), Object.keys(padMessages.en));
  for (const locale of ["id", "en"]) {
    const html = renderPadStation(locale);
    assert(
      !html.includes('style="'),
      "Pad layout must work under production style-src self",
    );
    assert.equal((html.match(/class="st-pad"/g) || []).length, 21);
    assert.equal((html.match(/<button disabled/g) || []).length, 21);
    assert.equal((html.match(/class="st-pad ps-extra-pad"/g) || []).length, 2);
    assert(html.includes("KETHUK_KtPL6.wav") && html.includes("Artistic 2.0"));
    assert(
      html.includes('value="kempyang"') && html.includes("KEMPYANG_KpSL1.wav"),
    );
    const kempyang = renderExtraButtons("kempyang");
    assert(kempyang.includes("Slendro 1") && !kempyang.includes("Slendro 2"));
    assert.throws(() => renderExtraButtons("unknown"));
    assert(html.includes("CC BY") && html.includes("CC0"));
    assert(
      !/st-play|st-pattern|st-file|st-render|st-quantize|sequencer|data-st-step/.test(
        html,
      ),
    );
    assert.equal(
      (renderPadGroups(locale).match(/data-st-pad=/g) || []).length,
      8,
    );
    assert(!renderPadGroups(locale).includes("extra:"));
  }
});
test("homepage and navigation expose a new localized Pad Station card and retain the two existing tools", () => {
  for (const locale of ["id", "en"]) {
    const html = renderDocument("home", locale);
    assert.equal((html.match(/class="tool-card"/g) || []).length, 3);
    assert(html.includes("data-pad-station-card"));
    for (const key of [
      "home.card1.title",
      "home.card3.title",
      "home.pads.title",
    ])
      assert(html.includes(`data-i18n="${key}"`));
    assert(
      !/candidate=canonical|data-v5-loop-card|data-gamelan-link/.test(html),
    );
    assert.equal(pageFromPath(pagePath("pads", locale)), "pads");
    const page = renderDocument("pads", locale);
    assert(page.includes('href="/src/pads/style.css"'));
    assert(
      page.includes(`href="https://perkusi.com${pagePath("pads", locale)}"`),
    );
  }
});
test("owner configures immediate pads without loading, transport, persistence or exporter", async () => {
  const f = setup();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1].timing.quantize, false);
  assert(f.calls[0][1].patterns.every((p) => !p.clips.length));
  for (const [family, pitch] of [
    ["drum", "kick"],
    ["bilah", "d4"],
    ["kendhang", "tak"],
    ["bass", "e1"],
    ["guitar", "b2"],
  ])
    await f.owner.play(family, pitch);
  assert.deepEqual(f.calls.slice(1), [
    ["drum", "kick"],
    ["bilah", "d4"],
    ["kendhang", "tak"],
    ["bass", "e1"],
    ["guitar", "b2"],
  ]);
  assert.equal(f.statuses.at(-1), "ready");
});
test("master remembers level while muted, validates bounds and stays inert after dispose", async () => {
  const f = setup();
  f.owner.setMaster(0.4);
  f.owner.setMuted(true);
  f.owner.setMaster(0.6);
  f.owner.setMuted(false);
  assert.deepEqual(f.calls.slice(1), [
    ["volume", 0.4],
    ["volume", 0],
    ["volume", 0],
    ["volume", 0.6],
  ]);
  for (const x of [-1, 1, NaN, Infinity])
    assert.throws(() => f.owner.setMaster(x));
  const a = f.owner.dispose(),
    b = f.owner.dispose();
  assert.equal(a, b);
  await a;
  await f.owner.play("bass", "e1");
  f.owner.stop();
  f.owner.setMaster(0.2);
  assert.equal(f.calls.filter((c) => c[0] === "dispose").length, 1);
  assert.equal(f.calls.at(-1)[0], "dispose");
});
test("obsolete completion/rejection cannot overwrite Stop or a newer loading/ready view", async () => {
  const f = setup(),
    old = deferred(),
    fresh = deferred();
  f.jobs.push(old, fresh);
  const p = f.owner.play("bass", "e1");
  f.owner.stop();
  const q = f.owner.play("guitar", "b2");
  old.reject(Error("obsolete"));
  await p;
  assert.equal(f.statuses.at(-1), "loading");
  fresh.resolve();
  await q;
  assert.equal(f.statuses.at(-1), "ready");
  assert(!f.statuses.includes("error"));
});
test("current failure is visible; interruption resets view; disposal detaches context listener", async () => {
  const f = setup(),
    job = deferred();
  f.jobs.push(job);
  const p = f.owner.play("drum", "kick");
  job.reject(Error("current"));
  await p;
  assert.equal(f.statuses.at(-1), "error");
  f.context.state = "suspended";
  f.context.dispatchEvent(new Event("statechange"));
  assert.equal(f.statuses.at(-1), "stopped");
  await f.owner.dispose();
  const n = f.statuses.length;
  f.context.state = "closed";
  f.context.dispatchEvent(new Event("statechange"));
  assert.equal(f.statuses.length, n);
});
