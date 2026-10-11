import { createLoopVoice, MASTER_MAX } from "./voice.js";

// Internal QA only: no public export UI or V1.1 acceptance is implied.
export async function renderLoopBank(
  bank,
  volume,
  seconds = 120,
  sampleRate = 48000,
) {
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 120 ||
    volume < 0 ||
    volume > MASTER_MAX
  )
    throw new Error("Unsafe QA render request");
  const context = new OfflineAudioContext(
    1,
    Math.round(seconds * sampleRate),
    sampleRate,
  );
  const master = context.createGain();
  master.gain.value = volume;
  master.connect(context.destination);
  for (const stem of bank.pack.stems) {
    const entry = bank.get(stem.id);
    if (!entry.buffer) throw new Error("QA requires all decoded fixture stems");
    createLoopVoice(context, master, entry, { duration: bank.duration }, 0);
  }
  const result = await context.startRendering();
  master.disconnect();
  return result;
}
