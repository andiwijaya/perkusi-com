import { ProjectError } from "../project/schema.js";

export function wavHeader(frames, sampleRate) {
  if (
    !Number.isInteger(frames) ||
    frames <= 0 ||
    frames > 960000 ||
    sampleRate !== 48000
  )
    throw new ProjectError("exportLimit");
  const data = new ArrayBuffer(44 + frames * 2),
    view = new DataView(data);
  const text = (at, s) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);
  return { data, view };
}
export function throwIfCancelled(signal) {
  if (signal?.aborted) throw new ProjectError("cancelled");
}
export async function encodeWav(
  buffer,
  {
    signal,
    onProgress = () => {},
    yieldTask = () => new Promise((r) => setTimeout(r, 0)),
  } = {},
) {
  throwIfCancelled(signal);
  if (buffer.numberOfChannels !== 1) throw new ProjectError("exportFailed");
  const { data, view } = wavHeader(buffer.length, buffer.sampleRate),
    pcm = buffer.getChannelData(0);
  let peak = 0,
    energy = 0,
    hasEncodedSample = false;
  for (let start = 0; start < pcm.length; start += 32768) {
    throwIfCancelled(signal);
    for (let i = start; i < Math.min(pcm.length, start + 32768); i++) {
      const value = pcm[i];
      if (!Number.isFinite(value) || Math.abs(value) > 0.950001)
        throw new ProjectError("unsafeOutput");
      peak = Math.max(peak, Math.abs(value));
      energy += value * value;
      const encoded = Math.round(value * 32767);
      if (encoded !== 0) hasEncodedSample = true;
      view.setInt16(44 + i * 2, encoded, true);
    }
    onProgress({
      phase: "encoding",
      value: Math.min(1, (start + 32768) / pcm.length),
    });
    await yieldTask();
  }
  throwIfCancelled(signal);
  if (!hasEncodedSample) throw new ProjectError("emptyMix");
  return {
    blob: new Blob([data], { type: "audio/wav" }),
    peak,
    rms: Math.sqrt(energy / pcm.length),
    frames: pcm.length,
    sampleRate: buffer.sampleRate,
  };
}
