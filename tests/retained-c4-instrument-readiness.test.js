// Media/legal provenance remains protected independently of retired WAV rendering.
import test from "node:test";
import assert from "node:assert/strict";
import {
  gamelanWavAttribution,
  sourceQualityPending,
} from "../src/gamelan/attribution.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  instrumentDemo,
  INSTRUMENT_DEMOS,
} from "./helpers/archived-gamelan-data.js";
import c from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
test("archived provenance identifies all referenced source works even when stored metadata is muted", () => {
  const r = new InstrumentRegistry(c.banks);
  for (const d of INSTRUMENT_DEMOS) {
    const p = instrumentDemo(d.id, r),
      notice = gamelanWavAttribution(p);
    assert(Buffer.byteLength(notice) < 65535);
    const ids = new Set(
      p.events.filter((e) => e.action === "strike").map((e) => e.sampleId),
    );
    for (const id of ids) {
      assert(notice.includes("sounds/" + id.slice(3) + "/"));
      assert.equal(sourceQualityPending(id), false);
    }
    const muted = structuredClone(p);
    muted.instrumentMix = [
      {
        bankId: "cdm-" + d.laras,
        instrumentId: "saron-barung",
        volume: 1,
        pan: 0,
        mute: true,
        solo: false,
      },
    ];
    assert.equal(gamelanWavAttribution(muted), notice);
  }
  assert.match(gamelanWavAttribution({ events: [] }), /CC0/);
});
