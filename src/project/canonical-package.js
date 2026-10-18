import {
  validateCanonicalMetadata,
  inspectCanonicalAssets,
  migrateLegacyMetadata,
} from "./canonical-metadata.js";
import {
  canonicalData,
  canonicalFrozenCopy,
  exact,
  ensure,
  hashBytes,
  MAX_CANONICAL_BYTES,
} from "./canonical-data.js";
import { fail, utf8Bytes } from "./instrument-contract.js";
import { importAudioBundle } from "../loop-station/audio-bundle.js";
const MAGIC = "PKCAN001",
  HEADER = 48,
  MAX_ORIGINALS = 20 * 1024 * 1024,
  MAX_AUDIO = 16 * 1024 * 1024;
export const MAX_CANONICAL_PACKAGE =
  HEADER + MAX_CANONICAL_BYTES + MAX_ORIGINALS + MAX_AUDIO;
const states = new WeakMap(),
  check = (s) => {
    if (s?.aborted) fail("cancelled");
  };
const reserve = (memory, bytes, label) => {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 67108864)
    fail("combinedMemoryLimit");
  return memory.reserve(bytes, label);
};
const view = (map, check) =>
  Object.freeze({
    has: (k) => {
      check();
      return map.has(k);
    },
    get: (k) => {
      check();
      return map.get(k);
    },
  });
