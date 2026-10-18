// Select only trusted catalog receipts referenced by the document. A project
// cannot introduce a URL, author or permission by supplying a credit string.
export function canonicalDocumentCredits(project, catalog) {
  const used = new Set();
  const key = (r) =>
    JSON.stringify([
      r.kind,
      r.bankId,
      r.version,
      r.sampleId,
      r.pack?.id,
      r.pack?.version,
      r.pack?.processing,
      r.role,
      r.variant,
      r.pitch,
    ]);
  for (const d of project.sourceDefs) {
    const p = d.programme;
    if (d.kind === "instrument-events") {
      for (const e of p.events) {
        const bank = p.banks.find((b) => b.id === e.bankId);
        used.add(
          key({
            kind: "instrument",
            bankId: e.bankId,
            version: bank?.version,
            sampleId: e.sampleId,
          }),
        );
      }
    } else if (d.kind === "composition") {
      for (const pattern of p.patterns) {
        for (const [role, steps] of Object.entries(pattern.steps))
          if (steps.some(Boolean))
            used.add(key({ kind: "percussion", pack: p.pack, role }));
        for (const n of pattern.notes)
          if (n)
            used.add(
              key({
                kind: "bilah",
                pack: { id: p.bilah.id, version: p.bilah.version },
                pitch: n.pitch,
              }),
            );
        for (const b of pattern.beatbox)
          if (b.enabled)
            used.add(
              key({
                kind: "phrase",
                pack: p.clipPack,
                role: b.role,
                variant: b.variant,
              }),
            );
      }
    }
  }
  return catalog.filter((r) => used.has(key(r.request)));
}
