# Original Groove — S3 candidate assets

The first Original Groove candidate is a two-bar vocal-percussion score at
96 BPM, 4/4, D minor. Twelve independently authored procedural loops cover
lip kick, mouth snare, breath hi-hat, vocal bass, melody hum and vocal FX,
with A/B variants per role. These are **synthesized candidates, not human
recordings**. They aim at buh/bup, pf/psh, ts/tsh, doum/woum, mm/ng and
ka-tik/tok-r articulations. Human-like musical quality and listening remain
**UNVERIFIED** until actually auditioned. S3 does not release the Playground.

## Source and licensing

`scripts/make-original-groove.py` contains the complete original score,
deterministic seed derivation, glottal opening/closing flow, lip/tongue/breath
excitation, independently written oral resonances, articulation envelopes,
per-role peak scaling and file-edge fades. Only Python's standard library
is used to author audio. No recording, third-party sample, voice model,
dataset, proprietary DSP library or paid service is involved. No artist or
person's voice is imitated. The sources and WAVs carry an explicit CC0
dedication, including commercial and raw-file redistribution permission.

The local license, standard legal text and per-file registry live under
`internal/original-groove/`. `manifest.json` includes the versioned pack,
tempo/meter/bars/key, role/variant, exact paths/hashes, source recipe/seed and
articulation events, source-reference master hashes, trims, loop bounds and
explicit production/acceptance/listening flags. The source-reference masters
are procedural renders at 48 kHz; web files are independently rendered from
the same score at 32 kHz, not downsampled copies of those masters. Their noise
realizations therefore differ with sample rate. Both paths are recorded.

The source/filter concept was checked against the [MIT phonetics lecture](https://ocw.mit.edu/courses/24-915-linguistic-phonetics-fall-2015/8f4e9d5d8ea634dbbf0e2da8b92675ea_MIT24_915F15_lec4.pdf)
and [Julius O. Smith's formant discussion](https://www.dsprelated.com/freebooks/filters/Formant_Filtering_Example.html).
No reference code, audio or diagrams were copied. Theory alone does not
establish the perceptual quality of this implementation.

## Engineering contract

Each optimized raw web WAV is mono PCM16, 32 kHz, 160,000 frames / five
seconds. Twelve files total 3,840,528 bytes. Role-specific trims preserve
conservative six-role headroom without a limiter. The catalog retains all
twelve variants; `src/audio/pack-catalog.js` projects a selection onto six
stable role IDs for the existing shared engine. It validates two variants
per role, timing, paths, provenance and commercial/raw permission. The
engine's active-stem cap and reviewed transport/gain/deadline implementation
are unchanged.

The local `/internal/sound-lab/?lang=id` or `?lang=en` offers genuine mix
playback, role mute/rejoin, pause/reset, volume, per-role retry, and paused
variant selection. A paused variant change disposes the old graph before
loading a fresh selection on the next Play gesture. It is an **asset audition
lab**, not S4's live quantized variation replacement. Normal production builds
exclude its route, audio and characters; public links/SEO remain S1.

Six original geometric creatures — Bumi, Sabet, Cicik, Dum, Luma, Tara —
use different silhouettes, dark outlines and semantic button labels. Their
raw SVG files, authored renderer, CSS and provenance/license are available.
Idle, perform, selected, keyboard focus, loading and error are distinct;
motion reads the shared audio phase and never schedules audio. Reduced
motion gives static equivalents. The lab's expression preview is explicitly
visual only. No Incredibox art/layout, external icon set or bitmap reference
was imported.

## Reproduction and review

Run `python scripts/make-original-groove.py --phase pilot` to reproduce the
six-role pilot and its four-bar mix; the retained pilot feasibility decision
preceded complete generation. `--phase full` reproduces twelve candidates
and their source-reference masters. `node scripts/make-character-assets.mjs`
recreates the six SVG exports and registry from the original code. These
commands overwrite their current generated outputs; use a separate copy of
the workspace when preserving a reviewed checkpoint.

Build the local prototype with an explicit fresh `--outDir`; override
`PERKUSI_AUDIO_DIST`, `PERKUSI_SOUND_QA_DIR`, `PERKUSI_AUDIO_CHANNEL` for
`node scripts/test-sound-assets.mjs`. `PERKUSI_CAPTURE_SECONDS=120` records
the steady six-role graph for two minutes; `15` is a bounded comparison
smoke. Captured audio is the engine output, without microphone permission,
server upload or analytics. Automated signal, phase, boundary and headroom
measurements are not musicality or physical-device evidence.

Listening protocol: audition all twelve solos, canonical A/B and hybrid
mixes, every role pair and all-six mix on ordinary headphones and speakers.
Record actual listener/date/device/browser and file hashes; judge human mouth
identity, role distinction, groove, pitch blend, masking, balances, wrap
seams and pause/rejoin transients. If synthesis feels like generic drums,
beeps or robotic placeholder tones, reject it and supply original human
masters with a commercial/raw release (or supported licensed acquisition).
Neither successful decoding nor the number of assets closes that gate.
