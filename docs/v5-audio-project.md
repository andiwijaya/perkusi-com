# X: local recorded project with complete audio recovery

Local candidate only, 2026-10-16. W's bounded acceptance remains the baseline;
full V5 release is HOLD. No microphone, server upload, workflow, production
header, deployment or Git write is part of this slice.

## Dependency order and PRD mapping

The verified V4–V6 PRD transcription SHA256 is
86dcdd63155ae88b9146d5cdd2541babc7107e69eb71a0c6a725a4d02e04b10a.
The original Library file was not newly materialized in this slice.

1. F10/F12: canonical immutable PCM, integrity/geometry/credit validation and
   atomic browser persistence. A JSON reference is not an audio backup.
2. F03/F07/F10: copy one complete reviewed take into an empty main-project track,
   preserving the session original. Use the existing single transport/mixer and
   recording resolver. Playback takes its actual bytes from browser storage.
3. F10/F12: complete portable export/import plus reload and conflict recovery.
4. F04 next: nondestructive overdub/layer adoption, retention and history. It
   depends on durable immutable audio, but is **not implemented here**. Existing
   session-layer history is not claimed as project overdub or durable history.

F01/F02/F09/F13 still need the full home/Studio journey, track/performance/device
matrix, three genre starters and broader bilingual/accessibility assessment.
F05/F06 microphone and source-family breadth, F08 EQ/limiter, F11 final mixed WAV,
musical/cultural/listening and deployment gates remain open. Existing individual
take WAV remains a fallback, not final-mix acceptance.

## Recording and adoption contract

Only a complete, closed, reviewed 48k Saron take from W's qualified source can
enter this UI flow. Empty target only; no silent replacement or overdub. Session
Save hands off pins before source/capture closure. Adoption copies planar
Float32LE, preserves all original samples including signed zero, computes full
SHA256 and carries existing WAV/source attribution. The main project gets one
recording reference and looping clip with its frozen integer-frame bar period.
No resampling, normalization or placeholder audio is introduced.

The immutable session copy keeps its library/history pins. A failed or cancelled
adoption may therefore leave it in the session library, never silently delete it.
Main-project state is published only after the audio/document transaction commits.
Session discard removes only session copies; the durable project copy survives.
Session preview/history is disabled on an occupied selected project track to
avoid an accidental second copy sounding. Main Play uses the accepted renderer.

## Persistence and recovery contract

IndexedDB `perkusi.loop-audio.v1` has documents, SHA-keyed raw PCM and reference-
keyed credits. These are local browser stores, not a hosted database. One
readwrite transaction commits every referenced byte/credit plus the current
document. Native transaction serialization provides revision compare-and-swap
across tabs. Quota/abort/conflict preserves the previous transaction. Commit is
`oncomplete`; cancellation after that point reports success and publishes the
committed document. Old assets are retained for main-project undo/redo; no
automatic GC. Undo stacks themselves do not survive reload.

After an IDB document exists it is authoritative; legacy localStorage metadata is
not automatically substituted. A localStorage revision notification is advisory;
the IDB comparison remains the correctness gate if notifications are unavailable.
A missing store with a retained marker requires explicit recovery. Browser data
can still be cleared/evicted: the UI recommends a complete portable backup.
Startup validates bytes, hashes, finite floats, geometry and credits before
publishing the restored project. Corrupt/missing audio blocks ordinary edits and
playback. Explicit import or recovery reset is required. Raw recovery metadata is
plainly a diagnostic, never a complete audio backup. If IDB is unavailable and no
recorded document is known, the existing session/WAV and legacy metadata flow
remain available; durable adoption refuses honestly.

## Portable format and bounds

`.perkusi` is an uncompressed binary bundle: 48-byte header, UTF-8 manifest,
contiguous PCM payloads. Magic `PKLOOP01`; uint32 LE version 1 at byte 8, manifest
length at 12, SHA256 of exact manifest bytes at 16. Manifest has exact keys
format/version/project/payloads; each payload has id/sha256/offset/bytes/provenance.
Offsets are relative to the payload region, ordered exactly as project assetRefs.
All references are included, even temporarily unused history references. There
are no URLs, executable content, base64 inflation, compression or external fetch.

Import verifies manifest hash, strict project schema, exact payload coverage,
credits, geometry, finite PCM and full PCM hashes. Gaps/overlaps/trailing/truncated
data fail. Limits: 2 MiB project JSON, 3 MiB manifest, 16 MiB total PCM, 64 KiB
credits per asset, existing 32-second single-take geometry and 64 MiB shared audio
ledger. Supported recording projects use fixed bars at 44.1/48k, zero offset and
exact loop periods. Unsupported offsets/rates refuse before publication.

These are bounded candidate limits, not a claim that eight maximum-duration
tracks can all be retained/rendered/exported simultaneously. Read, validation,
native AudioBuffer/view and portable copies reserve from the existing ledger.
Resource refusal preserves source PCM and the prior durable project. Prepared
playback is unloaded only after voices end before storage operations; portable
output leases last through URL revocation/explicit close. Browser/OS RSS is not
measured by this ledger.

## Directed evidence required

Use a concrete new persistence/adoption concern, not a retry of W's failed trace.
Product-only actual DOM: fresh one-bar recording, exact original hash; adoption,
main-project playback, original preservation, explicit session discard, complete
download, same-origin reload, fresh-store import, main undo/redo, corrupted import
and cancellation preserving original data. Native IDB tests additionally cover
transaction abort, quota injection, cross-tab CAS, complete credit retention and
missing/corrupt byte recovery. Inspect ID/EN desktop/mobile layouts. Record every
failed attempt; no physical-device, listening or full routing waveform claim.
