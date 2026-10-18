import { parseProject, validateProject, cleanTitle } from "./schema.js";
import { compositionRegistry } from "./studio-registry.js";
import { originalRegistry } from "./original-registry.js";
import {
  fromStudio,
  studioView,
  toBeatbox,
  CLIP_ROLES,
  newCompositionClip,
} from "./composition-model.js";
import {
  parseInstrumentProject,
  validateInstrumentProject,
  PPQ,
  MAX_EVENT_TICK,
} from "./instrument-project.js";
import {
  parseLoopProject,
  validateLoopProject,
} from "../loop-station/project.js";
import { phaseAdvance } from "../loop-station/phase-alignment.js";
import {
  FLAT_EQ,
  BYPASS_LIMITER,
  validateEQ,
  validateLimiter,
} from "../loop-station/fx-model.js";
import {
  integer,
  finite,
  identifier,
  frozenCopy,
  utf8Bytes,
  fail,
} from "./instrument-contract.js";
import { materializeLegacyPatternControls } from "./pattern-controls.js";
import {
  canonicalData,
  exact,
  list,
  ensure,
  sameData,
  hashBytes,
  MAX_CANONICAL_BYTES,
  canonicalFrozenCopy,
} from "./canonical-data.js";
import { placementCandidateCount } from "./arrangement-contract.js";

const F = "perkusi-project",
  V = 6,
  clone = structuredClone;
const rootKeys = [
  "format",
  "schemaVersion",
  "mode",
  "title",
  "timing",
  "master",
  "tuningConsent",
  "transport",
  "activeSection",
  "tracks",
  "sections",
  "chain",
  "sourceDefs",
  "origins",
  "assets",
  "compatibility",
  "export",
];
const sourceKeys = [
  "id",
  "kind",
  "originId",
  "workingOriginId",
  "parentId",
  "master",
  "programme",
];
const presence = (c, path) => c.compatibility.fieldPresence.includes(path);
const rolesFor = (c, id) =>
  c.compatibility.rolePresence.find((r) => r.sourceId === id)?.roles ?? [];
const group = (c, id) => {
  const d = c.sourceDefs.find((d) => d.id === id);
  ensure(d);
  return d;
};
const origin = (c, id) => {
  const o = c.origins.find((o) => o.id === id);
  ensure(o);
  return o;
};
const mapping = (c, kind) =>
  c.compatibility.idMap.filter((m) => m.kind === kind);
const mixKeys = ["volume", "pan", "mute", "solo"];
function mix(m) {
  exact(m, mixKeys);
  ensure(
    finite(m.volume, 0, 1) &&
      finite(m.pan, -1, 1) &&
      typeof m.mute === "boolean" &&
      typeof m.solo === "boolean",
  );
}
function oldClock(c) {
  return c.timing.clock.kind === "musical"
    ? { kind: "musical" }
    : clone(c.timing.clock);
}
function masterValue(c, d) {
  return d.master.binding === "project"
    ? c.master.volume
    : d.master.binding === "local"
      ? d.master.volume
      : masterValue(c, group(c, d.parentId));
}
function rawControl(control) {
  const out = {};
  for (const k of ["role", "variant", "enabled", ...mixKeys])
    out[k] = control[k];
  return out;
}
function composition(c, d, checking = false) {
  const p = d.programme,
    first = p.patterns[0].beatbox;
  if (!checking)
    ensure(
      p.patterns.every((a) => sameData(a.beatbox, first)) &&
        first.every((a) => a.phasePolicy === "continue-source"),
      "needsConversion",
    );
  const requested = rolesFor(c, d.id),
    selected = [...requested];
  for (const control of first)
    if (
      !selected.includes(control.role) &&
      !sameData(rawControl(control), newCompositionClip(control.role))
    )
      selected.push(control.role);
  const clips = selected.map((role) =>
    rawControl(first.find((a) => a.role === role)),
  );
  return {
    format: F,
    schemaVersion: 3,
    mode: "composition",
    title: p.title,
    pack: clone(p.pack),
    timing: clone(p.timing),
    master: { volume: checking ? 0 : masterValue(c, d) },
    tracks: clone(p.percussion),
    patterns: p.patterns.map((a) => ({
      id: a.id,
      name: a.name,
      steps: clone(a.steps),
      notes: clone(a.notes),
    })),
    activePattern: p.activePattern,
    chain: clone(p.chain),
    export: clone(p.export),
    clipPack: clone(p.clipPack),
    clips,
    instrument: clone(p.bilah),
  };
}
function legacyGroup(c, d, checking = false) {
  if (d.kind === "composition") return composition(c, d, checking);
  const p = d.programme,
    child = group(c, p.accompanimentRef),
    o = origin(c, child.originId);
  ensure(o.kind === "embedded-text");
  const out = {
    format: F,
    schemaVersion: 4,
    mode: "instrument-events",
    composition: composition(c, child, checking),
    origin: { schemaVersion: o.schemaVersion, text: o.text },
    clock: clone(p.clock),
    banks: clone(p.banks),
    events: clone(p.events),
  };
  if (
    checking ||
    presence(c, d.id + "/instrumentMix") ||
    p.instrumentMix.length
  )
    out.instrumentMix = clone(p.instrumentMix);
  if (checking || presence(c, d.id + "/tuningConsent") || p.tuningConsent)
    out.tuningConsent = p.tuningConsent;
  return out;
}
function sourceInfo(c, d) {
  const p =
    d.kind === "composition"
      ? d.programme
      : group(c, d.programme.accompanimentRef).programme;
  return {
    bpm: p.timing.bpm,
    lengthTicks:
      d.kind === "composition"
        ? p.chain.length * 4 * PPQ
        : d.programme.clock.lengthTicks,
  };
}
function validateCompositionDef(c, d) {
  const p = d.programme;
  exact(p, [
    "title",
    "pack",
    "timing",
    "percussion",
    "bilah",
    "clipPack",
    "patterns",
    "activePattern",
    "chain",
    "export",
  ]);
  list(p.patterns, 1, 16);
  for (const a of p.patterns) {
    exact(a, ["id", "name", "steps", "notes", "beatbox"]);
    list(a.beatbox, 6, 6);
    for (const [i, b] of a.beatbox.entries()) {
      exact(b, ["role", "variant", "enabled", ...mixKeys, "phasePolicy"]);
      ensure(
        b.role === CLIP_ROLES[i] &&
          ["continue-source", "restart-on-entry"].includes(b.phasePolicy),
      );
    }
    const old = composition(c, d, true);
    old.clips = a.beatbox.map(rawControl);
    validateProject(old, compositionRegistry);
  }
}

