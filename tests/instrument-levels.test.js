import test from "node:test";
import assert from "node:assert/strict";
import { createTrackMixer, trackGain } from "../src/audio/sequencing.js";
import { createCompositionMixer } from "../src/audio/composition.js";
import { INSTRUMENT_BASE_GAIN } from "../src/audio/instrument-levels.js";
import {
  newComposition,
  withPatternLoops,
} from "../src/project/composition-model.js";
import { withKendhang } from "../src/project/kendhang.js";
import { withBass } from "../src/project/bass.js";
import { withGuitar } from "../src/project/guitar.js";
function context() {
  const param = () => ({
    value: 1,
    setTargetAtTime(v) {
      this.value = v;
    },
  });
  const node = () => ({
    gain: param(),
    pan: param(),
    connect() {},
    disconnect() {},
  });
  return {
    currentTime: 0,
    createGain: node,
    createStereoPanner: node,
    createChannelMerger: node,
  };
}
const project = () =>
  withGuitar(withBass(withKendhang(withPatternLoops(newComposition()))));
test("base calibration preserves drum fader ratios, exact silence and pan without rewriting project", () => {
  const p = project(),
    ctx = context(),
    before = structuredClone(p),
    mixer = createTrackMixer(ctx, {}, p.tracks);
  mixer.update(p.tracks, 0, true);
  const original = mixer.nodes.get("kick").gain.gain.value;
  assert(original > p.tracks[0].volume);
  p.tracks[0].volume /= 2;
  p.tracks[0].pan = -0.4;
  mixer.update(p.tracks, 0, false);
  assert.equal(mixer.nodes.get("kick").gain.gain.value, original / 2);
  assert.equal(mixer.nodes.get("kick").pan.pan.value, -0.4);
  p.tracks[0].mute = true;
  mixer.update(p.tracks, 0, true);
  assert.equal(mixer.nodes.get("kick").gain.gain.value, 0);
  assert.equal(trackGain(before.tracks[0], before.tracks), 0.8);
  assert.deepEqual(p.patterns, before.patterns);
  mixer.dispose();
  assert.equal(mixer.nodes.size, 0);
});
test("instrument calibration leaves loop gains and guitar reference unchanged; mute and solo remain authoritative", () => {
  const p = project(),
    original = structuredClone(p),
    ctx = context(),
    mixer = createCompositionMixer(ctx, {}, p);
  assert.equal(mixer.nodes.get("guitar").gain.gain.value, p.guitar.volume);
  assert.equal(mixer.nodes.get("clip-kick").gain.gain.value, 1);
  const level = mixer.nodes.get("bilah").gain.gain.value;
  p.instrument.volume /= 2;
  mixer.update(p, true);
  assert.equal(mixer.nodes.get("bilah").gain.gain.value, level / 2);
  p.instrument.mute = true;
  mixer.update(p, true);
  assert.equal(mixer.nodes.get("bilah").gain.gain.value, 0);
  p.bass.solo = true;
  mixer.update(p, true);
  assert.equal(mixer.nodes.get("guitar").gain.gain.value, 0);
  assert.equal(
    mixer.nodes.get("bass").gain.gain.value,
    p.bass.volume * INSTRUMENT_BASE_GAIN.bass,
  );
  assert.deepEqual(p.patterns, original.patterns);
  assert.deepEqual(p.master, original.master);
  mixer.dispose();
  assert.equal(mixer.nodes.size, 0);
});
test("fixed calibration has no time/sample dependence and cannot boost the strongest guitar reference", () => {
  assert(Object.isFrozen(INSTRUMENT_BASE_GAIN));
  assert.equal(INSTRUMENT_BASE_GAIN.guitar, 1);
  assert(
    Object.values(INSTRUMENT_BASE_GAIN).every(
      (v) => Number.isFinite(v) && v >= 1 && v <= 6,
    ),
  );
  const p = project(),
    ctx = context(),
    mixer = createCompositionMixer(ctx, {}, p),
    before = structuredClone(p);
  for (const now of [0, 60, 3600]) {
    ctx.currentTime = now;
    mixer.update(p, false);
  }
  assert.deepEqual(p, before);
});
