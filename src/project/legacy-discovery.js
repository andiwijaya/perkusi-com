import { fail } from "./instrument-contract.js";

const specs = [
  ...["studio.v3", "studio.v2", "v1"].flatMap((suffix) => [
    { key: "perkusi.projects." + suffix, kind: "items", limit: 262144 },
    { key: "perkusi.draft." + suffix, kind: "draft", limit: 262144 },
  ]),
  { key: "perkusi.workspace.gamelan.v4", kind: "gamelan", limit: 4194304 },
];
const bytes = (s) => new TextEncoder().encode(s).length;
// Discovery reads bounded metadata only. No store reader with migration/write
// behavior, IndexedDB upgrade, audio decode, or legacy key setter is invoked.
export function discoverLegacyProjects(storage) {
  const rows = [],
    issues = [];
  for (const spec of specs) {
    let raw;
    try {
      raw = storage.getItem(spec.key);
      if (raw === null) continue;
      if (
        typeof raw !== "string" ||
        raw.length > spec.limit ||
        bytes(raw) > spec.limit
      )
        throw Error();
      const value = JSON.parse(raw);
      const add = (id, project) => {
        if (
          typeof id !== "string" ||
          !/^[a-z0-9-]{1,64}$/.test(id) ||
          !project ||
          typeof project !== "object" ||
          Array.isArray(project)
        )
          throw Error();
        const text = JSON.stringify(project);
        if (bytes(text) > spec.limit) throw Error();
        rows.push(
          Object.freeze({
            key: spec.key,
            id,
            raw,
            text,
            title: String(
              project.title ?? project.composition?.title ?? id,
            ).slice(0, 80),
          }),
        );
      };
      const before = rows.length;
      try {
        if (spec.kind === "draft") add("draft", value);
        else {
          if (
            value.version !== (spec.kind === "gamelan" ? 4 : 1) ||
            !Array.isArray(value.items) ||
            value.items.length > 30
          )
            throw Error();
          const ids = new Set();
          for (const item of value.items) {
            if (ids.has(item?.id)) throw Error();
            ids.add(item?.id);
            add(item?.id, item?.project);
          }
          if (spec.kind === "gamelan" && value.draft !== null)
            add("draft", value.draft);
        }
      } catch {
        rows.splice(before);
        throw Error();
      }
    } catch {
      issues.push(spec.key);
    }
  }
  return Object.freeze({
    rows: Object.freeze(rows),
    issues: Object.freeze(issues),
  });
}
export function legacyCopyBlob(row, storage) {
  if (!row || storage.getItem(row.key) !== row.raw) fail("legacySourceChanged");
  return new Blob([row.text], { type: "application/json" });
}
