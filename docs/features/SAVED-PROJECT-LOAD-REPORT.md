# Saved project loading review

Date: 17 November 2026 (Asia/Jakarta).

## Findings and changes

Beatbox loaded a selected save immediately, without asking before replacing the active project. Studio asked only when its in-memory undo history contained an edit. Restoring an edited active draft after refresh clears that undo history, so Studio could also replace active edits without confirmation. The production reproductions for both tools are under `qa-artifacts/load-projects-20261117/before-beatbox/` and `before-studio/`; their downloaded active projects were replaced without any dialog.

Every explicit saved-project Load now asks for confirmation in both tools. It names the selected project, states that the active project and its edits will be replaced, and advises saving or downloading the active work first. Cancelling never applies the chosen project and has its own message. Automatic startup draft recovery and transfer delivery retain their existing flows.

The action captures the chosen ID and complete saved project before the prompt. After the native confirmation closes, it waits for queued storage updates and resolves that same unchanged save from the current collection. Changed/missing targets or failed reads leave the active project untouched and refresh the choices. Structural comparison ignores JSON object-key ordering. The shared changed-save message now fits both loading and deletion.

## Verification method

`npm run test:load-projects` uses isolated Chrome contexts and synthetic projects. Six main journeys cover both tools in Indonesian/English desktop and Indonesian phone layouts. Each first loads a baseline save, then changes its music and title (ID desktop), title alone (EN desktop), or Studio playback mode/Beatbox duration alone (phone). After autosave and refresh, the active edited project must still require confirmation before loading the saved version.

Cancellation preserves the entire active project and protected raw data, including a second refresh. Approval restores the selected project's complete fields, controls, playback mode and remembered gain, remains paused and persists after refresh. Downloaded WAVs are compared before editing and after confirmed loading. Studio additionally loads protected Studio V2 and Beatbox originals as confirmed migrated copies while keeping their source stores unchanged.

Eight further journeys cover both tools with a target edited or removed in another tab during confirmation, a denied read after confirmation, and cancellation immediately after typing before autosave settles. Active edits must remain intact. All saved stores, unrelated active/legacy drafts, transfer archives and preferences are checked for unintended changes. Fourteen unit tests cover read-only resolution, changed/missing targets, unrelated save updates, read failure, reordered JSON fields and legacy migration.

Audio checks require matching channel count, sample rate and frame count, then correlation above 0.999, normalized difference below 0.002 and level difference below 0.01 dB per channel. The first 40 ms and last 15 ms are excluded to isolate startup/end fades. Phone checks use browser emulation; PCM comparisons do not constitute physical-device or human-listening tests.

Evidence is under `qa-artifacts/load-projects-20261117/`. Production QA first matches live `version.json` to the merged main commit, then runs the same fourteen browser journeys directly on perkusi.com.

## Local results

All fourteen browser journeys passed, with 12 WAV downloads, 66 project downloads, nine channel comparisons and no browser errors. All six restored active edits survived cancelled loading and another refresh. Six regular saved projects and six legacy/original copies loaded only after approval, with their full musical data intact. The immediate-cancellation cases verified that the newly typed title had not reached the draft before the prompt opened, then survived cancellation and refresh. All saved stores and protected data stayed intact. The largest measured audio level difference was below 0.000001 dB.

All 703 unit tests passed, including fourteen load-resolution tests. Lint and the production build passed; receipt: `qa-artifacts/build-retention/runs/1a26a12d-c518-4a16-9518-43021b1e4a54.json`. The final browser script also passed ESLint. Local evidence: `qa-artifacts/load-projects-20261117/local/evidence.json`.
