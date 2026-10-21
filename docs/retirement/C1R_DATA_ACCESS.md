# C1R — explicit original-data access, ready for independent review

**Local implementation and focused verification complete; publication and source removal remain HOLD.** No production request, commit/push/deploy, source deletion, user-profile access or permanent QA cleanup occurred. The existing complete composition/Loop recovery reader remains; the B2 generic utility remains isolated/unreferenced.

## Access and exact preservation

New build entries `/studio/recovery/originals/` and `/en/studio/recovery/originals/` are independent same-origin data pages. Their only application closure is three JS modules and two CSS files. There is no audio engine, AudioContext, microphone, migration, storage writer or B2 serializer. Reading/downloading requires an action. Links from the old recovery page and Loop notices preserve the same tab, including sessionStorage. These entries are compiled and tested locally, **not live yet**.

`src/project/legacy-raw-recovery.js` exposes only these exact identities:

| Data | Storage | Key | Existing supported contract |
| --- | --- | --- | --- |
| Gamelan workspace | localStorage | `perkusi.workspace.gamelan.v4` |4MiB aggregate envelope |
| Gamelan route/source | sessionStorage | `perkusi.workspace.instrument-route.v4` |3MiB envelope |
| Loop draft, including corrupt raw text | localStorage | `perkusi.loop-station.draft.v5` |2MiB project |
| Loop incoming | sessionStorage | `perkusi.loop-station.incoming.v4` |2MiB project |
| Device profiles | localStorage | `perkusi.loop-station.device-profiles.v1` |8192 bytes |
| Loop audio revision marker | localStorage | `perkusi.loop-station.draft.v5.audio-revision` |original marker string |

Raw strings are never parsed or JSON-reserialized. Well-formed strings download as exact UTF-8 text, preserving whitespace/line endings, empty values, corrupt JSON and future versions. Because `Blob([string])` replaces lone UTF16 surrogates, such strings instead download as explicitly named `.original.utf16le.txt` bytes with BOM and every original code unit. This is an encoding choice, not project conversion. Null means absent, distinct from an empty string. An8MiB-code-unit sanity ceiling refuses oversized raw values without truncation or mutation; existing project contracts are unchanged. Session data must be exported in its original tab; a new tab may not carry it.

`src/project/handoff-recovery.js` lists the existing `perkusi.canonical-handoff.v1` / `transfers` store in32-record pages without a known UUID. It checks `indexedDB.databases()` before `open(name)`, never requests a version, and aborts any creation/upgrade race. Missing DBs are not opened; unsupported discovery refuses. Every transaction is readonly and handles close. Future DB versions with the existing store remain readable without an upgrade.

Original Blob/File bytes download without interpreting the project. Stored row metadata is exported separately with every supported field intact, including prepared/accepted/unknown JSON fields. A separate `sourceBlob` envelope retains actual digest, byte size, MIME, and File name/lastModified when present; stored metadata is not replaced by those observations. Unknown record version or digest mismatch produces an explicitly unverified raw file. No silent conversion occurs. Source Blob limit is the existing44MiB+48-byte package ceiling. Metadata export admits plain JSON up to1MiB/10,000 nodes/depth32; unsupported structured metadata refuses explicitly while its primary original Blob remains independently downloadable. Non-string inbox keys are listed but their download refuses; current inbox contracts use string UUIDs. Browser data is never cleared.

`src/beatbox/canonical-origin.js` keeps its source-download control but now uses the readonly adapter, removing the writer-capable `CanonicalHandoffStore.open()` from that path. Its back link now says export-only recovery and targets the data page with the UUID. Legacy `/studio/?candidate=canonical&handoff=…` and `canonicalOrigin` aliases redirect to the same-origin data page **before** ordinary localization/editor initialization. Normal Studio/Beatbox/V3 mode-transfer functionality remains; no playback method was added.

## Verification and retained failures

