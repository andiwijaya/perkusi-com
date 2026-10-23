import {
  newComposition,
  withPatternLoops,
} from "../project/composition-model.js";
import { withKendhang } from "../project/kendhang.js";
import { withBass } from "../project/bass.js";
import { withGuitar } from "../project/guitar.js";

export function createPadOwner({
  engine,
  playback,
  extra = null,
  onStatus = () => {},
}) {
  const config = withGuitar(
    withBass(withKendhang(withPatternLoops(newComposition("Pad Station")))),
  );
  // The existing pad mixer needs its validated sound configuration, but no
  // arrangement is started, scheduled, saved or exposed by this page.
  config.timing.quantize = false;
  playback.configure(config, 1, true);
  let disposed = false,
    generation = 0,
    pending = 0,
    volume = config.master.volume,
    muted = false,
    observed = null,
    state = "ready",
    disposal;
  const life = new AbortController();
  function status(next) {
    state = next;
    if (!disposed) onStatus(next);
  }
  function resetView(next) {
    generation++;
    pending = 0;
    status(next);
  }
  function observe() {
    if (disposed) return;
    if (engine.context === observed) return;
    observed?.removeEventListener("statechange", changed);
    observed = engine.context;
    observed?.addEventListener("statechange", changed, { signal: life.signal });
  }
  function changed() {
    if (disposed || observed?.state === "running") return;
    extra?.stop();
    resetView(observed?.state === "closed" ? "error" : "stopped");
  }
  return {
    async play(family, pitch) {
      if (disposed) return;
      const intent = generation;
      pending++;
      status("loading");
      try {
        engine.error = null;
        const job =
          family === "drum"
            ? engine.triggerPad(pitch)
            : family === "extra" && extra
              ? extra.play(pitch)
              : playback.pad(pitch, family);
        observe();
        await job;
        if (intent === generation && !disposed && engine.error) status("error");
      } catch {
        if (intent === generation && !disposed) status("error");
      } finally {
        if (intent === generation && !disposed) {
          pending--;
          if (!pending && state !== "error") status("ready");
        }
      }
    },
    stop() {
      if (disposed) return;
      extra?.stop();
      engine.rewind();
      resetView("stopped");
    },
    setMaster(value) {
      if (disposed) return;
      if (!Number.isFinite(value) || value < 0 || value > 0.75)
        throw new RangeError("Invalid master level");
      volume = value;
      engine.setVolume(muted ? 0 : volume);
    },
    setMuted(value) {
      if (disposed) return;
      muted = !!value;
      engine.setVolume(muted ? 0 : volume);
    },
    dispose() {
      if (disposed) return disposal;
      disposed = true;
      generation++;
      pending = 0;
      life.abort();
      observed = null;
      extra?.dispose();
      disposal = engine.dispose({ immediate: true });
      return disposal;
    },
  };
}
