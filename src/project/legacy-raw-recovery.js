// Exact storage identities only. Never parse, validate, rewrite or migrate data.
export const RAW_DOCUMENTS = Object.freeze([
  {
    id: "gamelan-workspace",
    area: "localStorage",
    key: "perkusi.workspace.gamelan.v4",
    contractBytes: 4194304,
  },
  {
    id: "gamelan-route",
    area: "sessionStorage",
    key: "perkusi.workspace.instrument-route.v4",
    contractBytes: 3145728,
  },
  {
    id: "loop-draft",
    area: "localStorage",
    key: "perkusi.loop-station.draft.v5",
    contractBytes: 2097152,
  },
  {
    id: "loop-incoming",
    area: "sessionStorage",
    key: "perkusi.loop-station.incoming.v4",
    contractBytes: 2097152,
  },
  {
    id: "loop-profiles",
    area: "localStorage",
    key: "perkusi.loop-station.device-profiles.v1",
    contractBytes: 8192,
  },
  {
    id: "loop-audio-revision",
    area: "localStorage",
    key: "perkusi.loop-station.draft.v5.audio-revision",
  },
]);
const fail = (code) => Object.assign(new Error(code), { code });
export function readRawDocument(id, stores = globalThis) {
  const source = RAW_DOCUMENTS.find((d) => d.id === id);
  if (!source) throw fail("unknownRawDocument");
  return stores[source.area].getItem(source.key);
}
export function rawDocumentFile(id, raw) {
  if (!RAW_DOCUMENTS.some((d) => d.id === id) || typeof raw !== "string")
    throw fail("invalidRawDocument");
  // Covers existing <=4MiB contracts and corrupt/future browser values too.
  // Refusal never truncates or removes the original storage string.
  if (raw.length > 8 * 1024 * 1024) throw fail("rawDocumentTooLarge");
  if (raw.isWellFormed())
    return {
      blob: new Blob([raw], { type: "text/plain;charset=utf-8" }),
      name: id + ".original.txt",
      encoding: "UTF-8",
    };
  // Blob([string]) would replace lone surrogates. Preserve every UTF16 code
  // unit instead; this is a raw text encoding, not JSON reserialization.
  const bytes = new Uint8Array(2 + raw.length * 2),
    view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, true);
  for (let i = 0; i < raw.length; i++)
    view.setUint16(2 + i * 2, raw.charCodeAt(i), true);
  return {
    blob: new Blob([bytes], { type: "application/octet-stream" }),
    name: id + ".original.utf16le.txt",
    encoding: "UTF-16LE+BOM (exact code units)",
  };
}
