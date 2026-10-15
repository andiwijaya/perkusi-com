# V4 local route/build/delivery boundary

This is a bounded integration candidate after independently accepted UI-repair ZIP `4d8e23f077c97bef3ecb1c2463c95c245eb7bdd0988685aedc160c5a0b52ae0d`. It prepares public-shaped paths using the existing Vite/WebAudio/project foundation. **It is opt-in, localhost-only, noindex and not a production release.** Homepage LIVE state, public default route table, permissions/headers, Git/Actions/deployment and sample data are unchanged.

## Two distinct build boundaries

- `npm run build`: normal V1–V3 `dist`; excludes the four Gamelan entries and all202 Gamelan PCM files. Existing public Studio remains its schema3 workspace. No homepage CTA or sitemap entry promotes V4.
- `npm run build -- --mode gamelan-preview --outDir qa-artifacts/<review-folder>/preview-dist`: includes existing entries plus `/gamelan/`, `/en/gamelan/`, `/gamelan/credits/`, `/en/gamelan/credits/`. Output must resolve **inside a dedicated `qa-artifacts` subdirectory**; `dist`, workspace outside paths and the QA root itself refuse before build cleanup. Preview uses `emptyOutDir:false` to preserve existing evidence. Prefer a fresh dedicated directory to avoid retained stale outputs; do not reuse a frozen build directory.
- Run the existing Vite preview with that mode/outDir and a loopback host. The compiled package works without a source asset bridge. Focus/credits retain their localhost guards. Existing `/internal/instrument-focus/` remains a development/review entry and its links continue to resolve there.

Preview HTML has localized initial language/title/description and `noindex,nofollow`; runtime visitor default is ID, explicit EN route/query supported. Credits/help/back links resolve the matching preview route. No canonical/hreflang or production SEO/live claim is invented for these unreleased paths. Default localized404 behavior continues when the default build does not contain Gamelan.

## Exact standalone delivery

`scripts/gamelan-preview-assets.mjs` validates and copies202 accepted CDM PCM24 files at their immutable runtime `/sounds/cdm-porto-candidate/{44100,48000}/...` paths. It checks source byte size/SHA256, contained/unique source/output paths and copied hashes; there is no DSP, retune, mono conversion, tail cut or new codec. Complete101-source credits, both license texts, changes/quality flags/recipe references and existing legacy manifests/licenses/source references accompany the runtime paths. Original Groove, Studio kits and V3 sounds are copied at the existing lazy loader URLs so combined projects actually render without the former development bridge.

The generated `gamelan-preview-delivery.json` lists every copied source/path/byte/hash.259 copied files total485,799,039bytes; CDM subset202/479,867,000bytes. This is **disk package size**, not initial download. No WAV is imported into a JS bundle. The app selects only the negotiated active44.1/48k profile and current focus/demo requirements; cold opening the workspace creates no AudioContext and requests no WAV. Browser admission remains64MiB; actual mobile RSS/onset/slow-network/sustained play are separate gates.

All raw recorded-work grants/credits and full available source tails remain intact. The CC BY text is the previously labelled complete supported-web transcription; Artistic text remains pinned unchanged. Source-form references retain original S2 paths and primary pinned upstream links; a final redistributable source-form/reproduction package still needs release review. Seven quality observations and competent cultural/listening review remain pending. This package does not clear them or warrant legal/authenticity conclusions.

**Concrete production decision still required:** approve delivery/network budget and decide whether the accepted separate-profile PCM24 package is acceptable, or authorize a reviewed lossless encoder/tooling experiment. The present machine lacks a suitable installed encoder and no dependency was installed. Measured gzip is not a configured CDN claim. Preserve stereo fidelity/full durations/tuning/all required instruments under either choice; compressed transfer does not reduce decoded PCM memory. The localhost/noindex guard/default-entry exclusion must not be removed until parent reviews production policy and full gates.

## Privacy-safe analytics preparation

The existing GA property/measurement ID/production-domain gate is retained. The allowlist now accepts only these V4 aggregate names: `gamelan_open`, `gamelan_first_note`, `gamelan_demo_played`, `gamelan_to_studio`, `audio_export_succeeded`, `audio_export_failed`. Success/milestone payloads are empty; failure payload is only the existing validated category enum. Private project/individual-note/sample/file/device/exception fields are discarded. Unknown event names refuse. Analytics exceptions never control audio/UI.

The workspace initializes the existing gate after its localhost guard, so this local preview sends no GA requests. Successful physical-pad/stage strikes share one first-note milestone per page; rejected strikes do not set it. Demo/mode/export calls occur only after successful operation; export failures are sanitized. Actual production event receipt/funnel processing remains UNVERIFIED and gated by later authorized publication.

## Tested / unfinished

Fresh evidence under `qa-artifacts/v4-route-boundary-2026-10-14`: compiled ID/EN routes/refresh/credits/legal paths; native Chrome/Edge/Firefox48k and Chrome44.1k; Chrome48k all12 physical focuses×2 laras, others Saron both laras,30 focus observations. Correct note IDs/count/full frames/rate1; requests only active profile; one native context. Four actual combined JSON/WAV exports: JSON byte-exact, three48k WAVs completely byte-exact to independent accepted outputs including attribution. Output/native context/mic counters end0. Actual first sound is muted for QA; no hearing/device claim. Preview homepage actual requested JS is free of audio engine constructors and requests no WAV; no external requests/GA. Unit output/path/analytics tests and default official regression are identified in the closing report.

Not completed here: public Studio cross-route/schema4 transfer or shared-route reload design; shipping production Gamelan by default; production nav/SEO/canonical/hreflang/sitemap; CDN/cache/compression or slow mobile loading targets; complete accessibility/physical Android/Safari/listening/coherent Central-Javanese/demos/seven flags; real OS share; export-limit product decisions; production SHA/GA/funnel/legal verification. No V5/V6, microphone or settings work.

Owner cutoff14October08:00WIB (`2026-10-14T01:00Z`); freeze begins no later than07:40WIB. Source/evidence and continuation notes must be saved, owned tests stopped and runtime cleanup verified before cutoff. Independent review of this exact boundary is next; no next implementation/publication after cutoff without new owner resume.