export async function validateCanonicalMetadata(value, registry) {
  canonicalData(value);
  // Hashing below yields. Guard and snapshot synchronously so callers retain
  // ownership without being able to alter the state under validation.
  const c = canonicalFrozenCopy(value);
  exact(c, [
    ...rootKeys,
    ...(Object.hasOwn(c, "mixPolicy") ? ["mixPolicy"] : []),
  ]);
  if (Object.hasOwn(c, "mixPolicy")) ensure(c.mixPolicy === "unified-outer-v1");
  ensure(c.format === F && c.schemaVersion === V && c.mode === "composition");
  cleanTitle(c.title);
  ensure(typeof c.tuningConsent === "boolean");
  exact(c.timing, ["bpm", "meter", "clock"]);
  ensure(finite(c.timing.bpm, 60, 180) && sameData(c.timing.meter, [4, 4]));
  if (c.timing.clock?.kind === "musical") {
    exact(c.timing.clock, ["kind", "ppq"]);
    ensure(c.timing.clock.ppq === PPQ);
  } else {
    exact(c.timing.clock, ["kind", "sampleRate", "framesPerBar"]);
    ensure(
      c.timing.clock.kind === "fixed-bar" &&
        integer(c.timing.clock.sampleRate, 8000, 192000) &&
        c.timing.clock.framesPerBar ===
          Math.round((4 * 60 * c.timing.clock.sampleRate) / c.timing.bpm),
    );
  }
  exact(c.master, ["volume", "limiter"]);
  ensure(finite(c.master.volume, 0, 1));
  validateLimiter(c.master.limiter);
  exact(c.transport, ["kind", "nativeLengthTicks", "accompanimentLengthTicks"]);
  ensure(
    ["chain", "legacy-beatbox", "legacy-score", "legacy-continuous"].includes(
      c.transport.kind,
    ),
  );
  for (const k of ["nativeLengthTicks", "accompanimentLengthTicks"])
    ensure(
      c.transport[k] === null || integer(c.transport[k], 1, MAX_EVENT_TICK),
    );
  exact(c.export, ["scope", "bars", "tailPolicy"]);
  ensure(
    ["arrangement", "active-section"].includes(c.export.scope) &&
      [null, 4, 8].includes(c.export.bars) &&
      c.export.tailPolicy === "full-natural-tail",
  );
  exact(c.compatibility, [
    "sourceVersion",
    "rootOriginId",
    "fieldPresence",
    "rolePresence",
    "idMap",
  ]);
  ensure(integer(c.compatibility.sourceVersion, 0, 5));
  list(c.compatibility.fieldPresence, 0, 1024);
  ensure(
    c.compatibility.fieldPresence.every(
      (p, i, a) =>
        typeof p === "string" && p.length <= 256 && (i === 0 || a[i - 1] < p),
    ),
  );
  list(c.compatibility.rolePresence, 0, 32);
  list(c.compatibility.idMap, 0, 1024);
  list(c.origins, 1, 33);
  list(c.sourceDefs, 0, 32);
  list(c.assets, 0, 128);
  list(c.tracks, 0, 8);
  list(c.sections, 1, 16);
  list(c.chain, 0, 8);
  const originIds = new Set(),
    sourceIds = new Set(),
    assetIds = new Set(),
    trackIds = new Set(),
    sectionIds = new Set(),
    placementIds = new Set();
  for (const o of c.origins) {
    exact(o, [
      "id",
      "kind",
      "schemaVersion",
      "mediaType",
      "byteLength",
      "sha256",
      "blobRef",
      "text",
    ]);
    ensure(
      identifier(o.id) &&
        !originIds.has(o.id) &&
        integer(o.schemaVersion, 0, 5) &&
        typeof o.mediaType === "string" &&
        o.mediaType.length <= 128 &&
        integer(o.byteLength, 0, 20 * 1024 * 1024) &&
        /^[a-f0-9]{64}$/.test(o.sha256),
    );
    originIds.add(o.id);
    if (o.kind === "file") ensure(o.text === null && o.blobRef === o.sha256);
    else {
      ensure(
        o.kind === "embedded-text" &&
          o.blobRef === null &&
          typeof o.text === "string" &&
          utf8Bytes(o.text) === o.byteLength &&
          (await hashBytes(new TextEncoder().encode(o.text))) === o.sha256,
      );
      ensure(o.schemaVersion <= 4);
      if (o.schemaVersion === 4) parseInstrumentProject(o.text, registry);
      else parseProject(o.text, compositionRegistry);
    }
  }
  const root = origin(c, c.compatibility.rootOriginId);
  ensure(
    root.kind === "file" &&
      root.schemaVersion === c.compatibility.sourceVersion,
  );
  for (const d of c.sourceDefs) {
    exact(d, sourceKeys);
    ensure(
      identifier(d.id) &&
        !sourceIds.has(d.id) &&
        ["composition", "instrument-events"].includes(d.kind) &&
        originIds.has(d.originId) &&
        (d.workingOriginId === null ||
          (originIds.has(d.workingOriginId) &&
            origin(c, d.workingOriginId).kind === "embedded-text" &&
            origin(c, d.workingOriginId).schemaVersion === 4 &&
            d.kind === "instrument-events")),
    );
    sourceIds.add(d.id);
    exact(d.master, ["binding", "volume"]);
    exact(
      d.programme,
      d.kind === "composition"
        ? [
            "title",
            "pack",
            "timing",
            "percussion",
            "bilah",
            "clipPack",
            "patterns",
            "activePattern",
            "chain",
            "export",
          ]
        : [
            "clock",
            "banks",
            "events",
            "instrumentMix",
            "tuningConsent",
            "accompanimentRef",
          ],
    );
    ensure(["project", "local", "parent"].includes(d.master.binding));
    ensure(
      d.master.binding === "local"
        ? finite(
            d.master.volume,
            0,
            c.mixPolicy === "unified-outer-v1" ? 1 : 0.75,
          )
        : d.master.volume === null,
    );
    if (d.parentId === null) ensure(d.master.binding !== "parent");
    else
      ensure(
        d.master.binding === "parent" &&
          d.kind === "composition" &&
          d.parentId !== d.id,
      );
    if (c.mixPolicy === "unified-outer-v1")
      ensure(d.master.binding !== "project");
  }
  const roleIds = new Set();
  for (const row of c.compatibility.rolePresence) {
    exact(row, ["sourceId", "roles"]);
    ensure(
      sourceIds.has(row.sourceId) &&
        group(c, row.sourceId).kind === "composition" &&
        !roleIds.has(row.sourceId),
    );
    roleIds.add(row.sourceId);
    list(row.roles, 0, 6);
    ensure(
      new Set(row.roles).size === row.roles.length &&
        row.roles.every((r) => CLIP_ROLES.includes(r)),
    );
  }
  for (const d of c.sourceDefs) {
    if (d.parentId !== null) {
      const p = group(c, d.parentId);
      ensure(
        p.kind === "instrument-events" &&
          p.parentId === null &&
          p.programme.accompanimentRef === d.id,
      );
    }
    if (d.kind !== "composition") {
      const p = d.programme;
      exact(p, [
        "clock",
        "banks",
        "events",
        "instrumentMix",
        "tuningConsent",
        "accompanimentRef",
      ]);
      const child = group(c, p.accompanimentRef);
      ensure(child.kind === "composition" && child.parentId === d.id);
    }
  }
  for (const d of c.sourceDefs.filter((d) => d.kind === "composition")) {
    ensure(roleIds.has(d.id));
    validateCompositionDef(c, d);
  }
  for (const d of c.sourceDefs.filter((d) => d.kind === "instrument-events"))
    validateInstrumentProject(legacyGroup(c, d, true), registry);
  for (const a of c.assets) {
    exact(a, [
      "id",
      "kind",
      "sha256",
      "bytes",
      "frames",
      "channels",
      "sampleRate",
      "encoding",
      "recordedBpm",
      "creditsRef",
    ]);
    ensure(
      identifier(a.id) &&
        !assetIds.has(a.id) &&
        a.kind === "recording" &&
        /^[a-f0-9]{64}$/.test(a.sha256) &&
        [1, 2].includes(a.channels) &&
        integer(a.sampleRate, 8000, 192000) &&
        integer(a.frames, 1, a.sampleRate * 32) &&
        a.bytes === a.frames * a.channels * 4 &&
        a.encoding === "float32le" &&
        a.recordedBpm === c.timing.bpm &&
        typeof a.creditsRef === "string" &&
        a.creditsRef.length > 0 &&
        a.creditsRef.length <= 256,
    );
    assetIds.add(a.id);
  }
  for (const t of c.tracks) {
    exact(t, ["id", "kind", "name", "mix", "fx", "layering"]);
    ensure(
      identifier(t.id) &&
        !trackIds.has(t.id) &&
        ["group", "recording", "hybrid"].includes(t.kind),
    );
    trackIds.add(t.id);
    cleanTitle(t.name);
    mix(t.mix);
    exact(t.fx, ["eq"]);
    validateEQ(t.fx.eq);
    if (t.layering !== null) {
      exact(t.layering, ["version", "basePlacementId", "overdubPlacementId"]);
      ensure(t.layering.version === 1);
    }
  }
  let totalPlacements = 0;
  for (const s of c.sections) {
    exact(s, ["id", "name", "lengthTicks", "placements"]);
    ensure(
      identifier(s.id) &&
        !sectionIds.has(s.id) &&
        integer(s.lengthTicks, 1, MAX_EVENT_TICK),
    );
    sectionIds.add(s.id);
    cleanTitle(s.name);
    list(s.placements, 0, 256);
    totalPlacements += s.placements.length;
    ensure(totalPlacements <= 256);
    for (const p of s.placements) {
      exact(p, [
        "id",
        "trackId",
        "sourceRef",
        "startTick",
        "lengthTicks",
        "offsetFrames",
        "loop",
        "phasePolicy",
        "alignment",
      ]);
      exact(p.sourceRef, ["kind", "id"]);
      ensure(
        identifier(p.id) &&
          !placementIds.has(p.id) &&
          trackIds.has(p.trackId) &&
          integer(p.startTick, 0, MAX_EVENT_TICK) &&
          integer(p.lengthTicks, 1, MAX_EVENT_TICK - p.startTick) &&
          integer(p.offsetFrames, 0, Number.MAX_SAFE_INTEGER) &&
          typeof p.loop === "boolean" &&
          ["continuous", "restart-on-entry"].includes(p.phasePolicy),
      );
      placementIds.add(p.id);
      const t = c.tracks.find((t) => t.id === p.trackId);
      if (p.sourceRef.kind === "working") {
        ensure(
          sourceIds.has(p.sourceRef.id) &&
            group(c, p.sourceRef.id).parentId === null,
        );
        const info = sourceInfo(c, group(c, p.sourceRef.id));
        ensure(
          t.kind !== "recording" &&
            p.offsetFrames === 0 &&
            p.alignment === null &&
            p.lengthTicks <= info.lengthTicks &&
            info.bpm === c.timing.bpm,
        );
      } else {
        ensure(
          p.sourceRef.kind === "asset" &&
            assetIds.has(p.sourceRef.id) &&
            t.kind !== "group",
        );
        const ref = c.assets.find((a) => a.id === p.sourceRef.id);
        ensure(
          p.offsetFrames < ref.frames &&
            (p.loop ||
              p.offsetFrames +
                Math.round(
                  (p.lengthTicks * ref.sampleRate * 60) / c.timing.bpm / PPQ,
                ) <=
                ref.frames),
        );
        phaseAdvance(
          {
            ...p,
            ...(p.alignment === null ? {} : { phaseAlignment: p.alignment }),
          },
          ref,
          oldClock(c),
        );
      }
    }
    for (const t of c.tracks) {
      const placements = s.placements.filter((p) => p.trackId === t.id);
      ensure(placements.length <= 32);
      if (t.layering !== null && placements.length) {
        const old = {
          id: t.id,
          kind: t.kind === "group" ? "event" : t.kind,
          gain: t.mix.volume,
          pan: t.mix.pan,
          mute: t.mix.mute,
          solo: t.mix.solo,
          eq: clone(t.fx.eq),
          layering: {
            version: 1,
            baseClipId: t.layering.basePlacementId,
            overdubClipId: t.layering.overdubPlacementId,
          },
          clips: placements.map((p) => oldPlacement(p)),
        };
        validateLoopProject(
          {
            format: F,
            schemaVersion: 5,
            mode: "loop-station",
            title: c.title,
            timing: { bpm: c.timing.bpm, meter: [4, 4] },
            master: { volume: c.master.volume },
            clock: oldClock(c),
            origins: [],
            assetRefs: c.assets.map(oldAsset),
            tracks: [old],
          },
          registry,
        );
      }
    }
  }
  ensure(sectionIds.has(c.activeSection));
  for (const t of c.tracks)
    ensure(
      c.sections.reduce(
        (n, s) => n + s.placements.filter((p) => p.trackId === t.id).length,
        0,
      ) <= 32,
    );
  for (const t of c.tracks)
    if (t.layering !== null) {
      const a = c.sections
          .flatMap((s) => s.placements)
          .find((p) => p.id === t.layering.basePlacementId),
        b = c.sections
          .flatMap((s) => s.placements)
          .find((p) => p.id === t.layering.overdubPlacementId);
      ensure(
        a &&
          b &&
          a.trackId === t.id &&
          b.trackId === t.id &&
          c.sections.some(
            (s) => s.placements.includes(a) && s.placements.includes(b),
          ),
      );
    }
  const allowedPresence = new Set([
    "root/clock",
    "root/sources",
    "root/tuningConsent",
    "root/limiter",
  ]);
  for (const t of c.tracks)
    for (const key of ["eq", "layering"]) allowedPresence.add(t.id + "/" + key);
  for (const id of placementIds) allowedPresence.add(id + "/alignment");
  for (const d of c.sourceDefs.filter((d) => d.kind === "instrument-events"))
    for (const key of ["instrumentMix", "tuningConsent"])
      allowedPresence.add(d.id + "/" + key);
  ensure(c.compatibility.fieldPresence.every((p) => allowedPresence.has(p)));
  const chainIds = new Set();
  let occurrences = 0,
    ticks = 0;
  for (const e of c.chain) {
    exact(e, ["id", "sectionId", "repeats"]);
    ensure(
      identifier(e.id) &&
        !chainIds.has(e.id) &&
        sectionIds.has(e.sectionId) &&
        integer(e.repeats, 1, 8),
    );
    chainIds.add(e.id);
    occurrences += e.repeats;
    ticks +=
      c.sections.find((s) => s.id === e.sectionId).lengthTicks * e.repeats;
  }
  ensure(
    (c.transport.kind === "legacy-continuous"
      ? c.chain.length === 0
      : c.chain.length > 0) &&
      occurrences <= 8 &&
      ticks <= MAX_EVENT_TICK,
  );
  const oldIds = new Set(),
    newIds = new Set();
  for (const m of c.compatibility.idMap) {
    exact(m, ["kind", "sourceId", "oldId", "newId"]);
    ensure(
      ["root-source", "origin", "working", "track", "placement"].includes(
        m.kind,
      ) &&
        typeof m.sourceId === "string" &&
        identifier(m.oldId) &&
        identifier(m.newId),
    );
    const a = [m.kind, m.sourceId, m.oldId].join("/"),
      b = [m.kind, m.sourceId, m.newId].join("/");
    ensure(!oldIds.has(a) && !newIds.has(b));
    oldIds.add(a);
    newIds.add(b);
    ensure(
      m.kind === "origin"
        ? originIds.has(m.newId)
        : m.kind === "track"
          ? trackIds.has(m.newId)
          : m.kind === "placement"
            ? placementIds.has(m.newId)
            : sourceIds.has(m.newId),
    );
  }
  if (c.transport.kind === "legacy-score") {
    const rows = mapping(c, "root-source");
    ensure(rows.length === 1);
    const d = group(c, rows[0].newId);
    ensure(
      d.kind === "instrument-events" &&
        c.transport.nativeLengthTicks === d.programme.clock.lengthTicks &&
        c.transport.accompanimentLengthTicks ===
          group(c, d.programme.accompanimentRef).programme.chain.length *
            4 *
            PPQ,
    );
  } else
    ensure(
      c.transport.nativeLengthTicks === null &&
        c.transport.accompanimentLengthTicks === null,
    );
  return c;
}