function wrap(project, data) {
  data.refs++;
  let disposed = false;
  const check = () => {
    if (disposed) fail("canonicalBundleReleased");
  };
  const bundle = Object.freeze({
    project,
    entries: view(data.entries, check),
    originals: view(data.originals, check),
    backups: view(data.archives, check),
    get backupRefs() {
      check();
      return Object.freeze(
        [...data.archives].map(([sha256, e]) =>
          Object.freeze({ sha256, bytes: e.blob.size, name: e.name }),
        ),
      );
    },
    get backup() {
      check();
      return data.backup ?? null;
    },
    get backupHash() {
      check();
      return data.backupHash ?? null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (--data.refs === 0) {
        data.entries.clear();
        data.originals.clear();
        data.archives.clear();
        data.backup = null;
        data.held.release();
      }
    },
  });
  states.set(bundle, {
    data,
    get disposed() {
      return disposed;
    },
  });
  return bundle;
}
export async function deriveCanonicalBundle(value, bundle, { registry } = {}) {
  const s = states.get(bundle);
  if (!s || s.disposed) fail("canonicalBundleReleased");
  const project = await validateCanonicalMetadata(value, registry);
  if (s.disposed) fail("canonicalBundleReleased");
  ensure(
    JSON.stringify(project.origins) ===
      JSON.stringify(bundle.project.origins) &&
      JSON.stringify(project.assets) === JSON.stringify(bundle.project.assets),
    "canonicalPayloadIdentity",
  );
  return wrap(project, s.data);
}
export function retainCanonicalBundle(bundle) {
  const s = states.get(bundle);
  if (!s || s.disposed) fail("canonicalBundleReleased");
  return wrap(bundle.project, s.data);
}
export async function createCanonicalBundle(
  value,
  {
    registry,
    memory,
    entries = new Map(),
    originals = new Map(),
    backup = null,
    backups = new Map(),
    signal,
  } = {},
) {
  if (!(backups instanceof Map) || backups.size > 33)
    fail("invalidCanonicalPackage");
  const archives = new Map(
    [...backups].map(([k, e]) => [
      k,
      Object.freeze({ blob: e.blob, name: e.name }),
    ]),
  );
  canonicalData(value);
  const input = canonicalFrozenCopy(value),
    captured = new Map(
      input.assets.map((a) => {
        const e = entries.get(a.id);
        return [
          a.id,
          e ? Object.freeze({ blob: e.blob, provenance: e.provenance }) : null,
        ];
      }),
    );
  const project = await validateCanonicalMetadata(input, registry);
  check(signal);
  const rawBytes = project.origins
      .filter((o) => o.kind === "file")
      .reduce((n, o) => n + o.byteLength, 0),
    audioBytes = project.assets.reduce((n, a) => n + a.bytes, 0);
  const archiveBytes = [...archives.values()].reduce(
    (n, e) => n + (e.blob?.size ?? 0),
    0,
  );
  if (rawBytes + archiveBytes > MAX_ORIGINALS || audioBytes > MAX_AUDIO)
    fail("recordingPackageTooLarge");
  if (backup !== null && !(backup instanceof Blob))
    fail("invalidCanonicalPackage");
  const held = reserve(
    memory,
    rawBytes + audioBytes + archiveBytes + (backup?.size ?? 0) + 4096,
    "canonical/immutable-originals-recordings",
  );
  try {
    check(signal);
    const raw = new Map(),
      audio = new Map();
    for (const o of project.origins.filter((o) => o.kind === "file")) {
      const input = await originals.get(o.sha256);
      check(signal);
      if (!(input instanceof Blob || input instanceof Uint8Array))
        fail("missingOriginal");
      raw.set(o.sha256, input instanceof Blob ? input : new Blob([input]));
    }
    for (const a of project.assets) {
      const e = captured.get(a.id);
      if (!(e?.blob instanceof Blob)) fail("missingRecording");
      audio.set(
        a.id,
        Object.freeze({ blob: e.blob, provenance: e.provenance }),
      );
    }
    const inspected = await inspectCanonicalAssets(project, {
      registry,
      memory,
      entries: audio,
      originals: raw,
    });
    check(signal);
    const problem = inspected.issues.find(
      (i) =>
        !["takeRateMismatch", "recordingOffsetUnsupported"].includes(i.code),
    );
    if (problem) fail(problem.code);
    for (const [hash, e] of archives) {
      if (
        !/^[a-f0-9]{64}$/.test(hash) ||
        !(e.blob instanceof Blob) ||
        typeof e.name !== "string" ||
        !e.name.length ||
        e.name.length > 80
      )
        fail("invalidCanonicalPackage");
      const scratch = reserve(
        memory,
        e.blob.size * 2,
        "canonical/source-archive-digest",
      );
      try {
        if ((await hashBytes(await e.blob.arrayBuffer())) !== hash)
          fail("canonicalBackupHash");
        check(signal);
      } finally {
        scratch.release();
      }
    }
    let backupHash = null;
    if (backup) {
      const scratch = reserve(
        memory,
        backup.size * 2,
        "canonical/import-backup-digest",
      );
      try {
        backupHash = await hashBytes(await backup.arrayBuffer());
        check(signal);
      } finally {
        scratch.release();
      }
    }
    return wrap(project, {
      held,
      entries: audio,
      originals: raw,
      archives,
      backup,
      backupHash,
      refs: 0,
    });
  } catch (error) {
    held.release();
    throw error;
  }
}
export async function exportCanonicalPackage(bundle, options = {}) {
  const owned = retainCanonicalBundle(bundle);
  try {
    return await exportCanonicalPackageOwned(owned, options);
  } finally {
    owned.dispose();
  }
}
async function exportCanonicalPackageOwned(bundle, { memory, signal } = {}) {
  const s = states.get(bundle);
  if (!s || s.disposed) fail("canonicalBundleReleased");
  check(signal);
  const parts = [],
    payloads = [];
  let offset = 0;
  const add = (kind, id, sha256, blob, provenance = null) => {
    payloads.push({ kind, id, sha256, offset, bytes: blob.size, provenance });
    parts.push(blob);
    offset += blob.size;
  };
  for (const o of bundle.project.origins.filter((o) => o.kind === "file"))
    add("original", o.id, o.sha256, bundle.originals.get(o.sha256));
  for (const a of bundle.project.assets) {
    const e = bundle.entries.get(a.id);
    add("recording", a.id, a.sha256, e.blob, e.provenance);
  }
  const backups = bundle.backupRefs,
    version = backups.length ? 2 : 1;
  for (const row of backups)
    add("backup", row.sha256, row.sha256, bundle.backups.get(row.sha256).blob);
  const raw = JSON.stringify({
    format: "perkusi-canonical-bundle",
    version,
    project: bundle.project,
    payloads,
    ...(version === 2 ? { backups } : {}),
  });
  if (utf8Bytes(raw) > MAX_CANONICAL_BYTES) fail("projectTooLarge");
  const held = reserve(
    memory,
    2 * (HEADER + utf8Bytes(raw) + offset),
    "canonical/portable-project-output",
  );
  try {
    const bytes = new TextEncoder().encode(raw),
      header = new Uint8Array(HEADER),
      dv = new DataView(header.buffer);
    for (let i = 0; i < 8; i++) header[i] = MAGIC.charCodeAt(i);
    dv.setUint32(8, version, true);
    dv.setUint32(12, bytes.length, true);
    const hash = await hashBytes(bytes);
    check(signal);
    for (let i = 0; i < 32; i++)
      header[16 + i] = parseInt(hash.slice(2 * i, 2 * i + 2), 16);
    let output = new Blob([header, bytes, ...parts], {
      type: "application/octet-stream",
    });
    return {
      get blob() {
        return output;
      },
      release() {
        output = null;
        held.release();
      },
    };
  } catch (error) {
    held.release();
    throw error;
  }
}
export async function importCanonicalPackage(
  blob,
  { registry, memory, signal } = {},
) {
  if (
    !(blob instanceof Blob) ||
    blob.size < HEADER ||
    blob.size > MAX_CANONICAL_PACKAGE
  )
    fail("invalidCanonicalPackage");
  check(signal);
  const headerHeld = reserve(memory, HEADER * 2, "canonical/package-header");
  let head;
  try {
    head = new DataView(await blob.slice(0, HEADER).arrayBuffer());
  } finally {
    headerHeld.release();
  }
  check(signal);
  ensure(
    Array.from({ length: 8 }, (_, i) =>
      String.fromCharCode(head.getUint8(i)),
    ).join("") === MAGIC && [1, 2].includes(head.getUint32(8, true)),
    "invalidCanonicalPackage",
  );
  const length = head.getUint32(12, true);
  ensure(
    length >= 2 &&
      length <= MAX_CANONICAL_BYTES &&
      HEADER + length <= blob.size,
    "invalidCanonicalPackage",
  );
  const held = reserve(memory, length * 2 + 4096, "canonical/package-manifest");
  try {
    const bytes = await blob.slice(HEADER, HEADER + length).arrayBuffer(),
      hash = Array.from({ length: 32 }, (_, i) =>
        head
          .getUint8(16 + i)
          .toString(16)
          .padStart(2, "0"),
      ).join("");
    if ((await hashBytes(bytes)) !== hash) fail("canonicalPackageHash");
    check(signal);
    const manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    canonicalData(manifest);
    exact(manifest, [
      "format",
      "version",
      "project",
      "payloads",
      ...(head.getUint32(8, true) === 2 ? ["backups"] : []),
    ]);
    ensure(
      manifest.format === "perkusi-canonical-bundle" &&
        manifest.version === head.getUint32(8, true),
      "invalidCanonicalPackage",
    );
    const backups = manifest.version === 2 ? manifest.backups : [];
    ensure(
      Array.isArray(backups) && backups.length <= 33,
      "invalidCanonicalPackage",
    );
    const seen = new Set();
    for (const b of backups) {
      exact(b, ["sha256", "bytes", "name"]);
      ensure(
        /^[a-f0-9]{64}$/.test(b.sha256) &&
          !seen.has(b.sha256) &&
          Number.isSafeInteger(b.bytes) &&
          b.bytes >= 0 &&
          b.bytes <= MAX_ORIGINALS &&
          typeof b.name === "string" &&
          b.name.length > 0 &&
          b.name.length <= 80,
        "invalidCanonicalPackage",
      );
      seen.add(b.sha256);
    }
    const project = await validateCanonicalMetadata(manifest.project, registry),
      expected = [
        ...project.origins
          .filter((o) => o.kind === "file")
          .map((o) => ({
            kind: "original",
            id: o.id,
            sha256: o.sha256,
            bytes: o.byteLength,
          })),
        ...project.assets.map((a) => ({
          kind: "recording",
          id: a.id,
          sha256: a.sha256,
          bytes: a.bytes,
        })),
        ...backups.map((b) => ({
          kind: "backup",
          id: b.sha256,
          sha256: b.sha256,
          bytes: b.bytes,
        })),
      ];
    ensure(
      Array.isArray(manifest.payloads) &&
        manifest.payloads.length === expected.length,
      "invalidCanonicalPackage",
    );
    let offset = 0;
    const originals = new Map(),
      entries = new Map(),
      archives = new Map();
    for (let i = 0; i < expected.length; i++) {
      const row = manifest.payloads[i],
        e = expected[i];
      exact(row, ["kind", "id", "sha256", "offset", "bytes", "provenance"]);
      ensure(
        Object.entries(e).every(([k, v]) => row[k] === v) &&
          row.offset === offset &&
          HEADER + length + offset + e.bytes <= blob.size,
        "invalidCanonicalPackage",
      );
      const part = blob.slice(
        HEADER + length + offset,
        HEADER + length + offset + e.bytes,
      );
      if (row.kind === "original") {
        ensure(row.provenance === null, "invalidCanonicalPackage");
        originals.set(row.sha256, part);
      } else if (row.kind === "recording")
        entries.set(row.id, { blob: part, provenance: row.provenance });
      else {
        ensure(row.provenance === null, "invalidCanonicalPackage");
        archives.set(row.sha256, {
          blob: part,
          name: backups.find((b) => b.sha256 === row.sha256).name,
        });
      }
      offset += row.bytes;
    }
    ensure(HEADER + length + offset === blob.size, "invalidCanonicalPackage");
    return await createCanonicalBundle(project, {
      registry,
      memory,
      signal,
      entries,
      originals,
      backup: blob,
      backups: archives,
    });
  } finally {
    held.release();
  }
}
export async function importCanonicalFile(blob, options) {
  if (!(blob instanceof Blob) || blob.size > MAX_CANONICAL_PACKAGE)
    fail("projectTooLarge");
  const first = await blob.slice(0, 8).text();
  check(options.signal);
  if (first === MAGIC) return importCanonicalPackage(blob, options);
  if (first === "PKLOOP01") {
    const legacy = await importAudioBundle(blob, options);
    try {
      const migrated = await migrateLegacyMetadata(
          JSON.stringify(legacy.project),
          options,
        ),
        project = structuredClone(migrated.project),
        origin = project.origins.find(
          (o) => o.id === project.compatibility.rootOriginId,
        ),
        held = reserve(
          options.memory,
          blob.size * 2,
          "canonical/legacy-container-digest",
        );
      try {
        origin.sha256 = await hashBytes(await blob.arrayBuffer());
      } finally {
        held.release();
      }
      origin.blobRef = origin.sha256;
      origin.byteLength = blob.size;
      origin.mediaType = "application/octet-stream";
      return await createCanonicalBundle(project, {
        ...options,
        entries: legacy.entries,
        originals: new Map([[origin.sha256, blob]]),
        backup: blob,
      });
    } finally {
      legacy.release();
    }
  }
  if (blob.size > 2 * 1024 * 1024) fail("projectTooLarge");
  const migrated = await migrateLegacyMetadata(blob, options);
  return createCanonicalBundle(migrated.project, {
    ...options,
    originals: migrated.originals,
    backup: blob,
  });
}
