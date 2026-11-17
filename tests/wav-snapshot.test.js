import test from "node:test";
import assert from "node:assert/strict";
import {
  newComposition,
  withPatternLoops,
  newCompositionClip,
} from "../src/project/composition-model.js";
import { wavSnapshotKey } from "../src/project/wav-snapshot.js";
import { StudioWavExporter } from "../src/audio/studio-exporter.js";

test("WAV playback gain rejects invalid values before allocating a native render", async () => {
  const exporter = new StudioWavExporter({
    contextFactory: () => {
      throw Error("must not allocate");
    },
  });
  for (const programmeGain of [-1, 0, 0.5, 17, NaN, Infinity])
    await assert.rejects(
      exporter.render({}, () => {}, null, { programmeGain }),
      (error) => error.code === "exportFailed",
    );
  assert.equal(exporter.active, null);
});

test("WAV remains current when selecting another editor pattern or pad quantization", () => {
  const p = withPatternLoops(newComposition()),
    key = wavSnapshotKey(p);
  p.activePattern = "p2";
  p.timing.quantize = !p.timing.quantize;
  assert.equal(wavSnapshotKey(p), key);
});

test("WAV expires for every audible edit, arrangement length or filename change", () => {
  const original = withPatternLoops(newComposition());
  const mutations = [
    (p) => {
      p.title = "New name";
    },
    (p) => {
      p.pack.id = "arus";
    },
    (p) => {
      p.timing.bpm = 120;
    },
    (p) => {
      p.timing.swing = 0.3;
    },
    (p) => {
      p.master.volume = 0.4;
    },
    (p) => {
      p.tracks[0].volume = 0.4;
    },
    (p) => {
      p.tracks[0].pan = 0.7;
    },
    (p) => {
      p.tracks[0].mute = true;
    },
    (p) => {
      p.tracks[0].solo = true;
    },
    (p) => {
      p.patterns[0].steps.kick[0] = 0.7;
    },
    (p) => {
      p.patterns[0].notes[0] = { pitch: "d4", velocity: 0.5 };
    },
    (p) => {
      p.patterns[0].clips = [
        { ...newCompositionClip("kick"), enabled: true, variant: 2 },
      ];
    },
    (p) => {
      p.chain.push("p1");
    },
  ];
  for (const change of mutations) {
    const next = structuredClone(original);
    change(next);
    assert.notEqual(
      wavSnapshotKey(next),
      wavSnapshotKey(original),
      String(change),
    );
  }
});