function oldAsset(a) {
  const out = {};
  for (const k of [
    "id",
    "kind",
    "sha256",
    "bytes",
    "frames",
    "channels",
    "sampleRate",
    "encoding",
    "recordedBpm",
  ])
    out[k] = a[k];
  return out;
}
function oldPlacement(p, sourceId = p.sourceRef.id) {
  return {
    id: p.id,
    sourceId,
    startTick: p.startTick,
    lengthTicks: p.lengthTicks,
    offsetFrames: p.offsetFrames,
    loop: p.loop,
    ...(p.alignment === null ? {} : { phaseAlignment: clone(p.alignment) }),
  };
}

export async function parseCanonicalMetadata(text, registry) {
  ensure(typeof text === "string");
  ensure(utf8Bytes(text) <= MAX_CANONICAL_BYTES, "projectTooLarge");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail("invalidCanonicalProject");
  }
  return validateCanonicalMetadata(value, registry);
}
export function exportCanonicalPortable() {
  fail("canonicalPortableNotImplemented");
}

function originalHandle(hash, bytes) {
  const retained = new Uint8Array(bytes);
  return Object.freeze({
    has: (key) => key === hash,
    get: (key) => {
      ensure(key === hash, "missingOriginal");
      return retained.slice();
    },
  });
}
function normalized(text, version, registry) {
  return version === 4
    ? parseInstrumentProject(text, registry)
    : parseProject(text, compositionRegistry);
}

