# S2 cache allocation-history contract

S2-CACHE-01 repair: the opt-in instrument cache uses `ResourceBudget` with
`historyPolicy: "monotonic"`. The existing default policy remains `"lifetime"`:
4096 admitted IDs per ledger, no terminal ID reuse, unchanged completion and pin
ownership rules. Neither policy changes the 64MiB byte ceiling or native slots.

Monotonic admission accepts only canonical `allocation-N` IDs, where N is a
positive safe integer strictly greater than every previously admitted sequence.
A single sequence frontier rejects all earlier IDs permanently, without keeping
an ever-growing terminal-ID Set. At most 4096 live records remain admissible;
each live allocation, its pins and canceled/native flags stays in the ledger
until its own terminal operation. The cache's tighter job/scope/entry limits also
remain in force. There is no compaction, ledger transfer or automatic retry loop.

The cache issues both allocation IDs synchronously at reservation admission,
after caller footprint validation. Issuing IDs when a worker is queued would be
unsafe because canceled jobs can release logical slots before older queued jobs
start. The shared context sequence also supplies lease IDs, never resets on
clear/disposal/new facade, and rejects safe-integer exhaustion as
`cacheSequenceLimit`. Successful/failing/canceled jobs all consume unique IDs.
Gaps are permitted; old identities cannot collide with newer work.

`snapshot().budget.history` exposes `policy`, `storedIds`, `sequenceFloor` and
`recordLimit`. Monotonic `storedIds` is always zero; the scalar frontier plus live
Map provides bounded bookkeeping. A pending old digest/native completion can
settle its still-live ID even when the frontier is far ahead. Once that record
is terminal, duplicate completion fails and cannot address a new allocation.

No foreign pin is released to recover history capacity. `clear()` still refuses
while jobs/scopes exist; recovery from settled retry history no longer requires
clear or stopping another facade. Uncancellable hash/native reservations remain
until actual completion, including across long sessions and facade replacement.

This remains standalone cache engineering. It does not implement aggregate
render/export/multiple-context admission. AudioBuffer read-only use remains a
caller contract: peak/RMS inspection does not detect every identity-preserving
mutation. Cultural/listening/source-quality and production acceptance remain
separate gates; S3 waits for independent repair closure.
