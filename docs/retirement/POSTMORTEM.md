# V5/V6 retirement — compact postmortem

Product Owner declared multi-instrument **FAILED** and stopped V5/V6. This record distinguishes observed failures from causes that were never established. Retirement is a scope decision, not a claim that the historical audio defect was fixed.

## Observed and verified

- The owner reported changing a checkbox followed by no playback. Historical Preview playback interruptions were also recorded. The cause of that user-reported incident remains **UNKNOWN**.
- Separate confirmed defects included conflicting workspace/transport disabled rules, Save-copy locking, and non-idempotent repeated Pause/Resume in the opt-in prototype adapter. Their individual fixes and short tests did not establish the cause of the owner's incident or qualify the whole multi-instrument product.
- Stream/clock experiments produced bounded successes and independent corrections. They never justified promoting all clock consumers or calling V5 Final complete. Candidate/native success was not equivalent to application reliability across controls, persistence and long sessions.
- Historical inventories found project size dominated by repeated generated QA/build/audio copies, rather than ordinary application source. Logical size, physical allocation and browser download size were different quantities. Earlier approved deletion batches have their own receipts; no new QA deletion is authorized by this postmortem.

## Decision and containment

Keep ordinary Rhythm Studio V1–V3 and Beatbox Playground as the supported tools. The local retirement candidate disconnects and removes failed owners/controllers/worklets, Gamelan/Loop UI and feature activation/build branches. Old URLs show static notices and credits. No hidden candidate flag should activate another editor. Production identity must still be verified at final publication; local test success is not a deployment receipt.

Preserve user projects and media. Qualified full-project export, exact raw local/session originals and readonly handoff discovery remain isolated from normal playback. Missing databases must not be created or upgraded; unsupported/corrupt originals must not be silently normalized, truncated or converted. The partial B2 utility stays local-only and unqualified. Canonical media—including Suling candidates, masters, licenses, credits and hashes—remains outside generated QA cleanup. Archived candidates are not automatically production-qualified or deployed.

Keep the small shared data/DSP/format assertions explicitly identified during retirement. Their preservation does not retain a public experimental product. Git history and exact working-byte/EOL recovery maps protect removed tracked code. Unique original takes/failure evidence and current release/rollback inputs remain protected; generated bulk needs a separately vetted exact deletion manifest.

## Lessons applied

1. Define a coherent release slice and user-visible acceptance before expanding instruments, capture, clocks and editing together.
2. Prove actual control → playback → save/reopen → export journeys. DOM wiring, a checked box, a passing build or a short audio prototype cannot replace those journeys.
3. Keep UI enabled/checked/error states aligned with the owner contract. Test repeated controls, pending operations, Stop/restart and ownership cleanup.
4. Bind evidence to exact source/artifact identities. Preserve failures and label instrumentation errors separately; never rerun until green or infer an unknown cause from a later pass.
5. Use bounded-memory QA and one canonical media library. Retain compact reports/manifests/patches, rather than duplicating full asset trees for every experiment.

Future work starts from ordinary Rhythm Studio, one vertical slice at a time: one instrument through load/pad/sequence/mix/save/export and a real E2E gate, then another slice. Microphone work gets its own minimal acceptance later. Do not resurrect the retired engine or start another large rewrite during cleanup.

Evidence: `docs/HANDOVER-2026-10-21.md`, `docs/retirement/C3_REMOVAL.md`, and the C4 source/test/build/runtime receipts under `qa-artifacts/retirement-c4-2026-10-21/`. Physical-device testing, listening and cultural classification retain their documented **UNVERIFIED** limits. No model setting was changed by retirement work.