export async function migrateLegacyMetadata(input, { registry, signal } = {}) {
  if (signal?.aborted) fail("cancelled");
  let bytes;
  if (typeof input === "string") {
    ensure(utf8Bytes(input) <= 2 * 1024 * 1024, "projectTooLarge");
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    ensure(input.byteLength <= 2 * 1024 * 1024, "projectTooLarge");
    bytes = new Uint8Array(input);
  } else if (input instanceof Blob) {
    ensure(input.size <= 2 * 1024 * 1024, "projectTooLarge");
    bytes = new Uint8Array(await input.arrayBuffer());
  } else fail("invalidCanonicalProject");
  const text = new TextDecoder("utf-8").decode(bytes);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("invalidCanonicalProject");
  }
  ensure(raw && typeof raw === "object" && !Array.isArray(raw));
  ensure(integer(raw.schemaVersion, 0, 5), "unsupportedVersion");
  const v = raw.schemaVersion,
    accepted =
      v === 5
        ? parseLoopProject(text, registry)
        : normalized(text, v, registry),
    digest = await hashBytes(bytes);
  if (signal?.aborted) fail("cancelled");
  const bpm =
    v === 5
      ? accepted.timing.bpm
      : v === 4
        ? accepted.composition.timing.bpm
        : accepted.timing.bpm;
  const master =
    v === 5
      ? accepted.master
      : v === 4
        ? accepted.composition.master
        : accepted.master;
  const c = {
    format: F,
    schemaVersion: V,
    mode: "composition",
    title:
      v === 5
        ? accepted.title
        : v === 4
          ? accepted.composition.title
          : accepted.title,
    timing: {
      bpm,
      meter: [4, 4],
      clock:
        accepted.clock?.kind === "fixed-bar"
          ? clone(accepted.clock)
          : { kind: "musical", ppq: PPQ },
    },
    master: {
      volume: master.volume,
      limiter: clone(master.limiter ?? BYPASS_LIMITER),
    },
    tuningConsent: v === 5 ? (accepted.tuningConsent ?? false) : false,
    transport: {
      kind:
        v === 5
          ? "legacy-continuous"
          : v === 4
            ? "legacy-score"
            : v <= 1
              ? "legacy-beatbox"
              : "chain",
      nativeLengthTicks: null,
      accompanimentLengthTicks: null,
    },
    activeSection: "a",
    tracks: [],
    sections: [{ id: "a", name: "A", lengthTicks: 4 * PPQ, placements: [] }],
    chain: v === 5 ? [] : [{ id: "entry-a", sectionId: "a", repeats: 1 }],
    sourceDefs: [],
    origins: [
      {
        id: "original-file",
        kind: "file",
        schemaVersion: v,
        mediaType: "application/json",
        byteLength: bytes.length,
        sha256: digest,
        blobRef: digest,
        text: null,
      },
    ],
    assets: [],
    compatibility: {
      sourceVersion: v,
      rootOriginId: "original-file",
      fieldPresence: [],
      rolePresence: [],
      idMap: [],
    },
    export: {
      scope: "arrangement",
      bars: v <= 1 ? (raw.exportBars ?? raw.export.bars) : v === 5 ? 4 : null,
      tailPolicy: "full-natural-tail",
    },
  };
  const field = (path) => c.compatibility.fieldPresence.push(path);
  async function addText(id, t, version) {
    const b = new TextEncoder().encode(t);
    c.origins.push({
      id,
      kind: "embedded-text",
      schemaVersion: version,
      mediaType: "application/json",
      byteLength: b.length,
      sha256: await hashBytes(b),
      blobRef: null,
      text: t,
    });
    return id;
  }
  function addComp(id, p, originId, workingOriginId, parentId, binding) {
    const controls = materializeLegacyPatternControls(p);
    c.compatibility.rolePresence.push({
      sourceId: id,
      roles: [...controls.rolePresence],
    });
    c.sourceDefs.push({
      id,
      kind: "composition",
      originId,
      workingOriginId,
      parentId,
      master: binding,
      programme: {
        title: p.title,
        pack: clone(p.pack),
        timing: clone(p.timing),
        percussion: clone(p.tracks),
        bilah: clone(p.instrument),
        clipPack: clone(p.clipPack),
        patterns: p.patterns.map((a, i) => ({
          id: a.id,
          name: a.name,
          steps: clone(a.steps),
          notes: clone(a.notes),
          beatbox: clone(controls.patterns[i].beatbox),
        })),
        activePattern: p.activePattern,
        chain: clone(p.chain),
        export: clone(p.export),
      },
    });
  }
  async function addDef(id, p, originId, workingOriginId, binding) {
    if (p.schemaVersion === 3) {
      addComp(id, p, originId, workingOriginId, null, binding);
      return;
    }
    const child = id + "-accompaniment",
      nested = await addText(
        "text-" + id + "-nested",
        p.origin.text,
        p.origin.schemaVersion,
      );
    c.sourceDefs.push({
      id,
      kind: "instrument-events",
      originId,
      workingOriginId,
      parentId: null,
      master: binding,
      programme: {
        clock: clone(p.clock),
        banks: clone(p.banks),
        events: clone(p.events),
        instrumentMix: clone(p.instrumentMix ?? []),
        tuningConsent: p.tuningConsent ?? false,
        accompanimentRef: child,
      },
    });
    if (Object.hasOwn(p, "instrumentMix")) field(id + "/instrumentMix");
    if (Object.hasOwn(p, "tuningConsent")) field(id + "/tuningConsent");
    addComp(child, p.composition, nested, null, id, {
      binding: "parent",
      volume: null,
    });
  }
  const bus = (id, kind, name, m, eq = FLAT_EQ, layering = null) => ({
    id,
    kind,
    name,
    mix: clone(m),
    fx: { eq: clone(eq) },
    layering,
  });
  const placement = (
    id,
    trackId,
    kind,
    sourceId,
    startTick,
    lengthTicks,
    offsetFrames,
    loop,
    alignment = null,
  ) => ({
    id,
    trackId,
    sourceRef: { kind, id: sourceId },
    startTick,
    lengthTicks,
    offsetFrames,
    loop,
    phasePolicy: "continuous",
    alignment: clone(alignment),
  });
  const map = (kind, oldId, newId) =>
    c.compatibility.idMap.push({ kind, sourceId: "root", oldId, newId });
  if (v < 5) {
    ensure(!c.tuningConsent, "needsConversion");
    await addDef("g-root", accepted, "original-file", null, {
      binding: "project",
      volume: null,
    });
    map("root-source", "root", "g-root");
    const length =
      v === 4 ? accepted.clock.lengthTicks : accepted.chain.length * 4 * PPQ;
    c.sections[0].lengthTicks = length;
    c.tracks.push(
      bus("track-1", "group", "Track 1", {
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
      }),
    );
    c.sections[0].placements.push(
      placement("clip-1", "track-1", "working", "g-root", 0, length, 0, false),
    );
    if (v === 4) {
      c.transport.nativeLengthTicks = accepted.clock.lengthTicks;
      c.transport.accompanimentLengthTicks =
        accepted.composition.chain.length * 4 * PPQ;
    }
  } else {
    if (Object.hasOwn(accepted, "clock")) field("root/clock");
    if (Object.hasOwn(accepted, "sources")) field("root/sources");
    if (Object.hasOwn(accepted, "tuningConsent")) field("root/tuningConsent");
    if (Object.hasOwn(accepted.master, "limiter")) field("root/limiter");

    const refs = new Map();
    for (const [i, o] of accepted.origins.entries()) {
      const oid = await addText("text-o-" + (i + 1), o.text, o.schemaVersion),
        id = "g-o-" + (i + 1),
        p = normalized(o.text, o.schemaVersion, registry);
      map("origin", o.id, oid);
      refs.set(o.id, id);
      await addDef(id, p, oid, null, {
        binding: "local",
        volume:
          p.schemaVersion === 4 ? p.composition.master.volume : p.master.volume,
      });
    }
    for (const [i, s] of (accepted.sources ?? []).entries()) {
      const oid = mapping(c, "origin").find(
          (m) => m.oldId === s.originId,
        ).newId,
        wid = await addText("text-w-" + (i + 1), s.text, 4),
        id = "g-w-" + (i + 1),
        p = parseInstrumentProject(s.text, registry);
      map("working", s.id, id);
      refs.set(s.id, id);
      await addDef(id, p, oid, wid, {
        binding: "local",
        volume: p.composition.master.volume,
      });
    }
    c.assets = accepted.assetRefs.map((a) => ({
      ...clone(a),
      creditsRef: "credit-" + a.id,
    }));
    for (const [i, t] of accepted.tracks.entries()) {
      map("track", t.id, t.id);
      if (Object.hasOwn(t, "eq")) field(t.id + "/eq");
      if (Object.hasOwn(t, "layering")) field(t.id + "/layering");
      c.tracks.push(
        bus(
          t.id,
          t.kind === "event" ? "group" : t.kind,
          "Track " + (i + 1),
          { volume: t.gain, pan: t.pan, mute: t.mute, solo: t.solo },
          t.eq ?? FLAT_EQ,
          t.layering
            ? {
                version: 1,
                basePlacementId: t.layering.baseClipId,
                overdubPlacementId: t.layering.overdubClipId,
              }
            : null,
        ),
      );
      for (const p of t.clips) {
        map("placement", p.id, p.id);
        if (Object.hasOwn(p, "phaseAlignment")) field(p.id + "/alignment");
        const recording = accepted.assetRefs.some((a) => a.id === p.sourceId);
        c.sections[0].placements.push(
          placement(
            p.id,
            t.id,
            recording ? "asset" : "working",
            recording ? p.sourceId : refs.get(p.sourceId),
            p.startTick,
            p.lengthTicks,
            p.offsetFrames,
            p.loop,
            p.phaseAlignment ?? null,
          ),
        );
      }
    }
    c.sections[0].lengthTicks = Math.max(
      4 * PPQ,
      ...c.sections[0].placements.map((p) => p.startTick + p.lengthTicks),
    );
    // Empty legacy documents legitimately have no source definitions.
  }
  c.compatibility.fieldPresence.sort();
  const project = await validateCanonicalMetadata(c, registry);
  if (signal?.aborted) fail("cancelled");
  return Object.freeze({ project, originals: originalHandle(digest, bytes) });
}

