// Preserved byte-format helpers only; no retired renderer or audio owner.
import { fail } from "../project/instrument-contract.js";
export const MAX_RENDER_SECONDS = 90;
export function wavAttributionChunk(text) {
  if (typeof text !== "string") fail("invalidExportAttribution");
  if (!text) return new Uint8Array(0);
  if (
    typeof text !== "string" ||
    text.includes("\0") ||
    new TextEncoder().encode(text).length > 65534
  )
    fail("invalidExportAttribution");
  const payload = new TextEncoder().encode(text + "\0"),
    bytes = new Uint8Array(20 + payload.length + (payload.length % 2)),
    view = new DataView(bytes.buffer);
  const label = (at, s) =>
    [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  label(0, "LIST");
  view.setUint32(4, bytes.length - 8, true);
  label(8, "INFO");
  label(12, "ICMT");
  view.setUint32(16, payload.length, true);
  bytes.set(payload, 20);
  return bytes;
}
export function instrumentWavHeader(
  frames,
  rate,
  metadata = new Uint8Array(0),
) {
  if (
    !Number.isInteger(frames) ||
    frames <= 0 ||
    ![44100, 48000].includes(rate) ||
    frames > rate * MAX_RENDER_SECONDS
  )
    fail("exportDurationLimit");
  const bytes = new ArrayBuffer(44 + frames * 4 + metadata.length),
    view = new DataView(bytes);
  const text = (offset, s) =>
    [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 4, true);
  new Uint8Array(bytes).set(metadata, 44 + frames * 4);
  return { bytes, view };
}
