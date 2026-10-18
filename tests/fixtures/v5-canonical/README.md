# Q1 legacy preservation corpus

Original UTF8 files have deliberate leading/trailing whitespace and pinned SHA256/byte lengths in MANIFEST.json. Do not replace an original with normalized JSON. All eight pass unchanged legacy parsers; none is a schema6 fixture masquerading as an old file.

| Fixture | Required preserved facts |
|---|---|
| schema0-beatbox | Six role selections/variants, Unicode title, Master0.17 and four-bar export. |
| schema1-zero-master | Master0, typed pack/timing/tracks and export. |
| schema2-rhythm-ab | A/B/A/B, different cells, swing0.17, quantizefalse, active B, old maximum Master0.75. |
| schema3-fifteen-lanes | Eight percussion +six Beatbox +Bilah; global original controls must become independent per-pattern controls without changing source phase or gains. |
| schema4-multibar | Four-bar A/B/A/B accompaniment, native off-grid strike137/damp960019, versioned Peking source, native mixer and tuning consent. |
| schema4-independent-clocks | Same editable four-bar accompaniment but two-bar native clock; preserve both; current audible-legacy repeat refusal remains. |
| schema5-eq-overdub-alignment | Outer Master1 versus nested0.17, fixed48000/120000-frame bars, two distinct raw recording hashes, layer IDs, EQ[-3,+2,+1]dB, limiter, circular +137/−211 and source/origin/working identity. |
| schema5-nonzero-offset | Master0 and offset137 retained by metadata validation; current portable recording path explicitly refuses recordingOffsetUnsupported. |

`tests/helpers/canonical-fixtures.js` deterministically generates the original cases and synthetic PCM in RAM. No audio fixture file or production sound is retained. `tests/v5-canonical-contract.test.js` also tests the eight-outer-bus/120-inner-lane boundary, metadata describing >16MiB without allocating it, corrupt/missing assets, existing PKLOOP01 roundtrip, quota/abort rollback with a foreign allocation, and per-pattern ownership.

Phase/admission tests execute the new **unwired** helpers at44.1/48k. They establish the declared metadata/transition rules; they do not certify a schema6 parser, new database transaction, native cross-view playback or canonical WAV renderer. The existing source-bound audio-document, overdub and recorded-integration suites supply legacy portable/phase/FX/rollback regression coverage.

Regenerate only deliberately with `node qa-artifacts/v5-q1-contract-2026-10-18/generate-fixtures.mjs`, reviewing bytes, expected facts and manifest together. A future schema6 migration/inverse must compare against this corpus before UI/store dispatch changes.