function lexicalLegacy(text, version, fresh, registry) {
  return sameData(normalized(text, version, registry), fresh)
    ? text
    : JSON.stringify(fresh);
}
function projectionLayout(c, v) {
  ensure(
    c.sections.length === 1 &&
      c.activeSection === c.sections[0].id &&
      c.sections[0].name === "A" &&
      c.export.scope === "arrangement" &&
      c.export.tailPolicy === "full-natural-tail",
    "needsConversion",
  );
  ensure(
    c.tracks.every((t, i) => t.name === "Track " + (i + 1)),
    "needsConversion",
  );
  const expected =
    v === 5
      ? "legacy-continuous"
      : v === 4
        ? "legacy-score"
        : v <= 1
          ? "legacy-beatbox"
          : "chain";
  ensure(c.transport.kind === expected, "needsConversion");
  ensure(
    v === 5
      ? c.chain.length === 0
      : c.chain.length === 1 &&
          c.chain[0].sectionId === c.sections[0].id &&
          c.chain[0].repeats === 1,
    "needsConversion",
  );
}

// Reconstruct every legacy record from current canonical fields. The external
// retained file bytes are neither accepted nor consulted by this operation.
async function projectLegacyMetadataImpl(c, { registry } = {}) {
  const v = c.compatibility.sourceVersion;
  projectionLayout(c, v);
  if (v < 5) {
    ensure(!c.tuningConsent, "needsConversion");
    const rows = mapping(c, "root-source");
    ensure(rows.length === 1, "needsConversion");
    const d = group(c, rows[0].newId),
      p = legacyGroup(c, d),
      t = c.tracks[0],
      s = c.sections[0],
      placement = s.placements[0];
    ensure(
      c.tracks.length === 1 &&
        s.placements.length === 1 &&
        t.kind === "group" &&
        sameData(t.mix, { volume: 1, pan: 0, mute: false, solo: false }) &&
        sameData(t.fx.eq, FLAT_EQ) &&
        t.layering === null &&
        placement.trackId === t.id &&
        placement.sourceRef.kind === "working" &&
        placement.sourceRef.id === d.id &&
        placement.startTick === 0 &&
        placement.offsetFrames === 0 &&
        !placement.loop &&
        placement.alignment === null &&
        placement.phasePolicy === "continuous" &&
        sameData(c.master.limiter, BYPASS_LIMITER) &&
        c.assets.length === 0,
      "needsConversion",
    );
    const info = sourceInfo(c, d);
    ensure(
      s.lengthTicks === info.lengthTicks &&
        placement.lengthTicks === info.lengthTicks &&
        c.timing.bpm === info.bpm &&
        c.timing.clock.kind === "musical",
      "needsConversion",
    );
    ensure(c.sourceDefs.length === (v === 4 ? 2 : 1), "needsConversion");
    ensure(
      c.title === (v === 4 ? p.composition.title : p.title),
      "needsConversion",
    );
    if (v === 4) {
      ensure(
        c.transport.nativeLengthTicks === p.clock.lengthTicks &&
          c.transport.accompanimentLengthTicks ===
            p.composition.chain.length * 4 * PPQ &&
          c.export.bars === null,
        "needsConversion",
      );
      return validateInstrumentProject(p, registry);
    }
    ensure(
      c.transport.nativeLengthTicks === null &&
        c.transport.accompanimentLengthTicks === null,
      "needsConversion",
    );
    if (v === 3) {
      ensure(c.export.bars === null, "needsConversion");
      return validateProject(p, compositionRegistry);
    }
    if (v === 2) {
      const old = studioView(p);
      ensure(
        sameData(fromStudio(old), p) && c.export.bars === null,
        "needsConversion",
      );
      parseProject(JSON.stringify(old), compositionRegistry);
      return old;
    }
    const beatbox = toBeatbox(p);
    ensure(beatbox.export.bars === c.export.bars, "needsConversion");
    validateProject(beatbox, originalRegistry);
    if (v === 1) return beatbox;
    return {
      format: F,
      schemaVersion: 0,
      title: beatbox.title,
      packId: beatbox.pack.id,
      packVersion: beatbox.pack.version,
      bpm: beatbox.timing.bpm,
      volume: beatbox.master.volume,
      layers: Object.fromEntries(
        beatbox.tracks.map((t) => [
          t.role,
          { enabled: t.enabled, variant: t.variant },
        ]),
      ),
      exportBars: beatbox.export.bars,
    };
  }
  ensure(
    c.transport.nativeLengthTicks === null &&
      c.transport.accompanimentLengthTicks === null &&
      c.export.bars === 4,
    "needsConversion",
  );
  const s = c.sections[0],
    refs = new Map(),
    used = new Set();
  const origins = mapping(c, "origin").map((m) => {
    const o = origin(c, m.newId);
    ensure(o.kind === "embedded-text");
    const d = c.sourceDefs.find(
      (d) =>
        d.parentId === null &&
        d.originId === o.id &&
        d.workingOriginId === null,
    );
    ensure(d, "needsConversion");
    const fresh = legacyGroup(c, d);
    ensure(
      sameData(normalized(o.text, o.schemaVersion, registry), fresh),
      "needsConversion",
    );
    refs.set(d.id, m.oldId);
    used.add(d.id);
    if (d.kind === "instrument-events") used.add(d.programme.accompanimentRef);
    return { id: m.oldId, schemaVersion: o.schemaVersion, text: o.text };
  });
  const sources = mapping(c, "working").map((m) => {
    const d = group(c, m.newId),
      o = mapping(c, "origin").find((m) => m.newId === d.originId),
      working = origin(c, d.workingOriginId),
      fresh = legacyGroup(c, d);
    ensure(
      o && d.kind === "instrument-events" && working.kind === "embedded-text",
      "needsConversion",
    );
    refs.set(d.id, m.oldId);
    used.add(d.id);
    used.add(d.programme.accompanimentRef);
    return {
      id: m.oldId,
      originId: o.oldId,
      text: lexicalLegacy(working.text, 4, fresh, registry),
    };
  });
  ensure(used.size === c.sourceDefs.length, "needsConversion");
  const out = {
    format: F,
    schemaVersion: 5,
    mode: "loop-station",
    title: c.title,
    timing: { bpm: c.timing.bpm, meter: [4, 4] },
    master: { volume: c.master.volume },
    origins,
    assetRefs: c.assets.map(oldAsset),
    tracks: c.tracks.map((t) => {
      const row = {
        id: t.id,
        kind: t.kind === "group" ? "event" : t.kind,
        gain: t.mix.volume,
        pan: t.mix.pan,
        mute: t.mix.mute,
        solo: t.mix.solo,
        clips: s.placements
          .filter((p) => p.trackId === t.id)
          .map((p) => {
            ensure(p.phasePolicy === "continuous", "needsConversion");
            const id =
              p.sourceRef.kind === "asset"
                ? p.sourceRef.id
                : refs.get(p.sourceRef.id);
            ensure(id, "needsConversion");
            return oldPlacement(p, id);
          }),
      };
      if (presence(c, t.id + "/eq") || !sameData(t.fx.eq, FLAT_EQ))
        row.eq = clone(t.fx.eq);
      if (t.layering !== null)
        row.layering = {
          version: 1,
          baseClipId: t.layering.basePlacementId,
          overdubClipId: t.layering.overdubPlacementId,
        };
      return row;
    }),
  };
  if (presence(c, "root/clock") || c.timing.clock.kind !== "musical")
    out.clock = oldClock(c);
  if (presence(c, "root/sources") || sources.length) out.sources = sources;
  if (
    presence(c, "root/limiter") ||
    !sameData(c.master.limiter, BYPASS_LIMITER)
  )
    out.master.limiter = clone(c.master.limiter);
  if (presence(c, "root/tuningConsent") || c.tuningConsent)
    out.tuningConsent = c.tuningConsent;
  ensure(
    s.lengthTicks ===
      Math.max(
        4 * PPQ,
        ...s.placements.map((p) => p.startTick + p.lengthTicks),
      ),
    "needsConversion",
  );
  return validateLoopProject(out, registry);
}

