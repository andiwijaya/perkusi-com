// Owns selection/loading state separately from the status of individual hits.
// Tokens fence A -> B -> A, cancellation, and late native decode settlement.
export function createExtraLoading(samplers, onChange = () => {}) {
  let selected = "kethuk",
    token = 0,
    disposed = false;
  let view = { state: "idle", ready: 0, total: 0 };
  const publish = (next) => {
    view = { ...view, ...next };
    if (!disposed) onChange({ ...view, selected });
  };
  return {
    snapshot: () => ({ ...view, selected }),
    isReady: () =>
      !disposed && view.state === "ready" && samplers[selected].isReady(),
    async prepare(id = selected) {
      if (disposed || !Object.hasOwn(samplers, id)) return;
      const intent = ++token;
      samplers[selected].stop();
      selected = id;
      publish({ state: "loading", ready: 0, total: 0 });
      try {
        const result = await samplers[id].prepare((progress) => {
          if (!disposed && token === intent) publish(progress);
        });
        if (disposed || token !== intent) return;
        if (!result || !samplers[id].isReady()) publish({ state: "paused" });
        else publish({ ...result, state: "ready" });
      } catch {
        if (!disposed && token === intent) publish({ state: "error" });
      }
    },
    pause() {
      if (disposed) return;
      ++token;
      samplers[selected].stop();
      if (
        view.state === "loading" ||
        (view.state === "ready" && !samplers[selected].isReady())
      )
        publish({ state: "paused" });
    },
    invalidate() {
      if (disposed) return;
      ++token;
      samplers[selected].stop();
      publish({ state: "paused" });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ++token;
      samplers[selected].stop();
    },
  };
}
