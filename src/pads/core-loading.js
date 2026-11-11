// Standalone readiness coordinator. Submit only two jobs at a time, so a
// failure can stop admission immediately without an eager queue of all notes.
export function createCoreLoading(
  banks,
  {
    ensureContext,
    currentContext,
    onChange = () => {},
    onReady = () => {},
    onBlocked = () => {},
  },
) {
  const families = Object.keys(banks),
    failed = new Set(),
    started = new Set();
  let context = null,
    token = 0,
    phase = "waiting",
    disposed = false,
    retrying = null;
  let jobs = [],
    active = new Set();
  const count = (family) =>
    [...banks[family].entries.keys()].filter((id) =>
      banks[family].verifyRetained(id),
    ).length;
  const validContext = () =>
    context && context === currentContext() && context.state !== "closed";
  function snapshot() {
    return {
      phase,
      failed: [...failed],
      groups: Object.fromEntries(
        families.map((family) => {
          const ready = count(family),
            total = banks[family].entries.size;
          const state =
            validContext() && ready === total
              ? "ready"
              : failed.has(family) && retrying !== family
                ? "error"
                : phase === "paused"
                  ? "paused"
                  : started.has(family)
                    ? "loading"
                    : "waiting";
          return [family, { state, ready, total }];
        }),
      ),
    };
  }
  const emit = () => {
    if (!disposed) onChange(snapshot());
  };
  const allReady = () =>
    !disposed &&
    phase === "ready" &&
    validContext() &&
    families.every((f) => count(f) === banks[f].entries.size);
  function cancel() {
    ++token;
    for (const bank of Object.values(banks)) bank.cancelLoading();
    jobs = [];
    active.clear();
  }
  function pause(errorFamily) {
    if (disposed) return;
    if (errorFamily) failed.add(errorFamily);
    // Preserve simultaneous genuine failures before cancellation resets pending
    // requests to idle. Native decodes retain their existing bounded leases.
    for (const family of families)
      if ([...banks[family].entries.values()].some((e) => e.state === "error"))
        failed.add(family);
    cancel();
    phase = "paused";
    retrying = null;
    onBlocked();
    emit();
  }
  function buildJobs(only) {
    const rows = families
      .filter((f) => !only || f === only)
      .map((family) =>
        [...banks[family].entries.keys()].map((id) => ({ family, id })),
      );
    // Round robin gives each group an opportunity before large groups finish.
    return Array.from(
      { length: Math.max(...rows.map((r) => r.length)) },
      (_, i) => rows.map((r) => r[i]).filter(Boolean),
    )
      .flat()
      .filter(({ family, id }) => !banks[family].verifyRetained(id));
  }
  function pump() {
    if (disposed || phase !== "loading") return;
    if (!validContext()) {
      context = null;
      pause();
      return;
    }
    if (!active.size && !jobs.length) {
      if (retrying) {
        if (count(retrying) !== banks[retrying].entries.size) {
          pause(retrying);
          return;
        }
        failed.delete(retrying);
        retrying = null;
        if (failed.size) {
          phase = "paused";
          emit();
          return;
        }
        jobs = buildJobs();
      }
      if (!jobs.length) {
        if (!families.every((f) => count(f) === banks[f].entries.size)) {
          pause();
          return;
        }
        phase = "ready";
        emit();
        onReady();
        return;
      }
    }
    while (active.size < 2 && jobs.length && phase === "loading") {
      const job = jobs.shift(),
        intent = token;
      active.add(job);
      started.add(job.family);
      emit();
      void Promise.resolve()
        .then(() => {
          if (disposed || token !== intent) return;
          return banks[job.family].load(job.id, context);
        })
        .then(() => {
          if (disposed || token !== intent) return;
          active.delete(job);
          if (!validContext()) {
            context = null;
            pause();
            return;
          }
          if (!banks[job.family].verifyRetained(job.id)) {
            pause(job.family);
            return;
          }
          emit();
          pump();
        })
        .catch(() => {
          if (!disposed && token === intent) pause(job.family);
        });
    }
  }
  function run(only) {
    if (disposed) return;
    cancel();
    try {
      context = ensureContext();
    } catch {
      pause(only || families[0]);
      return;
    }
    retrying = only || null;
    started.clear();
    if (only) started.add(only);
    jobs = buildJobs(only);
    phase = "loading";
    emit();
    pump();
  }
  return {
    snapshot,
    allReady,
    isReady: (family) =>
      !disposed &&
      validContext() &&
      Object.hasOwn(banks, family) &&
      count(family) === banks[family].entries.size,
    start: () => run(),
    retry(family) {
      if (disposed || phase !== "paused") return;
      if (failed.size && !failed.has(family)) return;
      run(failed.size ? family : null);
    },
    invalidate() {
      context = null;
      pause();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      context = null;
    },
  };
}
