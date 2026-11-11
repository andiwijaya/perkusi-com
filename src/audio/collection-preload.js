import { createBankPreparation } from "./bank-preparation.js";

export function createCollectionPreload(engine, banks, onChange = () => {}) {
  const waiters = new Set();
  let disposed = false;
  const view = () => {
    const s = scheduler.snapshot();
    const groups = Object.values(s.groups);
    return {
      state:
        s.phase === "paused"
          ? s.failed.length
            ? "error"
            : "paused"
          : s.phase === "ready" && !scheduler.allReady()
            ? "waiting"
            : s.phase,
      ready: groups.reduce((n, g) => n + g.ready, 0),
      total: groups.reduce((n, g) => n + g.total, 0),
    };
  };
  const settle = (error) => {
    for (const w of waiters) error ? w.reject(error) : w.resolve();
    waiters.clear();
  };
  const scheduler = createBankPreparation(banks, {
    ensureContext: () => engine.ensureContext(),
    currentContext: () => engine.context,
    onChange: (s) => {
      const v = view();
      onChange(v);
      if (v.state === "ready") settle();
      if (s.phase === "paused") {
        settle(new Error("Audio preparation paused"));
      }
    },
  });
  function wait() {
    if (scheduler.allReady()) return Promise.resolve();
    if (disposed)
      return Promise.reject(new Error("Audio preparation disposed"));
    if (scheduler.snapshot().phase === "paused")
      return Promise.reject(new Error("Audio preparation paused"));
    return new Promise((resolve, reject) => waiters.add({ resolve, reject }));
  }
  return {
    snapshot: view,
    isReady: scheduler.allReady,
    start() {
      if (disposed)
        return Promise.reject(new Error("Audio preparation disposed"));
      scheduler.start();
      return wait();
    },
    async retry() {
      if (disposed) return;
      // Recover one failed bank at a time; each successful retry may expose a
      // second failed bank. Normal collection loading resumes after all recover.
      while (!disposed) {
        const before = scheduler.snapshot();
        if (before.phase !== "paused") break;
        const family = before.failed[0] || Object.keys(banks)[0];
        scheduler.retry(family);
        try {
          await wait();
          break;
        } catch {
          const after = scheduler.snapshot();
          if (after.failed.includes(family) || !after.failed.length) break;
        }
      }
    },
    invalidate() {
      if (!disposed) scheduler.invalidate();
    },
    releaseIdle() {
      const sounding = new Set([...engine.voices].map((v) => v.source.buffer));
      let released = false;
      for (const bank of Object.values(banks))
        if (
          [...bank.entries.values()].some((e) => e.buffer) &&
          ![...bank.entries.values()].some(
            (e) => e.buffer && sounding.has(e.buffer),
          )
        ) {
          bank.evictCache();
          released = true;
        }
      if (released) onChange(view());
      return released;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scheduler.dispose();
      settle(new Error("Audio preparation disposed"));
    },
  };
}

// Keep existing render limits when full-collection cache is not needed by the
// sounding voices. Never hide active audio memory from admission accounting.
export async function renderPreparedAudio(
  preload,
  exporter,
  project,
  progress,
  options,
) {
  let released = false;
  try {
    try {
      return await exporter.render(project, progress, options);
    } catch (error) {
      if (error.code !== "exportLimit" || !preload.releaseIdle()) throw error;
      released = true;
      return await exporter.render(project, progress, options);
    }
  } finally {
    if (released) await preload.start();
  }
}
