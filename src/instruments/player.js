import { AudioEngine } from "../audio/engine.js";
import { createOneShotVoice, fadeOutVoice } from "../audio/voice.js";
import { createProgrammeOutputStage } from "../audio/programme-output.js";
import { SampleBank } from "../audio/sample-bank.js";

// A single selected bank using the existing admission, decode queue, envelopes,
// output ceiling and disposal. No sequencer, loop banks or other instruments.
export function createArticlePlayer(
  { pack, level = 1 },
  { family, contextFactory, bankOptions } = {},
) {
  // Context ownership stays with AudioEngine. Its transport bank is never
  // loaded or started. As in CompositionBanks, the playable instrument bank
  // is registered separately: selected notes are not simultaneous loop stems.
  const engine = new AudioEngine(
    { ...pack, stems: [pack.stems[0]] },
    {
      ...(contextFactory ? { contextFactory } : {}),
      bankOptions: { ...bankOptions, maxOneShotSeconds: 30 },
      outputStageFactory: createProgrammeOutputStage,
    },
  );
  const bank = new SampleBank(pack, {
    ...bankOptions,
    maxOneShotSeconds: 30,
    validateCandidate: (entry, metrics) =>
      engine.admitCandidate(entry, metrics),
  });
  engine.banks.add(bank);
  engine.setVolume(0.5);
  let generation = 0,
    disposed = false,
    gain,
    gainContext;
  const isReady = () =>
    !disposed && pack.stems.every((s) => bank.verifyRetained(s.id));
  const stop = () => {
    generation++;
    engine.operation++;
    engine.clearVoices(true);
  };
  return {
    async prepare(onProgress = () => {}) {
      if (disposed) throw new Error("Disposed player");
      const context = engine.ensureContext();
      const report = () => {
        if (!disposed)
          onProgress(
            pack.stems.filter((s) => bank.verifyRetained(s.id)).length,
            pack.stems.length,
          );
      };
      report();
      await Promise.all(
        pack.stems.map(async (stem) => {
          await bank.load(stem.id, context);
          report();
        }),
      );
      if (disposed || !isReady()) throw new Error("Incomplete instrument bank");
    },
    isReady,
    async play(id) {
      if (!isReady() || !pack.stems.some((s) => s.id === id))
        throw new Error("Sound unavailable");
      const intent = generation,
        context = engine.ensureContext();
      if (context.state !== "running") await context.resume();
      if (disposed || intent !== generation || context.state !== "running")
        return;
      if (engine.voices.size >= 16) return;
      if (context !== gainContext) {
        gain?.disconnect();
        gain = context.createGain();
        gain.gain.value = 0.65 * level;
        gain.connect(engine.master);
        gainContext = context;
      }
      const when = context.currentTime + 0.005;
      for (const old of engine.voices) {
        const choke =
          family === "bass-elektrik" ||
          old.pitch === id ||
          (family === "drum" &&
            id === "closed-hat" &&
            old.pitch === "open-hat");
        if (choke && !old.articleReleasing) {
          old.articleReleasing = true;
          fadeOutVoice(old, when, family === "bass-elektrik" ? 0.02 : 0.012);
          old.source.stop(old.endTime);
        }
      }
      const voice = createOneShotVoice(context, gain, bank.get(id), when, 1);
      voice.pitch = id;
      engine.voices.add(voice);
      engine.stats.created++;
      voice.source.onended = () => engine.removeVoice(voice);
      return voice;
    },
    stop,
    setVolume(value) {
      engine.setVolume(value);
    },
    snapshot() {
      return {
        disposed,
        ready: isReady(),
        voices: engine.voices.size,
        created: engine.stats.created,
        context: engine.context?.state ?? "none",
        bank: bank.snapshot(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      gain?.disconnect();
      return engine.dispose({ immediate: true });
    },
  };
}
