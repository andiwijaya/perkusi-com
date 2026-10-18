import { validateCanonicalMetadata } from "./canonical-metadata.js";
import { canonicalData, canonicalFrozenCopy, exact } from "./canonical-data.js";
import { PPQ } from "./instrument-project.js";
import { fail, integer, utf8Bytes } from "./instrument-contract.js";
import { MasterClock } from "../loop-station/master-clock.js";
import {
  ARRANGEMENT_LIMITS,
  phraseTransition,
} from "./arrangement-contract.js";
import { hasEQ } from "../loop-station/fx-model.js";

// Isolated Q1c logical timeline. This is NOT a prepared/audio-admitted plan.
// No original-byte inverse, old sequencing planner, decoder, context or store.
const BAR = 4 * PPQ;
const issued = new WeakSet();
const check = (signal) => {
  if (signal?.aborted) fail("cancelled");
};
const gain = (row, rows) =>
  row.mute || (rows.some((r) => r.solo) && !row.solo) ? 0 : row.volume;
const order = (a, b) =>
  a.startFrame - b.startFrame ||
  a.tick - b.tick ||
  (a.action === "damp" ? 0 : 1) - (b.action === "damp" ? 0 : 1) ||
  a.ordinal - b.ordinal;
const controlState = (p, b, rows) => ({
  identity: {
    packId: p.clipPack.id,
    packVersion: p.clipPack.version,
    processing: p.clipPack.processing,
    role: b.role,
    variant: b.variant,
  },
  enabled: b.enabled,
  gate: gain(b, rows) > 0,
  volume: b.volume,
  pan: b.pan,
  phasePolicy: b.phasePolicy,
});
function audibleComposition(def, volume) {
  if (!volume) return false;
  const p = def.programme;
  return p.chain.some((id) => {
    const a = p.patterns.find((a) => a.id === id);
    const rows = [...p.percussion, ...a.beatbox, p.bilah];
    return (
      a.beatbox.some((b) => b.enabled && gain(b, rows)) ||
      p.percussion.some(
        (t) => gain(t, rows) && a.steps[t.role].some(Boolean),
      ) ||
      (gain(p.bilah, rows) && a.notes.some(Boolean))
    );
  });
}
function sourceMaster(project, d, defs) {
  return d.master.binding === "project"
    ? project.master.volume
    : d.master.binding === "local"
      ? d.master.volume
      : sourceMaster(project, defs.get(d.parentId), defs);
}
function sourceCandidates(d, defs) {
  if (d.kind === "composition")
    // Every bar has six control transitions, not merely six source identities.
    return d.programme.chain.length * (8 * 16 + 16 + 6);
  return (
    d.programme.events.length +
    sourceCandidates(defs.get(d.programme.accompanimentRef), defs)
  );
}
function sourceLength(d) {
  return d.kind === "composition"
    ? d.programme.chain.length * BAR
    : d.programme.clock.lengthTicks;
}

/** Compile a finite reconstruction window; window/repeat is an explicit command.
 * The lease owns only logical schedule/snapshot allowances, never PCM/voices.
 * Caller must dispose it, including after superseding an outstanding job.
 */
