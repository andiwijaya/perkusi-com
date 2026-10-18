import { deriveCanonicalBundle } from "../project/canonical-package.js";
import { fail, utf8Bytes } from "../project/instrument-contract.js";
import { PPQ } from "../project/instrument-project.js";
import { compositionRegistry } from "../project/studio-registry.js";
const check = (ok) => {
  if (!ok) fail("cancelled");
};
const comp = (p, id) => {
  const d = p.sourceDefs.find((d) => d.id === id && d.kind === "composition");
  if (!d) fail("invalidCanonicalSource");
  return d;
};
export function canonicalEditorView(project, sourceId) {
  const d = comp(project, sourceId),
    g = d.programme,
    p = g.patterns.find((p) => p.id === g.activePattern);
  return {
    title: project.title,
    timing: g.timing,
    master: project.master,
    tracks: g.percussion,
    patterns: g.patterns,
    activePattern: g.activePattern,
    chain: g.chain,
    pack: g.pack,
    instrument: g.bilah,
    clips: p.beatbox,
    sourceId: d.id,
  };
}
export async function createCanonicalEditor(
  bundle,
  { registry, memory, controller, onChange = () => {}, maxHistory = 60 } = {},
) {
  if (!Number.isInteger(maxHistory) || maxHistory < 1 || maxHistory > 60)
    fail("canonicalHistoryLimit");
  let closed = false,
    serial = 0,
    revision = 0,
    current = null;
  const past = [],
    future = [];
  const record = async (value, base) => {
    const bytes = utf8Bytes(JSON.stringify(value)),
      held = memory.reserve(
        bytes * 4 + 4096,
        "canonical/editor-document-history",
      );
    let next;
    try {
      next = await deriveCanonicalBundle(value, base, { registry });
      held.resize(bytes * 2 + 4096);
      return { bundle: next, held };
    } catch (e) {
      next?.dispose();
      held.release();
      throw e;
    }
  };
  current = await record(bundle.project, bundle);
  const release = (r) => {
      r.bundle.dispose();
      r.held.release();
    },
    snapshot = () =>
      Object.freeze({
        project: current?.bundle.project ?? null,
        bundle: current?.bundle ?? null,
        revision,
        canUndo: past.length > 0,
        canRedo: future.length > 0,
        closed,
      }),
    emit = () => {
      try {
        onChange(snapshot());
      } catch {
        /* Observer cannot change accepted history. */
      }
    };
  async function accept(make, { history = true, guard = () => true } = {}) {
    if (closed) fail("canonicalEditorClosed");
    const ticket = ++serial,
      base = current;
    let candidate;
    try {
      candidate = await make(base);
      check(!closed && serial === ticket && base === current && guard());
      // Invalidation precedes cleanup; document promotion waits for its ownership
      // acknowledgement. A callback may start a newer editor transaction.
      await controller?.edited();
      check(!closed && serial === ticket && base === current && guard());
      if (history) {
        past.push(current);
        while (past.length > maxHistory) release(past.shift());
      } else release(current);
      future.splice(0).forEach(release);
      current = candidate;
      candidate = null;
      revision++;
      emit();
      return snapshot();
    } finally {
      if (candidate) release(candidate);
    }
  }
  const edit = (fn) =>
    accept(async (base) => {
      const working = memory.reserve(
        utf8Bytes(JSON.stringify(base.bundle.project)) * 2 + 65536,
        "canonical/editor-edit-candidate",
      );
      try {
        const value = structuredClone(base.bundle.project);
        fn(value);
        // An imported canonical file may explicitly share a working definition
        // across song patterns. Refuse an edit through that alias; the visible
        // Duplicate song pattern command creates independent definitions first.
        for (const before of base.bundle.project.sourceDefs) {
          const rootId = before.parentId ?? before.id;
          const uses = base.bundle.project.sections.filter((s) =>
            s.placements.some(
              (a) =>
                a.sourceRef.kind === "working" && a.sourceRef.id === rootId,
            ),
          );
          if (
            uses.length > 1 &&
            JSON.stringify(value.sourceDefs.find((d) => d.id === before.id)) !==
              JSON.stringify(before)
          )
            fail("sharedPatternSource");
        }
        return await record(value, base.bundle);
      } finally {
        working.release();
      }
    });
  async function travel(from, to) {
    if (closed) fail("canonicalEditorClosed");
    const ticket = ++serial;
    if (!from.length) return snapshot();
    const target = from.at(-1),
      base = current;
    await controller?.edited();
    check(
      !closed &&
        serial === ticket &&
        base === current &&
        from.at(-1) === target,
    );
    from.pop();
    to.push(current);
    current = target;
    revision++;
    emit();
    return snapshot();
  }
  return Object.freeze({
    snapshot,
    edit,
    replace: (incoming, options) =>
      accept(() => record(incoming.project, incoming), options),
    undo: () => travel(past, future),
    redo: () => travel(future, past),
    selectPattern: (sourceId, id) =>
      edit((p) => {
        const g = comp(p, sourceId).programme;
        if (!g.patterns.some((a) => a.id === id)) fail("invalidPattern");
        g.activePattern = id;
      }),
    clonePattern: (sourceId, id, name) =>
      edit((p) => {
        const g = comp(p, sourceId).programme;
        if (g.patterns.some((a) => a.id === id) || g.patterns.length >= 16)
          fail("patternLimit");
        const pattern = structuredClone(
          g.patterns.find((a) => a.id === g.activePattern),
        );
        pattern.id = id;
        pattern.name = name;
        g.patterns.push(pattern);
        g.activePattern = id;
      }),
    setChain: (sourceId, ids) =>
      edit((p) => {
        const d = comp(p, sourceId),
          g = d.programme;
        const previousLength = g.chain.length * 4 * PPQ;
        const parent = p.sourceDefs.find(
          (s) =>
            s.kind === "instrument-events" &&
            s.programme.accompanimentRef === d.id,
        );
        if (
          p.transport.kind === "chain" &&
          parent &&
          (ids.length * 4 * PPQ > parent.programme.clock.lengthTicks ||
            (ids.length * 4 * PPQ !== parent.programme.clock.lengthTicks &&
              p.sections.some((s) =>
                s.placements.some(
                  (a) => a.sourceRef.id === parent.id && a.loop,
                ),
              )))
        )
          fail("hubRegionUnsupported");
        g.chain = [...ids];
        for (const section of p.sections)
          for (const placement of section.placements) {
            if (
              placement.sourceRef.id === sourceId &&
              placement.offsetFrames === 0 &&
              placement.lengthTicks === previousLength
            ) {
              placement.lengthTicks = ids.length * 4 * PPQ;
              section.lengthTicks = Math.max(
                section.lengthTicks,
                placement.startTick + placement.lengthTicks,
              );
            }
          }
        if (
          p.transport.kind === "legacy-score" &&
          p.sourceDefs.some(
            (s) =>
              s.kind === "instrument-events" &&
              s.programme.accompanimentRef === d.id,
          )
        )
          p.transport.accompanimentLengthTicks = ids.length * 4 * PPQ;
        if (
          d.parentId === null &&
          p.transport.kind !== "chain" &&
          p.sections.length === 1 &&
          p.sections[0].placements.length === 1 &&
          p.sections[0].placements[0].sourceRef.id === d.id
        ) {
          p.sections[0].lengthTicks = ids.length * 4 * PPQ;
          p.sections[0].placements[0].lengthTicks = ids.length * 4 * PPQ;
        }
      }),
    setBeatbox: (sourceId, role, field, value) =>
      edit((p) => {
        const g = comp(p, sourceId).programme;
        if (
          ![
            "enabled",
            "variant",
            "volume",
            "pan",
            "mute",
            "solo",
            "phasePolicy",
          ].includes(field)
        )
          fail("invalidPatternControl");
        const b = g.patterns
          .find((a) => a.id === g.activePattern)
          .beatbox.find((b) => b.role === role);
        if (!b) fail("invalidPatternControl");
        b[field] = value;
      }),
    setStep: (sourceId, role, index, value) =>
      edit((p) => {
        const g = comp(p, sourceId).programme;
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= 16 ||
          !Object.hasOwn(g.patterns[0].steps, role)
        )
          fail("invalidPattern");
        g.patterns.find((a) => a.id === g.activePattern).steps[role][index] =
          value;
      }),
    setNote: (sourceId, index, note) =>
      edit((p) => {
        const g = comp(p, sourceId).programme;
        if (!Number.isInteger(index) || index < 0 || index >= 16)
          fail("invalidPattern");
        g.patterns.find((a) => a.id === g.activePattern).notes[index] = note;
      }),
    setTempo: (bpm) =>
      edit((p) => {
        if (!Number.isFinite(bpm) || bpm < 60 || bpm > 180)
          fail("invalidTempo");
        if (
          p.timing.clock.kind !== "musical" ||
          p.sections.some((s) =>
            s.placements.some((a) => a.sourceRef.kind === "asset"),
          ) ||
          p.sourceDefs.some(
            (d) =>
              d.kind === "composition" &&
              d.programme.patterns.some((a) =>
                a.beatbox.some((b) => b.enabled),
              ),
          )
        )
          fail("recordedTempoLocked");
        p.timing.bpm = bpm;
        for (const d of p.sourceDefs)
          if (d.kind === "composition") d.programme.timing.bpm = bpm;
      }),
    setSwing: (sourceId, swing) =>
      edit((p) => {
        if (!Number.isFinite(swing) || swing < 0 || swing > 0.5)
          fail("invalidSwing");
        comp(p, sourceId).programme.timing.swing = swing;
      }),
    setKit: (sourceId, id) =>
      edit((p) => {
        const kit = compositionRegistry.kits.find((k) => k.id === id);
        if (!kit) fail("unknownPack");
        comp(p, sourceId).programme.pack = {
          id,
          version: compositionRegistry.version,
        };
      }),
    addNative: (sourceId, event) =>
      edit((p) => {
        const d = p.sourceDefs.find(
          (d) => d.id === sourceId && d.kind === "instrument-events",
        );
        if (!d) fail("invalidNativeEdit");
        const bank = d.programme.banks.find((b) => b.id === event.bankId);
        if (!bank || !["strike", "damp"].includes(event.action))
          fail("invalidNativeEdit");
        registry.sample(bank.id, bank.version, event.sampleId);
        if (
          !Number.isSafeInteger(event.tick) ||
          event.tick < 0 ||
          event.tick >= d.programme.clock.lengthTicks
        )
          fail("invalidNativeEdit");
        if (
          d.programme.events.some(
            (e) =>
              e.tick === event.tick &&
              e.bankId === event.bankId &&
              e.sampleId === event.sampleId &&
              e.action === event.action,
          )
        )
          fail("nativeEventCollision");
        let n = 1;
        while (d.programme.events.some((e) => e.id === "edited-event-" + n))
          n++;
        d.programme.events.push({
          ...event,
          id: "edited-event-" + n,
          velocity: event.action === "damp" ? 0 : event.velocity,
        });
        d.programme.events.sort((a, b) => a.tick - b.tick);
      }),
    deleteNative: (sourceId, eventId) =>
      edit((p) => {
        const d = p.sourceDefs.find(
          (d) => d.id === sourceId && d.kind === "instrument-events",
        );
        if (!d || !d.programme.events.some((e) => e.id === eventId))
          fail("invalidNativeEdit");
        d.programme.events = d.programme.events.filter((e) => e.id !== eventId);
      }),
    setNativeLength: (sourceId, ticks) =>
      edit((p) => {
        const d = p.sourceDefs.find(
          (d) => d.id === sourceId && d.kind === "instrument-events",
        );
        if (!d) fail("invalidNativeEdit");
        const previous = d.programme.clock.lengthTicks;
        d.programme.clock.lengthTicks = ticks;
        if (p.transport.kind === "legacy-score")
          p.transport.nativeLengthTicks = ticks;
        for (const section of p.sections)
          for (const placement of section.placements) {
            if (
              placement.sourceRef.id === sourceId &&
              placement.lengthTicks === previous
            ) {
              placement.lengthTicks = ticks;
              section.lengthTicks = Math.max(
                section.lengthTicks,
                placement.startTick + ticks,
              );
            }
          }
      }),
    editNative: (sourceId, eventId, patch) =>
      edit((p) => {
        const d = p.sourceDefs.find(
            (d) => d.id === sourceId && d.kind === "instrument-events",
          ),
          e = d?.programme.events.find((e) => e.id === eventId);
        if (
          !e ||
          Object.keys(patch).some(
            (k) =>
              !["tick", "velocity", "action", "bankId", "sampleId"].includes(k),
          )
        )
          fail("invalidNativeEdit");
        Object.assign(e, patch);
      }),
    async dispose() {
      if (!closed) {
        closed = true;
        serial++;
      }
      await controller?.stop();
      if (current) {
        release(current);
        current = null;
      }
      past.splice(0).forEach(release);
      future.splice(0).forEach(release);
    },
  });
}
