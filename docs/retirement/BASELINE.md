# Phase A — retirement baseline and Gate A

**Gate A: PASS for review and a small Phase B media-preservation slice only.** No source was removed, no media copied/moved, no QA permanently deleted, no commit/push/deploy performed. V5/V6 remain FAILED/STOPPED; no historical audio investigation or feature implementation resumed. Owner's model settings were not changed; runtime model/effort is not exposed by these tools.

## Authority and verified identity

Read the full 130-line,18,902-byte Library brief `PERKUSI_DOT_V5_V6_RETIREMENT_CLEANUP_2026-10-21.md` (`libfile_0c9e83e7010c81919cdf8cdaf0fbc121`) and the current local handover (27,101bytes, SHA256 `8810ffc2703b1648704d586bb611060071beee9e3c7a6710ccd2fa2a2c70f2b7`). The Library read was complete (`has_more=false`); its readable text was saved in the Phase A evidence folder, not represented as an independently downloaded original.

- Connected laptop: **LAPTOP-P6FN41TC**, project **C:\PerkusiDotCom**.
- Local branch **main**; local HEAD, fresh remote/main and live `/version.json` all **68d289eb03af75eaf071ae1b9c20a5f23194b732**. Tree **4b1ef823dd84db209780425b394a2ecd6bae0720**. Remote fetch/push **https://github.com/andiwijaya/perkusi-com.git**. Ahead/behind0/0.
- Tracked product/source is clean. Existing `.local-candidates/`, `deliverables/`, handover, three V4–V6 working docs and `scripts/__pycache__/` remain untracked; new `docs/retirement/` is audit documentation only. No applicable AGENTS.md or `.agents` directory was found.
- Homepage currently promotes ordinary Studio and Beatbox only. Old Gamelan, Loop, canonical Preview and recovery routes/code still exist; this audit does not treat homepage removal as runtime retirement.
- Fresh initial inventory: **192,998 regular files;134,553,084,135logicalbytes;50,362,941,440unique allocated regular-file bytes;82,768,211,968free bytes on C:**. No junction traversal; private config and directory/MFT overhead excluded. Group allocation is first occurrence by inode, not exclusive per-directory physical use. No Phase A disk saving is claimed.

## Dependency decision

`FILE_PLAN.csv` explicitly lists every one of273 current source files, its category and retain/refactor/remove-after-gates action. `BUILD_ROUTE_PLAN.csv` lists20 build/route/control files. Graph evidence uses Rolldown AST static/re-export/dynamic imports and literal worklet/asset URLs, rendered HTML entries, CSS imports and expanded Vite globs. No unresolved ESM/computed-import references were found in the scanned current source/build scripts. This is conservative file reachability, not a claim of final tree-shaken bundle contents.

| Category | Source files | Disposition |
| --- | ---: | --- |
| LIVE_REQUIRED |58| Preserve stable V1–V3 behavior. Only named integration/UI boundaries need refactor; shared helpers stay unchanged even if failed features import them. |
| LEGACY_RECOVERY_REQUIRED |29| Isolate readonly data export/validation/packaging before failed runtime deletion. |
| FAILED_EXPERIMENT |179| Proposed current-tree removal only after media/recovery and source regression gates. No removal in Phase A. |
| ORPHANED |7| Preserve pending review of tests/engineering usage; orphan is not deletion proof. Includes historical V3 `src/audio/render-qa.js` and six canonical helpers. |
| MEDIA_OR_PROVENANCE |640 initial files outside src|622 internal files plus six QA Suling media files and12 Beatbox masters; all refreshed SHA256 inventory, not moved. |

`FAILED_EXPERIMENT` identifies the approved retired-feature scope and dependency role; it does not claim every individual file has a defect. The orphan list is conservatively retained, including tests/engineering use that still needs review.

Six proposed integration-edge cuts define a **58-file stable target closure**. They are: `src/main.js`→`gamelan/route-studio.js`; `src/studio/main.js`→`canonical-panel.js`, `canonical-workspace.js`, `canonical-route.js`, dynamic `canonical-entry.js`; and dynamic `src/beatbox/main.js`→`canonical-origin.js`. The last path is original-project recovery, so preserve its data capability before detaching it. Preserve V3 `mode-transfer.js`; it is not the same feature as canonical handoff.

Current two-tool file-level reachability is243 source files because optional integrations are still linked. Actual production network inspection of ordinary Studio loaded35 script responses, including **6 canonical-named chunks**. Beatbox loaded13 scripts and no canonical-named chunk on the ordinary URL. Thus hiding cards has not removed failed code from normal Studio loading. Network names supplement, not replace, the exact source graph. No product service-worker registration/cache implementation was found.

The stable target retains all reachable historical V3 modules plus the current site shell and accepted `programme-level.js`/`programme-output.js` loudness behavior. Do not reset the product wholesale to an old V3 snapshot. The three stable `import.meta.glob` bindings resolve **41 WAV files /5,452,684bytes**:12 Beatbox originals,16 Ruang/Arus sounds,13 Fusion/Bilah sounds. These emit through normal Vite asset handling; do not assume they require duplicate public aliases from the Gamelan delivery plugin. Later build changes must verify those media and public license links survive while excluding archived Gamelan/Loop media.

`vite.config.js`, `package.json`, Pages release policy, build wrapper and the Gamelan delivery/alias/source-form plugins still select/package the failed feature routes and banks. Retire/refactor this together with app imports; changing only UI links is insufficient. Preserve the nine existing public/legal/security assets and GA behavior. Current tests are also mapped:158 root test modules,23 stable-test import sets,5 recovery/data-test sets,130 needing review/retirement or assertion splitting alongside failed runtime. Import classification does not authorize discarding mixed stable assertions.

## Initial media and project protection

