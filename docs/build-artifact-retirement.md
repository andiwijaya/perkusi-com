# Local artifact registration and retirement

This maintenance change is separate from production release `4dea30f`.

Managed local builds already register their results. A custom completed builder
(including a compatible rollback assembler) must call `registerCompletedArtifact`
from `scripts/build-artifact-lifecycle.mjs` after it has stopped writing. Pass its
successful receipt, matching before/after source fingerprint and complete file
manifest (`path`, `bytes`, `sha256`). Registration verifies every file, refuses
unexpected/missing files, traversal, reparse points and active/overlapping roots,
and retains the artifact. It does not change the latest production build pointer.
Repeated registration is idempotent only for the same identity and exact bytes.

To retire a superseded successful output, call `retireCompletedArtifact` with
the old target, registered successful successor, complete successor file manifest
and a concrete reason. Successor bytes are reverified. The old result must be
settled, inactive, outside latest/ancestor protections and outside sealed evidence.
It becomes explicitly obsolete. Its review pin remains unless `releaseReview:
true` is supplied. Failed or unsettled outputs are refused.

Already obsolete managed outputs use `releaseObsoleteReview`; this now also
refuses active, latest, unsettled, ancestor-retained and sealed evidence roots.
Never release a lease merely because its process looks old; preserve owner
previews and resolve stale ownership separately.

Neither API deletes payloads. The existing `cleanupBuilds` policy still performs
its own locked action-time checks and removes only byte-identical FLAC/source
archive copies with a preserved canonical original and restoration map. Unique
WAV captures, compiled pages, logs and measurement evidence remain. A retired
artifact with pruned payloads needs rehydration from its restoration map before
its former complete-artifact manifest can verify again.

Cleanup itself also excludes target, packet-ancestor and workspace seals during
planning. It revalidates live seal presence and registry protection after content
preflight and immediately before each unlink. A new seal or lease/pin stops the
operation; if earlier files were already removed before the protection appeared,
the receipt records that partial work and preserves all remaining payloads.
Seal contents need not parse: presence protects, and access/reparse errors fail
closed. These are cooperative filesystem checks, not an atomic transaction across
external seal writers; do not perform real cleanup while evidence is being sealed.
Final measurement/free-space errors are retained as diagnostics and do not skip
the terminal refusal/progress receipt write. An unavailable measurement is null;
the original refusal and any completed removal counts remain intact.

Safety tests: `node --test tests/build-artifact-lifecycle.test.js
tests/build-housekeeping.test.js tests/build-cleanup-protection.test.js`. These use temporary fixtures, not production
or owner browser profiles.
