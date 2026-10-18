import { checkAbort } from "./recording-data.js";
import { fail } from "../project/instrument-contract.js";

// Encode sequential2048-frame chunks into immutable Blob parts. Only a single
// reusable interleave buffer is provisioned; no arrangement-sized PCM/WAV array.
export async function encodeStreamWav(
  { frames, sampleRate },
  meta,
  { memory, signal, produce, beforeAssemble = () => {}, onProgress = () => {} },
) {
  checkAbort(signal);
  if (
    !Number.isInteger(frames) ||
    frames <= 0 ||
    ![44100, 48000].includes(sampleRate)
  )
    fail("finalMixLength");
  const held = memory.reserve(58 + frames * 8, "final-stream-PCM-Blob-parts");
  let scratch,
    metadataLease,
    complete = false,
    written = 0,
    peak = 0;
  const parts = [];
  try {
    scratch = memory.reserve(
      65536 + Math.ceil(frames / 2048) * 256,
      "final-stream-interleave-header/Blob-part-overhead",
    );
    const interleaved = new Uint8Array(2048 * 8),
      view = new DataView(interleaved.buffer);
    await produce((left, right) => {
      checkAbort(signal);
      if (
        left.length !== right.length ||
        left.length > 2048 ||
        written + left.length > frames
      )
        fail("unsafeOutput");
      for (let f = 0; f < left.length; f++)
        for (let c = 0; c < 2; c++) {
          const x = (c ? right : left)[f];
          if (!Number.isFinite(x) || Math.abs(x) > 0.95) fail("unsafeOutput");
          peak = Math.max(peak, Math.abs(x));
          view.setFloat32(f * 8 + c * 4, x, true);
        }
      parts.push(new Blob([interleaved.subarray(0, left.length * 8)]));
      written += left.length;
      onProgress({ phase: "encoding", value: written / frames });
    });
    checkAbort(signal);
    if (written !== frames) fail("unsafeOutput");
    // Drop source plans/windows/cache before admitting a conservative complete
    // Blob-assembly copy. The output and every transient stay charged.
    await beforeAssemble();
    checkAbort(signal);
    const text = JSON.stringify(meta);
    metadataLease = memory.reserve(
      text.length * 6 + 256,
      "final-stream-metadata",
    );
    const comment = new TextEncoder().encode(text + "\0"),
      padded = comment.length + (comment.length % 2);
    if (comment.length > 3 * 1024 * 1024) fail("recordingCreditsRequired");
    const bytes = 58 + frames * 8 + 20 + padded;
    held.resize(bytes * 2);
    const header = new Uint8Array(58),
      h = new DataView(header.buffer),
      tail = new Uint8Array(20 + padded),
      t = new DataView(tail.buffer);
    const tag = (b, at, s) =>
      [...s].forEach((c, i) => (b[at + i] = c.charCodeAt(0)));
    tag(header, 0, "RIFF");
    h.setUint32(4, bytes - 8, true);
    tag(header, 8, "WAVE");
    tag(header, 12, "fmt ");
    h.setUint32(16, 18, true);
    h.setUint16(20, 3, true);
    h.setUint16(22, 2, true);
    h.setUint32(24, sampleRate, true);
    h.setUint32(28, sampleRate * 8, true);
    h.setUint16(32, 8, true);
    h.setUint16(34, 32, true);
    h.setUint16(36, 0, true);
    tag(header, 38, "fact");
    h.setUint32(42, 4, true);
    h.setUint32(46, frames, true);
    tag(header, 50, "data");
    h.setUint32(54, frames * 8, true);
    tag(tail, 0, "LIST");
    t.setUint32(4, 12 + padded, true);
    tag(tail, 8, "INFO");
    tag(tail, 12, "ICMT");
    t.setUint32(16, comment.length, true);
    tail.set(comment, 20);
    const blob = new Blob([header, ...parts, tail], { type: "audio/wav" });
    parts.length = 0;
    complete = true;
    const result = {
      blob,
      frames,
      sampleRate,
      channels: 2,
      peak,
      release() {
        result.blob = null;
        held.release();
      },
    };
    return result;
  } finally {
    parts.length = 0;
    metadataLease?.release();
    scratch?.release();
    if (!complete) held.release();
  }
}