`MEDIA_INITIAL.csv` includes relative path, format, exact bytes, SHA256, source, role/instrument, sample rate, license/attribution metadata and qualification status. All622 existing internal files were freshly hashed; binary hashes match the retained canonical inventory. The initial list totals **1,190,776,175bytes** across640files, including metadata/source files. Broad filesystem metadata also found59,364 audio/archive/PCM-like paths and8,979 project/package paths; many are duplicated QA fixtures, but **they remain unclassified and protected**, not approved for deletion.

Important additions beyond the earlier handover: `qa-artifacts/v5-suling-source-2026-10-17/candidate-audio-44100.f32le` is present alongside the original WebM, candidate WAV and three diagnostic WAVs. These **six Suling media files total11,650,035bytes**. Twelve original Beatbox 48k masters under `qa-artifacts/s3-2026-10-11/full/masters-48k/` total5,760,528bytes; rendered32k delivery files do not substitute these masters. Root internal assets are currently tracked (622files); future local archive additions must not be automatically published merely because they are under `internal/`.

All12 master hashes match their original pack declarations; `scripts/make-original-groove.py` still exists and matches the declared source-recipe hash. Suling binary hashes were also compared with the retained historical packet manifests; the per-file result is in `ORIGINAL-MEDIA-VERIFICATION.json`.

Suling stays NOT PRODUCTION QUALIFIED; preserve its original CC BY-SA4.0/source/credit evidence. Gamelan registry/cultural/listening status remains qualified only to its recorded scope, not newly certified by this inventory. Preserve licenses, manifests, source forms, pitch/laras metadata, source recipes and original art. **No media was moved or copied in Phase A.**

`RECOVERY_ASSESSMENT.md` maps stable localStorage, Gamelan documents, Loop draft/profile and audio IDB, composition IDB and handoff originals. Dedicated recovery currently has a37-file data closure, with no native/stream/clock/capture audio engine. However it does not expose all Gamelan raw documents or handoff originals; those gaps must be addressed before detaching their UI/routes. Personal browser data presence/content remains UNKNOWN and was not inspected. Never delete/reset it or silently convert schema4–6 to V3.

## Focused baseline evidence

- **124/124** focused stable tests PASS: audio, Beatbox/output, project, Studio/timeline, composition and foundation. Lint PASS.
- Reused the existing official homepage build **776files /1,188,565,742bytes**, without build/copying audio trees. Every emitted file hash was rechecked, and273 current source hashes and Git identity matched the pinned baseline. This was **not a new build**.
- Native browser baseline PASS on local pinned output and live production, each with ID/1366 Chrome155.0.8059.85 and EN/390 Edge155.0.4283.62. Fresh isolated contexts, no personal profile, no mic request, muted output.
- Ordinary Studio: selected pattern and four-slot chain repeat over two boundaries, Pause/Resume/Stop, save/load/refresh and non-silent WAV. Beatbox: three-layer demo repeat over two source boundaries, variant change, Pause/Reset/new demo, save/load/refresh and WAV. All four profiles have no uncaught app/HTTP errors.
- WAVs:48kHz/PCM16,10seconds/480,000frames; ordinary Studio stereo peak≈0.4270, Beatbox mono peak≈0.8732. Hashes/statistics retained in evidence; cross-browser exact PCM identity was not asserted. Raw generated WAV outputs were not copied into new artifact trees.
- Initial QA fixture attempted WAV after Beatbox Reset cleared all layers. Product correctly refused empty export with a visible message. First failure retained; fixture selected a real demo before saving/exporting. Completed local Studio evidence from the first run was reused explicitly; R2 did not relabel the invalid empty fixture as product PASS.
- All owned browser/server sessions closed. Mobile is viewport/touch emulation; physical phones, mic, listening, Safari, full20-control-cycle/longplay and final retirement regression are **NOT RUN/UNVERIFIED in Phase A**. V3 transfer has unit coverage here, not a newly claimed full browser round-trip.

## Rollback and next smallest slice

Verified local Git commit objects: current baseline **68d289eb03af75eaf071ae1b9c20a5f23194b732** and compatible legacy recovery rollback **e6a0aaa9b8c6c50c448cdb28b076c85a898f009e** (tree `ce7e8f41f80fe49ec8ba193d0ad987e06e166617`). R source and its recovery path can be read from Git; existing qualified artifact remains in place. No checkout/worktree/branch reset was performed.

After a future reviewed retirement commit, rollback should use `git revert --no-edit <exact-retirement-commit>` on a clean tracked tree, then the same build/regression/production gates. Preserve canonical media and user stores throughout. A new work branch can be created from the verified baseline in a later slice; do not overwrite existing untracked work. Avoid `reset --hard`, `git clean`, history rewrite, or blindly restoring a stock old editor without recovery. A Git rollback does not restore deleted untracked media, hence media preservation must precede any permanent QA cleanup.

**Recommended next slice B1:** copy—not remove—only the six Suling media files and12 Beatbox masters (17,410,563binarybytes total), plus their necessary original licenses/credits/source metadata, into a local canonical media-library layout. Verify exact before/after hashes and add an explicit archive/build exclusion policy. No activation or new instrument feature. Review that bounded copy/manifest gate first, then B2 isolates readonly export for every experimental storage family. Only after B gates should Phase C detach the six boundaries and retire failed code/tests/routes/build payloads. Any future permanent QA batch still needs its fresh exact approval; prior completed cleanup permissions are not reused.

Evidence: `qa-artifacts/retirement-a-2026-10-21/` contains the authoritative read snapshot, graph, media/size locations, storage/cache references, test imports, source/build/rollback pins, focused logs, failed fixture record, R2 browser result and network script loads. This is an audit/readiness gate, not final deployment acceptance.
