import { checkAbort } from "./recording-data.js";
import { fail } from "../project/instrument-contract.js";
export async function encodeFinalWav(
  buffer,
  meta,
  {
    memory,
    signal,
    onProgress = () => {},
    yieldTask = () => new Promise((r) => setTimeout(r, 0)),
  },
) {
  const comment = new TextEncoder().encode(JSON.stringify(meta) + "\0"),
    padded = comment.length + (comment.length % 2);
  if (comment.length > 3 * 1024 * 1024) fail("recordingCreditsRequired");
  const bytes = 58 + buffer.length * 8 + 20 + padded,
    lease = memory.reserve(
      bytes * 2 + comment.length * 2,
      "final-WAV-and-Blob",
    );
  let data;
  try {
    data = new ArrayBuffer(bytes);
    const v = new DataView(data),
      tag = (at, text) => {
        for (let i = 0; i < text.length; i++)
          v.setUint8(at + i, text.charCodeAt(i));
      };
    tag(0, "RIFF");
    v.setUint32(4, bytes - 8, true);
    tag(8, "WAVE");
    tag(12, "fmt ");
    v.setUint32(16, 18, true);
    v.setUint16(20, 3, true);
    v.setUint16(22, 2, true);
    v.setUint32(24, buffer.sampleRate, true);
    v.setUint32(28, buffer.sampleRate * 8, true);
    v.setUint16(32, 8, true);
    v.setUint16(34, 32, true);
    v.setUint16(36, 0, true);
    tag(38, "fact");
    v.setUint32(42, 4, true);
    v.setUint32(46, buffer.length, true);
    tag(50, "data");
    v.setUint32(54, buffer.length * 8, true);
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
    let peak = 0;
    for (let from = 0; from < buffer.length; from += 32768) {
      checkAbort(signal);
      for (let f = from; f < Math.min(buffer.length, from + 32768); f++)
        for (let c = 0; c < 2; c++) {
          const x = channels[c][f];
          if (!Number.isFinite(x) || Math.abs(x) > 0.95) fail("unsafeOutput");
          peak = Math.max(peak, Math.abs(x));
          v.setFloat32(58 + (f * 2 + c) * 4, x, true);
        }
      onProgress({
        phase: "encoding",
        value: Math.min(1, (from + 32768) / buffer.length),
      });
      await yieldTask();
    }
    const at = 58 + buffer.length * 8;
    tag(at, "LIST");
    v.setUint32(at + 4, 12 + padded, true);
    tag(at + 8, "INFO");
    tag(at + 12, "ICMT");
    v.setUint32(at + 16, comment.length, true);
    new Uint8Array(data, at + 20, comment.length).set(comment);
    checkAbort(signal);
    const result = {
      blob: new Blob([data], { type: "audio/wav" }),
      frames: buffer.length,
      channels: 2,
      sampleRate: buffer.sampleRate,
      peak,
      release: () => {
        result.blob = null;
        lease.release();
      },
    };
    return result;
  } catch (e) {
    lease.release();
    throw e;
  }
}