export async function compileCanonicalTimeline(
  value,
  {
    registry,
    rate,
    memory,
    signal,
    command = { kind: "once", bars: null, cycles: 1 },
  } = {},
) {
  // Capture command synchronously too: validation below has async hash boundaries.
  canonicalData(command);
  const cmd = canonicalFrozenCopy(command);
  exact(cmd, ["kind", "bars", "cycles"]);
  if (
    !["once", "window", "repeat"].includes(cmd.kind) ||
    ![44100, 48000].includes(rate) ||
    !integer(cmd.cycles, 1, 8) ||
    (cmd.kind === "window" ? ![4, 8].includes(cmd.bars) : cmd.bars !== null) ||
    (cmd.kind !== "repeat" && cmd.cycles !== 1) ||
    typeof memory?.reserve !== "function"
  )
    fail("invalidCanonicalTimeline");
  check(signal);
  const project = await validateCanonicalMetadata(value, registry);
  check(signal);
  const defs = new Map(project.sourceDefs.map((d) => [d.id, d]));
  const sections = new Map(project.sections.map((s) => [s.id, s]));
  const clock = new MasterClock(
    { timing: project.timing, clock: project.timing.clock },
    rate,
  );
  if (project.transport.kind === "legacy-continuous" && cmd.kind !== "window")
    fail("arrangementWindowRequired");
  if (cmd.kind === "window" && project.transport.kind !== "legacy-continuous")
    fail("canonicalWindowUnsupported");
  const chain = project.chain.length
    ? project.chain
    : [{ id: "window", sectionId: project.activeSection, repeats: 1 }];
  let occurrenceCount = 0,
    lengthTicks = 0,
    candidateCount = 0;
  // Count all placements, source recurrences, control boundaries and root
  // occurrences BEFORE any flattened event, reader or occurrence allocation.
  for (const entry of chain) {
    const s = sections.get(entry.sectionId);
    const span = cmd.kind === "window" ? cmd.bars * BAR : s.lengthTicks;
    occurrenceCount += entry.repeats * cmd.cycles;
    lengthTicks += span * entry.repeats * cmd.cycles;
    for (const p of s.placements) {
      if (p.startTick >= span) continue;
      const d = defs.get(p.sourceRef.id);
      const recurrences = p.loop
        ? Math.ceil((span - p.startTick) / p.lengthTicks)
        : 1;
      candidateCount +=
        (d ? sourceCandidates(d, defs) : 1) *
        recurrences *
        entry.repeats *
        cmd.cycles;
    }
  }
  const scheduleBytes =
    ARRANGEMENT_LIMITS.headerBytes +
    (occurrenceCount + candidateCount) * ARRANGEMENT_LIMITS.recordBytes;
  if (
    occurrenceCount > ARRANGEMENT_LIMITS.occurrences ||
    lengthTicks > ARRANGEMENT_LIMITS.lengthTicks ||
    candidateCount > ARRANGEMENT_LIMITS.candidates ||
    scheduleBytes > ARRANGEMENT_LIMITS.scheduleBytes
  )
    fail("arrangementExpansionLimit");
  // Snapshot allowance is separate from the schedule allowance; neither is a
  // browser heap claim. Admission cannot silently evict a foreign live owner.
  const snapshotBytes = utf8Bytes(JSON.stringify(project));
  const lease = memory.reserve(
    scheduleBytes + snapshotBytes,
    "canonical/logical-timeline",
  );
  let disposed = false;
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      lease.release();
    }
  };
  try {
    const occurrences = [],
      placements = [],
      events = [],
      phrases = [];
    const anchors = new Map();
    let startTick = 0,
      ordinal = 0;
    const push = (e) => {
      e.ordinal = ordinal++;
      events.push(e);
    };
    const makeComposition = (
      d,
      placement,
      baseTick,
      spanTicks,
      continuityKey,
    ) => {
      const p = d.programme,
        segments = [],
        shots = [];
      const endTick = baseTick + spanTicks;
      for (let bar = 0; bar * BAR < spanTicks; bar++) {
        const a = p.patterns.find(
          (a) => a.id === p.chain[bar % p.chain.length],
        );
        const tick = baseTick + bar * BAR,
          end = Math.min(endTick, tick + BAR);
        const frame = clock.frame(tick),
          endFrame = clock.frame(end);
        const rows = [...p.percussion, ...a.beatbox, p.bilah];
        const segment = {
          patternId: a.id,
          bar,
          startFrame: frame,
          endFrame,
          percussionGains: p.percussion.map((r) => gain(r, rows)),
          bilahGain: gain(p.bilah, rows),
          phrases: [],
        };
        for (const b of a.beatbox) {
          const next = controlState(p, b, rows),
            key = continuityKey + "/" + b.role;
          const prior = anchors.get(key);
          const continuous =
            prior?.endFrame === frame &&
            !(bar === 0 && placement.phasePolicy === "restart-on-entry");
          const transition = phraseTransition(
            continuous ? prior.control : null,
            next,
            {
              phaseFrame: continuous ? prior.phaseFrame : null,
              elapsedFrames: continuous ? frame - prior.startFrame : 0,
              periodFrames: 5 * rate,
            },
          );
          const state = {
            sourceId: d.id,
            placementId: placement.id,
            patternId: a.id,
            bar,
            role: b.role,
            startFrame: frame,
            endFrame,
            control: next,
            action: transition.action,
            phaseFrame: transition.phaseFrame,
            audible: transition.audible,
            gain: gain(b, rows),
            anchorFrame:
              transition.phaseFrame === null
                ? null
                : frame - transition.phaseFrame,
          };
          anchors.set(key, { ...state, control: next });
          segment.phrases.push(state);
          phrases.push(state);
          push({
            kind: "phrase-control",
            action: state.action,
            tick,
            startFrame: frame,
            sourceId: d.id,
            placementId: placement.id,
            patternId: a.id,
            role: b.role,
            stateIndex: phrases.length - 1,
          });
        }
        for (let step = 0; step < 16; step++) {
          const localTick =
            (step / 4 + (step % 2 ? p.timing.swing / 4 : 0)) * PPQ;
          const eventTick = tick + localTick;
          if (eventTick >= end) continue;
          for (const [i, t] of p.percussion.entries()) {
            const velocity = a.steps[t.role][step];
            if (!velocity) continue;
            const shot = {
              kind: "percussion",
              action: "strike",
              sourceId: d.id,
              placementId: placement.id,
              patternId: a.id,
              bar,
              step,
              role: t.role,
              tick: eventTick,
              startFrame: clock.frame(eventTick),
              velocity,
              gain: segment.percussionGains[i],
              pan: t.pan,
            };
            shots.push(shot);
            push(shot);
          }
          if (a.notes[step]) {
            const shot = {
              kind: "bilah",
              action: "strike",
              sourceId: d.id,
              placementId: placement.id,
              patternId: a.id,
              bar,
              step,
              role: "bilah",
              tick: eventTick,
              startFrame: clock.frame(eventTick),
              ...a.notes[step],
              gain: segment.bilahGain,
              pan: p.bilah.pan,
            };
            shots.push(shot);
            push(shot);
          }
        }
        segments.push(segment);
      }
      // Chokes are role-local, not pitch-local for Bilah. A prepared whole
      // group must retain crossing tails; logical shots do not own audio.
      for (const role of [...p.percussion.map((r) => r.role), "bilah"]) {
        const lane = shots.filter((e) => e.role === role);
        for (let i = 0; i < lane.length; i++)
          lane[i].chokeFrame = lane[i + 1]?.startFrame ?? null;
      }
      return {
        sourceId: d.id,
        masterVolume: sourceMaster(project, d, defs),
        startFrame: clock.frame(baseTick),
        endFrame: clock.frame(endTick),
        segments,
        shots,
        durationPolicy: "legacy-body-fade",
        renderQualified: false,
      };
    };
    for (let cycle = 0; cycle < cmd.cycles; cycle++)
      for (const entry of chain) {
        const s = sections.get(entry.sectionId);
        const span = cmd.kind === "window" ? cmd.bars * BAR : s.lengthTicks;
        for (let repeatIndex = 0; repeatIndex < entry.repeats; repeatIndex++) {
          check(signal);
          const occurrenceId = `${cycle}:${entry.id}:${repeatIndex}`;
          occurrences.push({
            id: occurrenceId,
            sectionId: s.id,
            startTick,
            lengthTicks: span,
          });
          for (const p of s.placements) {
            if (p.startTick >= span) continue;
            const d = defs.get(p.sourceRef.id);
            const n = p.loop
              ? Math.ceil((span - p.startTick) / p.lengthTicks)
              : 1;
            const child =
              d?.kind === "instrument-events"
                ? defs.get(d.programme.accompanimentRef)
                : null;
            const audible =
              child &&
              audibleComposition(child, sourceMaster(project, child, defs));
            if (
              cmd.kind === "repeat" &&
              project.transport.kind === "legacy-score" &&
              audible
            )
              fail("repeatNeedsEventOnly");
            if (d && p.loop && p.lengthTicks < sourceLength(d))
              fail("legacyRegionUnsupported");
            if (
              d?.kind === "composition" &&
              project.transport.kind === "legacy-continuous" &&
              audibleComposition(d, sourceMaster(project, d, defs)) &&
              p.lengthTicks < sourceLength(d)
            )
              fail("legacyRegionUnsupported");
            if (
              child &&
              audible &&
              project.transport.kind !== "legacy-score" &&
              (p.lengthTicks < sourceLength(child) ||
                (p.loop && p.lengthTicks !== sourceLength(child)))
            )
              fail("legacyRegionUnsupported");
            for (let recurrence = 0; recurrence < n; recurrence++) {
              const baseTick =
                startTick + p.startTick + recurrence * p.lengthTicks;
              const placement = {
                id: `${occurrenceId}:${p.id}:${recurrence}`,
                originalId: p.id,
                occurrenceId,
                trackId: p.trackId,
                sourceRef: p.sourceRef,
                startTick: baseTick,
                lengthTicks: p.lengthTicks,
                startFrame: clock.frame(baseTick),
                endFrame: clock.frame(baseTick + p.lengthTicks),
                offsetFrames: p.offsetFrames,
                loop: p.loop,
                phasePolicy: p.phasePolicy,
                alignment: p.alignment,
                composition: null,
                native: null,
                recording: null,
              };
              if (!d) {
                const asset = project.assets.find(
                  (a) => a.id === p.sourceRef.id,
                );
                const periodFrames = placement.endFrame - placement.startFrame;
                placement.recording = {
                  asset,
                  phaseOffsetFrames: p.alignment?.advanceFrames ?? 0,
                  readerEndFrame: p.loop
                    ? placement.endFrame
                    : placement.startFrame + asset.frames,
                  playbackIssue: p.offsetFrames
                    ? "recordingOffsetUnsupported"
                    : asset.sampleRate !== rate
                      ? "takeRateMismatch"
                      : p.loop &&
                          (project.timing.clock.kind !== "fixed-bar" ||
                            asset.frames !== periodFrames)
                        ? "loopPeriodMismatch"
                        : p.loop &&
                            (clock.frame(startTick + span) -
                              placement.startFrame) %
                              periodFrames !==
                              0
                          ? "finalMixPeriodMismatch"
                          : !p.loop &&
                              placement.startFrame + asset.frames >
                                clock.frame(startTick + span)
                            ? "finalMixPeriodMismatch"
                            : null,
                };
                push({
                  kind: "recording",
                  action: "read",
                  sourceId: asset.id,
                  placementId: placement.id,
                  tick: baseTick,
                  startFrame: clock.frame(baseTick),
                });
              } else if (d.kind === "composition") {
                placement.composition = makeComposition(
                  d,
                  placement,
                  baseTick,
                  Math.min(p.lengthTicks, startTick + span - baseTick),
                  `${p.trackId}/${p.id}/${d.id}`,
                );
              } else {
                const programme = d.programme;
                const groups = new Map();
                for (const e of programme.events) {
                  const version = programme.banks.find(
                    (b) => b.id === e.bankId,
                  ).version;
                  const descriptor = registry.sample(
                    e.bankId,
                    version,
                    e.sampleId,
                  );
                  const key = e.bankId + "/" + descriptor.instrumentId;
                  if (!groups.has(key))
                    groups.set(key, {
                      volume: 1,
                      pan: 0,
                      mute: false,
                      solo: false,
                    });
                }
                for (const m of programme.instrumentMix)
                  groups.set(m.bankId + "/" + m.instrumentId, m);
                const nativeEvents = [],
                  voices = [],
                  active = new Map();
                const ordered = [...programme.events].sort(
                  (a, b) =>
                    a.tick - b.tick ||
                    (a.action === "damp" ? 0 : 1) -
                      (b.action === "damp" ? 0 : 1) ||
                    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
                );
                for (const e of ordered.filter(
                  (e) =>
                    e.tick < p.lengthTicks &&
                    baseTick + e.tick < startTick + span,
                )) {
                  const version = programme.banks.find(
                    (b) => b.id === e.bankId,
                  ).version;
                  const descriptor = registry.sample(
                    e.bankId,
                    version,
                    e.sampleId,
                  );
                  const key = e.bankId + "/" + e.sampleId;
                  const mix = groups.get(
                    e.bankId + "/" + descriptor.instrumentId,
                  );
                  const event = {
                    ...e,
                    kind: "native",
                    localId: e.id,
                    sourceId: d.id,
                    placementId: placement.id,
                    tick: baseTick + e.tick,
                    startFrame: clock.frame(baseTick + e.tick),
                    version,
                    descriptor,
                    mix: {
                      volume: gain(mix, [...groups.values()]),
                      pan: mix.pan,
                    },
                    masterVolume: sourceMaster(project, d, defs),
                  };
                  nativeEvents.push(event);
                  push(event);
                  if (e.action === "damp") {
                    for (const voice of active.get(key) ?? []) {
                      voice.dampFrame = event.startFrame;
                      voice.endFrame = Math.min(
                        voice.endFrame,
                        event.startFrame + Math.round(0.02 * rate),
                      );
                    }
                    active.delete(key);
                  } else {
                    const voice = {
                      event,
                      startFrame: event.startFrame,
                      naturalEndFrame: event.startFrame + descriptor.frames,
                      endFrame: event.startFrame + descriptor.frames,
                      dampFrame: null,
                    };
                    voices.push(voice);
                    if (!active.has(key)) active.set(key, []);
                    active.get(key).push(voice);
                  }
                }
                placement.native = {
                  events: nativeEvents,
                  voices,
                  durationPolicy: "full-natural-tail",
                  repeatWrapQualified: false,
                  renderQualified: false,
                };
                if (audible)
                  placement.composition = makeComposition(
                    child,
                    placement,
                    baseTick,
                    sourceLength(child),
                    `${placement.id}/${child.id}`,
                  );
              }
              placements.push(placement);
            }
          }
          startTick += span;
        }
      }
    events.sort(order);
    if (events.length > candidateCount) fail("arrangementExpansionLimit");
    check(signal);
    // An admitted schedule may contain >100000 voices. Never turn its
    // population into a function-argument list (engine limits are lower).
    let bodyFrames = clock.frame(lengthTicks);
    for (const p of placements)
      bodyFrames = Math.max(bodyFrames, p.composition?.endFrame ?? 0);
    let naturalEndFrame = bodyFrames;
    for (const p of placements) {
      naturalEndFrame = Math.max(
        naturalEndFrame,
        p.recording?.readerEndFrame ?? 0,
      );
      for (const v of p.native?.voices ?? [])
        naturalEndFrame = Math.max(naturalEndFrame, v.endFrame);
    }
    const eqTailFrames = project.tracks.some((t) => hasEQ(t.fx.eq))
      ? Math.ceil(0.1 * rate)
      : 0;
    const timeline = Object.freeze({
      kind: "canonical-logical-timeline",
      revision: 1,
      status: "logical-only",
      rate,
      project,
      command: cmd,
      occurrences: canonicalFrozenCopy(occurrences),
      // Freeze once in place to retain shared source/event identities.
      placements: freezeTree(placements),
      events: freezeTree(events),
      phrases: freezeTree(phrases),
      sectionSpanFrames: clock.frame(lengthTicks),
      bodyFrames,
      naturalEndFrame,
      eqTailFrames,
      proposedFrames: naturalEndFrame + eqTailFrames,
      admission: Object.freeze({
        candidateCount,
        scheduleBytes,
        snapshotBytes,
        audioAdmitted: false,
        playableVerified: false,
        durableSaved: false,
      }),
      dispose,
      get disposed() {
        return disposed;
      },
    });
    issued.add(timeline);
    return timeline;
  } catch (error) {
    dispose();
    throw error;
  }
}

