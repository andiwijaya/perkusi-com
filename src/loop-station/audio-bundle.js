import {
  recordingProject,
  validateRecording,
  digest,
  checkAbort,
  creditText,
  MAX_AUDIO_BYTES,
} from "./recording-data.js";
import { fail } from "../project/instrument-contract.js";

const MAGIC = "PKLOOP01",
  HEADER = 48,
  MANIFEST = 3 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = HEADER + MANIFEST + MAX_AUDIO_BYTES;
function exact(value, names) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== names.slice().sort().join(",")
  )
    fail("invalidAudioBundle");
}
export async function exportAudioBundle(
  project,
  entries,
  { registry, memory, signal } = {},
) {
  project = recordingProject(project, registry);
  checkAbort(signal);
  const payloads = [],
    blobs = [];
  let offset = 0;
  for (const ref of project.assetRefs) {
    const entry = entries.get(ref.id);
    await validateRecording(ref, entry, { memory, signal });
    payloads.push({
      id: ref.id,
      sha256: ref.sha256,
      offset,
      bytes: ref.bytes,
      provenance: creditText(entry.provenance),
    });
    blobs.push(entry.blob);
    offset += ref.bytes;
  }
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      format: "perkusi-loop-bundle",
      version: 1,
      project,
      payloads,
    }),
  );
  if (manifest.length > MANIFEST) fail("recordingPackageTooLarge");
  const header = new ArrayBuffer(HEADER),
    view = new DataView(header);
  for (let i = 0; i < MAGIC.length; i++) view.setUint8(i, MAGIC.charCodeAt(i));
  view.setUint32(8, 1, true);
  view.setUint32(12, manifest.length, true);
  const hash = await digest(manifest);
  for (let i = 0; i < 32; i++)
    view.setUint8(16 + i, parseInt(hash.slice(i * 2, i * 2 + 2), 16));
  checkAbort(signal);
  const lease = memory?.reserve(
    2 * (HEADER + manifest.length + offset),
    "portable-project-blob",
  );
  try {
    return {
      blob: new Blob([header, manifest, ...blobs], {
        type: "application/octet-stream",
      }),
      release: () => lease?.release(),
    };
  } catch (e) {
    lease?.release();
    throw e;
  }
}
export async function importAudioBundle(
  blob,
  { registry, memory, signal } = {},
) {
  if (
    !(blob instanceof Blob) ||
    blob.size < HEADER ||
    blob.size > MAX_BUNDLE_BYTES
  )
    fail("invalidAudioBundle");
  const lease = memory?.reserve(blob.size * 2, "portable-project-import");
  try {
    checkAbort(signal);
    const header = new DataView(await blob.slice(0, HEADER).arrayBuffer());
    if (
      Array.from({ length: 8 }, (_, i) =>
        String.fromCharCode(header.getUint8(i)),
      ).join("") !== MAGIC ||
      header.getUint32(8, true) !== 1
    )
      fail("invalidAudioBundle");
    const length = header.getUint32(12, true);
    if (length < 2 || length > MANIFEST || HEADER + length > blob.size)
      fail("invalidAudioBundle");
    const bytes = await blob.slice(HEADER, HEADER + length).arrayBuffer(),
      hash = Array.from({ length: 32 }, (_, i) =>
        header
          .getUint8(16 + i)
          .toString(16)
          .padStart(2, "0"),
      ).join("");
    if ((await digest(bytes)) !== hash) fail("recordingHashMismatch");
    let manifest;
    try {
      manifest = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      fail("invalidAudioBundle");
    }
    exact(manifest, ["format", "version", "project", "payloads"]);
    if (
      manifest.format !== "perkusi-loop-bundle" ||
      manifest.version !== 1 ||
      !Array.isArray(manifest.payloads)
    )
      fail("invalidAudioBundle");
    const project = recordingProject(manifest.project, registry),
      entries = new Map();
    if (manifest.payloads.length !== project.assetRefs.length)
      fail("missingRecording");
    let offset = 0;
    for (const [i, ref] of project.assetRefs.entries()) {
      const row = manifest.payloads[i];
      exact(row, ["id", "sha256", "offset", "bytes", "provenance"]);
      if (
        row.id !== ref.id ||
        row.sha256 !== ref.sha256 ||
        row.offset !== offset ||
        row.bytes !== ref.bytes
      )
        fail("invalidAudioBundle");
      const entry = {
        blob: blob.slice(
          HEADER + length + offset,
          HEADER + length + offset + row.bytes,
        ),
        provenance: creditText(row.provenance),
      };
      await validateRecording(ref, entry, { memory, signal });
      entries.set(ref.id, entry);
      offset += row.bytes;
    }
    if (HEADER + length + offset !== blob.size) fail("invalidAudioBundle");
    checkAbort(signal);
    return { project, entries, release: () => lease?.release() };
  } catch (e) {
    lease?.release();
    throw e;
  }
}
