# Audio asset provenance and quality status

## S3 Original Groove candidate and original characters

`internal/original-groove/manifest.json` records twelve original procedural
vocal-percussion candidates, their exact web/source-reference master hashes,
score/recipes, seeds, timing/key, trims and explicit commercial/raw-file
redistribution permissions. `LICENSE.txt` applies CC0-1.0; the actual standard
legal text is saved as `CC0-LEGALCODE.txt`. There are no third-party audio
inputs, models, paid APIs or copied DSP code. Pilot proof, original source
masters and mix WAVs are retained in ignored S3 QA evidence. These candidates
are not human recordings or accepted V1 sounds; **listening/musicality remain
UNVERIFIED**. See [Original Groove](original-groove.md) for the exact method,
reproduction and listening gate.

Six original SVG creatures, their code/CSS and generated exports have CC0
commercial/raw-redistribution permission in `CHARACTERS-LICENSE.txt` and
`characters/provenance.json`. Source and derived hashes, original silhouettes
and idle/perform/selected/focus/loading/error states are recorded. No external
artwork/icon/bitmap reference or Incredibox material was imported. The normal public build includes the twelve Original Groove candidates and character SVG markup; it excludes the local sound lab and S2 fixtures.

## S2 technical fixtures — not a released V1 pack

`internal/audio/fixtures/provenance.json` records original filenames, SHA256, date, author, method, sample rate/channels/duration, peaks, usage and license for every fixture. `internal/audio/fixtures/LICENSE.txt` declares CC0-1.0 with its [legal code](https://creativecommons.org/publicdomain/zero/1.0/legalcode). Commercial use and raw-file redistribution are permitted; attribution is optional. No copied source samples, recordings, voice-clone models, proprietary synthesis tool or external DSP library was used. The original Python standard-library generator is included and deterministically recreates the WAVs.

| Asset       | Original method                                                                       | Geometry                                         | Current use            |
| ----------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------- |
| `thump.wav` | Low lip-like transient with exponentially falling pitch and filtered noise excitation | 48 kHz, mono PCM16; 5 seconds / 2 bars at 96 BPM | Technical fixture only |
| `air.wav`   | Seeded filtered-noise breath accents and short hats                                   | Same timing                                      | Technical fixture only |
| `hum.wav`   | Harmonic voiced phrase with breath/noise and slow pitch movement; D minor             | Same timing                                      | Technical fixture only |

These signals are not generic metronome beeps, but **their mouth-like musical quality has not been accepted**. They do not satisfy the six-role/two-variation V1 supply requirement. Neither waveform checks nor generated captures replace listening QA. Normal production builds exclude the prototype entry and all three assets.

## Final V1 sound path before S3 acceptance

Preferred supply is an original adult performer recording twelve purpose-made vocal stems: lip kick, mouth snare/clap, breath hat/shaker, vocal bass, hum/melody and vocal percussion/FX, two variants per role. Use the same BPM, 4/4 meter, integer two-bar length and D-minor-compatible pitched parts. Recording is an offline asset-production activity; the product must continue without microphone permission or audio uploads.

Obtain an explicit contributor release identifying each source master and allowing commercial web use, modification, worldwide distribution and **redistribution of the raw audio files**. A promise of royalty-free music use alone is insufficient. Store master hashes, performer/author, consent/license text and date, processing steps, exported asset hashes and attribution requirements in the registry. Do not use recognizable third-party voices or imitation of protected characters.

An original excitation/formant/noise synthesis route is also technically feasible without paid APIs or third-party samples; these S2 sources prove generation/pack decoding, not that it sounds like beatboxing. A synthesised final pack still needs all six differentiated roles, two variations, source/generator provenance and real listening approval. Existing fixtures must not be silently reclassified as production assets. No authorized human vocal masters are available in this workspace at S2.

## Read-only sourcing evidence (2026-10-11)

Two actual mouth/percussion candidates were checked on their original author pages: [beatbox_snare1 by benjii1](https://freesound.org/people/benjii1/sounds/833352/) (self-described mouth recording, mono WAV 48 kHz) and [Beatbox short-cut snare by casmarrav](https://freesound.org/people/casmarrav/sounds/185029/) (beatbox-based synthesis/layering, stereo WAV 44.1 kHz). Both author pages display **Attribution 4.0**. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits copying, adapting and commercial reuse with credit, license link and modification notice. This is a viable raw-redistribution license class, unlike a noncommercial or standalone-redistribution-restricted sound license.

Both original downloads require a Freesound login. No account was created, download bypass attempted or candidate audio imported/listened to. These examples establish a concrete licensed sourcing path, not a complete twelve-stem pack or quality approval. Acquisition through supported authenticated download with preserved original license evidence is still required. The preferred original-performer route also remains dependent on supplying the actual recordings and release. S3 must resolve sound supply and audible acceptance; technical fixtures cannot satisfy that gate by relabeling.

## Listening / physical test protocol

Listen to isolated stems, every two-role combination, all six roles, and both variants on headphones and ordinary speakers at safe levels. Check mouth character, transient clarity, groove, pitched harmony, masking, level balance, loop seams and start/stop clicks. Record listener, output device, browser, pack hashes, exact combination and observed issues. Iterate gain trims/edits rather than forcing a limiter.

Record at least two minutes from the graph with quantized transitions, pause/resume, reset and 20 control cycles. Keep the capture and independently compare its phase, sample counts and peaks. Browser QA provides fixture captures for this review; **listening remains UNVERIFIED** until someone actually auditions them. On physical Chrome Android and Safari iPhone, test user-gesture unlock, screen lock, hidden/visible tab, interrupted context, headset/Bluetooth output changes and recovery. Desktop WebKit automation is not a substitute for those device tests.

S5 qualifies the unchanged social bitmap, code-native favicon and bundled fonts in `docs/v1-release.md`. Full font/Vite notices ship as `public/THIRD-PARTY-NOTICES.txt`. The CC0 audio/character dedication does not relicense the OFL fonts, Vite or the Windows font used to rasterize the existing social card.

## V2 Studio original one-shot kits

Ruang and Arus are sixteen distinct original percussion one-shots, generated by the seeded Python standard-library recipe `scripts/make-studio-kits.py`. The full geometry, original author/method/date, recipe/asset SHA256, level trim and commercial/raw-redistribution permissions are in `internal/studio-kits/manifest.json`; original CC0-1.0 dedication is `internal/studio-kits/LICENSE.txt` and public `/STUDIO-KITS-LICENSE.txt`. No third-party recording, sample, AI voice clone, external DSP or paid API is used. These are suitable one-shot sources for BPM60–180 without modifying playback pitch or duration. They do not replace the accepted V1 vocal loops. Physical listening/musical quality acceptance is UNVERIFIED. See `docs/studio.md` and S7 QA evidence.