function freezeTree(v) {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const child of Object.values(v)) freezeTree(child);
    Object.freeze(v);
  }
  return v;
}

// Common integer-frame query for future scheduler, feedback and WAV adapters.
// A pause simply stops advancing this frame argument; seek replays plan state.
export function canonicalTimelineAt(timeline, frame) {
  assertCanonicalTimeline(timeline);
  if (!integer(frame, 0, timeline.bodyFrames - 1))
    fail("invalidCanonicalTimeline");
  const phrases = timeline.phrases
    .filter((s) => s.startFrame <= frame && frame < s.endFrame)
    .map((s) =>
      Object.freeze({
        ...s,
        phaseFrame:
          s.phaseFrame === null
            ? null
            : (s.phaseFrame + frame - s.startFrame) % (5 * timeline.rate),
      }),
    );
  const recordings = timeline.placements
    .filter(
      (p) =>
        p.recording &&
        p.startFrame <= frame &&
        frame < p.recording.readerEndFrame,
    )
    .map((p) => {
      const n = p.recording.asset.frames;
      return Object.freeze({
        placementId: p.id,
        assetId: p.recording.asset.id,
        rawFrame: p.loop
          ? (((frame - p.startFrame + p.recording.phaseOffsetFrames) % n) + n) %
            n
          : frame - p.startFrame + p.offsetFrames,
        playbackIssue: p.recording.playbackIssue,
      });
    });
  return Object.freeze({
    frame,
    phrases: Object.freeze(phrases),
    recordings: Object.freeze(recordings),
  });
}

export function assertCanonicalTimeline(timeline) {
  if (!issued.has(timeline) || timeline.disposed)
    fail("invalidCanonicalTimeline");
}