- **140/140 focused tests + lint PASS**: the131 C1 tests plus9 explicit data-access tests. They cover actual local/session identities, raw4/3/2MiB maxima, malformed UTF16 code units, missing DB/no open, deletion races/blocked late handles, three-page discovery without duplicates, exact original bytes/all JSON metadata, File descriptors, unsupported/corrupt/over-limit refusal and old-link routing.
- First native cohort completed all ID desktop assertions, including raw six-key export, missing DB, draft without DB, same-tab incoming, raw maxima, malformed UTF16, discovery and handoff links. Its console `PASS id/1366` is retained in the factual first-run record. **Detailed ID raw JSON receipt was lost** when a later EN download promise rejected outside the runner's finalizer; do not represent that as a complete detailed receipt.
- EN diagnosis persisted the six-key/raw-max/same-tab/malformed-UTF16 results, then reproduced metadata-click pointer interception on the mobile viewport. A scoped layout correction wraps long keys/hash text and places controls separately. Native closure then caught a CSS hidden-state regression on More; an explicit hidden rule closed it. Both failures and the rejected artifacts remain. No force-click or guard bypass was used.
- Final artifact native closure: **Chrome ID1366 and Edge EN390 PASS** for missing inbox/no open,67-record discovery across three pages, exact110,155-byte source hash, all stored metadata plus File MIME/name/lastModified, future-version/digest-mismatch raw export, final-key pagination, legacy Studio redirect, retained Beatbox download and repaired back navigation. Actual clicks succeed after source download with no horizontal overflow. Per data-entry/control observations:0 writes/upgrades/AudioContext/mic/remaining handles, and0 object URLs after pagehide. Normal Beatbox may persist its existing locale/draft as before; the harness separates ordinary initialization from the readonly source-control checks. No real user profile was opened.
- Raw cohorts were not repeated after CSS changes. `RAW-REUSE.json` proves the raw adapter and UI source (apart from the scoped CSS import) match the earlier cohort. The final metadata descriptor addition is covered by the final native/File assertions and unit tests. `NATIVE-EN-DIAGNOSIS.json`, `FIRST-RUN-FAILURE.json` and `NATIVE-SEALED.json` document the evidence split honestly. An independent reviewer can decide whether the first ID raw console record needs a narrow receipt replay.

All native work uses fresh owned profiles and localhost. Physical mobile, Safari, listening and peak-memory-at44MiB remain UNVERIFIED. This slice makes no historical playback root-cause/fix claim.

## Build, retained dependencies and next gate

Final managed local subset is `qa-artifacts/retirement-c1r-2026-10-21/build-r4/`:92 files/6,597,452 bytes, build id `d61cac70-1b46-4c91-bc46-1687f1423ea1`, source fingerprint `fc1125626cfd8da05d7ba8515df1443da46f4cca40d5b76418d492eee6449aa0`. Disk/ownership guards are unchanged and all builds explicitly deferred cleanup. No instrument bank/source archives were copied. This remains the nondeployable `retirement-review` subset while held Gamelan routes are outside it; it is not a complete release or browser-download-size claim.

Graph: ordinary54 modules, ordinary Studio34, qualified reader35, original-data entry5, Beatbox handoff3. The35 reader source files and nine registry/manifest JSON remain unchanged. V3 `mode-transfer.js`, original Gamelan/credits HTML, all media and B1 archives remain protected. Old C1 sources changed by this slice are archived in the small `baseline/` mapping; its seal was not rewritten.

`REVISED-PLAN-SEALED.json` explicitly retains `src/audio/render-qa.js` and the23-module engineering closure rooted at `internal/audio/main.js` and `internal/sound-lab/main.js`. Its136 source candidates are **review-only**, not deletion approval. The reviewer's109 test modules/330 references still need assertion classification; no tests were removed or silently discarded.

Next: independently review this data-access slice and the first-ID raw evidence limitation. After acceptance, replace held Gamelan entries with accurate recovery notices, then classify assertions/reachability before approving a narrow Git-backed retirement list. Preserve the existing reader and media throughout. A complete build/regression/publication gate and any exact permanent QA cleanup approval remain separate. Stop here for parent review.
