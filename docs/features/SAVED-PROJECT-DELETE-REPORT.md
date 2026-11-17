# Saved project deletion review

Date: 17 November 2026 (Asia/Jakarta).

## Findings and changes

Production reproductions showed that approving a native confirmation could overwrite a newly added or edited sibling save from another tab. The selected save could also be deleted after it had changed in another tab, even though the user had confirmed the earlier version. Evidence is under `qa-artifacts/delete-projects-20261117/before-sibling/` and `before-changed/`.

Both tools now capture the selected ID and complete saved project before confirmation. The prompt names that project and states that the active project, other saves and downloaded files remain. After the native prompt closes, deletion waits for queued storage updates, reads the current collection, and removes only the confirmed unchanged ID. Other saves added or edited during confirmation are kept. A changed or missing selected save is refused and the displayed list refreshed. Structural project comparison ignores JSON object-key ordering while checking all project fields.

Storage write failures preserve the saved collection and report failure. Deletion never applies another project to the editor or changes its draft. Studio's protected legacy originals remain protected: its delete button is disabled with a visible explanation and accessible description. Users can load the original and save a manageable Studio copy. Descriptions for protected entries are removed when an ordinary deletable save is selected.

## Verification method

`npm run test:delete-projects` uses isolated Chrome contexts with synthetic data. Six ordinary journeys cover Beatbox and Studio in Indonesian/English desktop and Indonesian phone layouts. Each loads a saved project, makes an unsaved beat edit, cancels deletion, then deletes that saved copy. The active draft's complete project and WAV are compared before deletion and after refresh. Remaining saves, including another save with the same title, are loaded and checked; saving a new copy must still work.

Active draft bytes, other tool/legacy stores, retained transfer archives and an unrelated preference must remain unchanged by deletion. Studio journeys also verify disabled deletion and accessible help for both legacy Studio and Beatbox originals; the legacy Studio save remains loadable. Prompt tests include a title with literal `$&` to ensure replacement tokens do not change the displayed name.

Eight further journeys cover both tools with a new/edited sibling save during confirmation, a changed selected save, a selected save removed by another tab, and denied collection writes. Thirteen unit tests cover both stores' deletion scope, same-title saves, newly added/edited siblings, changed/missing targets, failed writes, reordered JSON fields and protected legacy originals.

Audio comparisons require matching channels, sample rate and frame count, with correlation above 0.999, normalized error below 0.002 and level difference below 0.01 dB for every channel. The first 40 ms and final 15 ms are excluded to isolate startup/end fades. Phone checks use browser emulation; PCM comparisons do not constitute physical-device or human-listening tests.

Evidence is under `qa-artifacts/delete-projects-20261117/`. Production QA first matches live `version.json` to the merged main commit, then runs the same fourteen browser journeys on perkusi.com.

## Local results

All fourteen browser journeys passed on the final build, with 12 WAV downloads, 49 project downloads, nine channel comparisons and no browser errors. All six active edited projects survived deletion and refresh. Twelve remaining native saves and three legacy Studio saves loaded with their expected project data, and saving again succeeded in each ordinary journey. Active drafts, other stores, transfer archives and preferences remained intact. Compared PCM samples had a 0 dB level difference.

All 689 unit tests passed, including thirteen saved-project deletion tests. Lint and the production build passed; final receipt: `qa-artifacts/build-retention/runs/ff0348a5-615c-43c3-842b-ee82637af5f0.json`. The final browser script also passed ESLint. The harness waits for the deliberately unsaved active edit to reach its draft before comparing protected bytes, so normal autosave is distinguished from deletion effects. Final local evidence: `qa-artifacts/delete-projects-20261117/local-final/evidence.json`.
