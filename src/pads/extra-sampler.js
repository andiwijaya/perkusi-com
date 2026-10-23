import { SampleBank } from "../audio/sample-bank.js";
import { createOneShotVoice, fadeOutVoice } from "../audio/voice.js";

// An extra bank on the same owner/AudioContext, not a parallel transport/engine.
// Existing bank/voice limits, native decode leases and output safety stay intact.
export function createExtraSampler(
  engine,
  pack,
  level,
  { bankFactory = (p, options) => new SampleBank(p, options) } = {},
) {
  if (!Number.isFinite(level) || level <= 0 || level > 6)
    throw new RangeError("Invalid extra level");
  const bank = bankFactory(pack, {
    validateCandidate: (entry, metrics) =>
      engine.admitCandidate(entry, metrics),
  });
  engine.banks.add(bank);
  const voices = new Set();
  let generation = 0,
    disposed = false,
    gain,
    context;
  function stop() {
    generation++;
    bank.cancelLoading();
    for (const v of voices) engine.removeVoice(v);
    voices.clear();
  }
  return {
    async play(id) {
      if (disposed || engine.disposed) return;
      const ctx = engine.ensureContext(),
        intent = generation,
        operation = engine.operation;
      const live = () =>
        !disposed &&
        !engine.disposed &&
        generation === intent &&
        engine.operation === operation &&
        engine.context === ctx;
      if (ctx.state !== "running") {
        try {
          await ctx.resume();
        } catch (e) {
          if (live()) throw e;
          return;
        }
      }
      if (!live() || ctx.state !== "running") return;
      if (!bank.verifyRetained(id)) await bank.load(id, ctx);
      if (!live() || ctx.state !== "running") return;
      const entry = bank.get(id);
      if (!bank.verifyRetained(id)) throw new Error("Extra sound unavailable");
      if (engine.voices.size >= 64) return;
      if (context !== ctx) {
        gain?.disconnect();
        context = ctx;
        gain = ctx.createGain();
        gain.gain.value = 0.65 * level;
        gain.connect(engine.master);
      }
      // Two articulations can sound together; same-note retrigger fades, and
      // at most four bank voices (including release tails) may be retained.
      for (const v of voices) if (!engine.voices.has(v)) voices.delete(v);
      const when = ctx.currentTime + 0.005;
      for (const v of voices)
        if (v.pitch === id && !v.extraReleasing) {
          v.extraReleasing = true;
          fadeOutVoice(v, when, 0.012);
          v.source.stop(v.endTime);
        }
      while (voices.size >= 4) {
        const old = voices.values().next().value;
        engine.removeVoice(old);
        voices.delete(old);
      }
      const v = createOneShotVoice(ctx, gain, entry, when, 1);
      v.pitch = id;
      v.id = "extra-" + pack.id + "-" + id;
      voices.add(v);
      engine.voices.add(v);
      engine.stats.created++;
      v.source.onended = () => {
        voices.delete(v);
        engine.removeVoice(v);
      };
      engine.record("extra-pad", { id: pack.id, pitch: id, when });
      return v;
    },
    stop,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      gain?.disconnect();
      bank.dispose();
    },
    snapshot() {
      return {
        voices: [...voices].filter((v) => engine.voices.has(v)).length,
        bank: bank.snapshot(),
      };
    },
  };
}