export async function projectLegacyMetadata(value, { registry } = {}) {
  const c = await validateCanonicalMetadata(value, registry);
  if (c.mixPolicy) fail("needsConversion");
  try {
    return await projectLegacyMetadataImpl(c, { registry });
  } catch (error) {
    if (
      ["ProjectError", "InstrumentError"].includes(error.name) &&
      error.code !== "needsConversion"
    )
      fail("needsConversion");
    throw error;
  }
}

export async function inspectCanonicalAssets(
  value,
  { registry, entries = new Map(), originals = new Map(), memory } = {},
) {
  const c = await validateCanonicalMetadata(value, registry),
    issues = [];
  for (const o of c.origins.filter((o) => o.kind === "file")) {
    if (!originals.has(o.sha256))
      issues.push({ originId: o.id, code: "missingOriginal" });
    else {
      const raw = await originals.get(o.sha256);
      if (
        !(raw instanceof Blob || raw instanceof Uint8Array) ||
        (raw instanceof Blob ? raw.size : raw.byteLength) !== o.byteLength
      ) {
        issues.push({ originId: o.id, code: "originalHashMismatch" });
        continue;
      }
      {
        const lease = memory?.reserve(
          o.byteLength * 2,
          "canonical-origin-inspection",
        );
        try {
          const bytes =
            raw instanceof Blob ? new Uint8Array(await raw.arrayBuffer()) : raw;
          if ((await hashBytes(bytes)) !== o.sha256)
            issues.push({ originId: o.id, code: "originalHashMismatch" });
        } finally {
          lease?.release();
        }
      }
    }
  }
  if (
    c.assets.length &&
    (c.timing.clock.kind !== "fixed-bar" ||
      ![44100, 48000].includes(c.timing.clock.sampleRate) ||
      c.assets.some((a) => a.sampleRate !== c.timing.clock.sampleRate))
  )
    issues.push({ code: "takeRateMismatch" });
  for (const s of c.sections)
    for (const p of s.placements)
      if (p.sourceRef.kind === "asset" && p.offsetFrames !== 0)
        issues.push({ placementId: p.id, code: "recordingOffsetUnsupported" });
  if (c.assets.reduce((n, a) => n + a.bytes, 0) > 16 * 1024 * 1024)
    issues.push({ code: "recordingPackageTooLarge" });
  else
    for (const a of c.assets) {
      const e = entries.get(a.id);
      if (!(e?.blob instanceof Blob) || e.blob.size !== a.bytes) {
        issues.push({ assetId: a.id, code: "missingRecording" });
        continue;
      }
      if (
        typeof e.provenance !== "string" ||
        !e.provenance.trim() ||
        utf8Bytes(e.provenance) > 64 * 1024
      )
        issues.push({ assetId: a.id, code: "recordingCreditsRequired" });
      const lease = memory?.reserve(a.bytes * 2, "canonical-asset-inspection");
      try {
        const bytes = await e.blob.arrayBuffer();
        if ((await hashBytes(bytes)) !== a.sha256)
          issues.push({ assetId: a.id, code: "recordingHashMismatch" });
        const view = new DataView(bytes);
        for (let i = 0; i < bytes.byteLength; i += 4)
          if (!Number.isFinite(view.getFloat32(i, true))) {
            issues.push({ assetId: a.id, code: "invalidRecordingPCM" });
            break;
          }
      } finally {
        lease?.release();
      }
    }
  return frozenCopy({
    mode: "metadata-only",
    playableVerified: false,
    durableSaved: false,
    issues,
  });
}

// Explicit per-placement/window multiplicity, followed later by chain-entry
// expansion. This is metadata accounting, never live/audio admission.
export async function canonicalSectionCandidates(
  value,
  sectionId,
  recurrences,
  { registry } = {},
) {
  const c = await validateCanonicalMetadata(value, registry),
    s = c.sections.find((s) => s.id === sectionId);
  ensure(s);
  canonicalData(recurrences);
  exact(
    recurrences,
    s.placements.map((p) => p.id),
  );
  const counts = {};
  const compCount = (d) => d.programme.chain.length * 16 * 9 + 6;
  for (const d of c.sourceDefs)
    if (d.parentId === null)
      counts["working/" + d.id] =
        d.kind === "composition"
          ? compCount(d)
          : d.programme.events.length +
            compCount(group(c, d.programme.accompanimentRef));
  for (const a of c.assets) counts["asset/" + a.id] = 1;
  return placementCandidateCount(
    s.placements.map((p) => ({
      sourceId: p.sourceRef.kind + "/" + p.sourceRef.id,
      recurrences: recurrences[p.id],
    })),
    counts,
  );
}
