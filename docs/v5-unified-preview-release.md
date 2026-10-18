# Optional unified Studio Preview

Ordinary Studio remains the previous editor. The explicit Preview link opens `/studio/?candidate=canonical&lang=id` or `/en/studio/?candidate=canonical&lang=en`. `workspace=legacy` retains the previous editor. Gamelan and Loop retain their existing workflows and expose acknowledged handoff when deliberately opened in the canonical session.

The Preview adds source editing, song Pattern Chain, native-event editing, compatible tempo/kit/swing controls, immutable source archives, explicit copy/merge, save/recovery and bounded playback/WAV. Wire schema6 is part of V5, not product V6. No server upload, account, paid API or new server database is introduced. Original PCM, timing,16voice/64MiB/.95headroom limits and source rights/provenance remain unchanged.

Existing bounded local metadata lists are read without migration writes. A selected source is validated, staged, then explicitly copied/merged or deferred. The prior project is durably backed up; original files remain downloadable. Loop takes use complete .perkusi packages, not metadata-only copies. Corrupt/future/stale/quota-conflicting operations refuse without clearing old stores. Discovery is scoped to local metadata lists; recordings and active/session tool work remain accessible through their existing tools and complete-file export/import.

Recovery/export lives at `/studio/recovery/?lang=id` and `/en/studio/recovery/?lang=en`. It opens only existing known-version canonical storage using readonly transactions, or reads a supplied backup. It exports complete schema6 packages with originals/takes and does not save, play, resample or down-convert. “Return to Studio” opens the editor available in that release. Editing a recovered Preview project requires a compatible Preview version.

## Publication selection and rollback requirement

The existing Pages command stays `npm run build`; local default remains canonical-off. The committed Pages release policy selects the reviewed opt-in production mode only for Pages `main` with a full commit identity. No Actions or settings change is required. Public builds include the recovery reader even with canonical editing off. Regression tests bind the selection and recovery paths.

After schema6 work exists, **do not restore stock b0570f1 alone or publish a build without recovery**. A compatibility rollback preserves the old app, adds visible ID/EN recovery links and retains the successor's exact recovery HTML/JS/CSS dependency closure at the same origin. It preserves old projects and lets new projects be exported, not edited by old code. A future repository revert must retain that additive reader/links and verify both old/new data access. Never clear browser data or promise arbitrary lossy down-conversion. Keep the verified local compatibility artifact and manifests until replaced by an equally recovery-capable rollback.

## Evidence and remaining limits

The combined integration and bounded activation/copy/recovery design were independently accepted. Local evidence includes1190 integration tests, four complete48k realtime/WAV comparisons,30 activation tests, ID/EN desktop/mobile copy/rollback and storage-negative paths, and an exact two-take portable round trip. Later label correction checks cover both release/rollback languages and safe export. These are scoped retained results; release-specific checks are recorded separately, not represented as fresh runs of all earlier matrices.

Canonical playback currently uses48kHz.44.1kHz sources remain portable and use original-rate Loop continuation; they are not automatically resampled into canonical playback. Historical Edge44.1k displacement and an unretained flagship peak observation remain unreproduced OPEN/UNCLASSIFIED, not proved current48k failures and not claimed fixed. Physical phones/Safari, real mic/latency, new-combination listening and cultural/set coherence remain unverified. Historical owner acceptance of seven unchanged raw Gamelan flags is retained; Suling and V6 stay deferred. This remains Preview scope.
