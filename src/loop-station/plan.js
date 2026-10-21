import { validateLoopProject } from "./project.js";
import { instrumentSource } from "./model.js";
import { MasterClock } from "./master-clock.js";
import { PPQ } from "../project/instrument-project.js";
import { takePlan } from "../project/instrument-take.js";
import {
  legacyAudible,
  assertTuningConsent,
} from "../project/instrument-mix.js";
import {
  prepareLegacyBus,
  prepareLegacyContinuous,
} from "../audio/legacy-bus.js";
import { repeatAdmission } from "../project/gamelan-repeat.js";
import { fail } from "../project/instrument-contract.js";
import { panPeakFactor } from "./pan-headroom.js";
import { eqBound } from "./fx-model.js";
import { qualifyRecordedLoop, recordedLoopGeometry } from "./recorded-loop.js";
import { phaseAdvance } from "./phase-alignment.js";
import { gamelanPlaybackScale } from "../audio/gamelan-level.js";

export function loopVoiceAt(clock, clip, voice, cycle, terminal = false) {
  const state = voice.cycles?.cycle(cycle);
  if (state)
    voice = {
      ...voice,
      buffer: state.buffer,
      frames: terminal ? state.frames : voice.cycles.periodFrames,
      stopAtPrefix: !terminal && state.frames > voice.cycles.periodFrames,
    };
  const base = clip.startTick + cycle * clip.lengthTicks,
    startFrame = clock.frame(base + voice.tick),
    naturalEndFrame = startFrame + voice.frames;
  const dampFrame =
    voice.dampTick === null ? null : clock.frame(base + voice.dampTick);
  return {
    ...voice,
    startFrame,
    naturalEndFrame,
    ...(voice.stopAtPrefix || voice.phaseOffsetFrames !== undefined
      ? { stopFrame: naturalEndFrame }
      : {}),
    ...(voice.phaseOffsetFrames !== undefined
      ? { loopFrames: voice.frames }
      : {}),
    dampFrame:
      dampFrame !== null && dampFrame < naturalEndFrame ? dampFrame : null,
    endFrame:
      dampFrame === null
        ? naturalEndFrame
        : Math.min(naturalEndFrame, dampFrame + Math.round(0.02 * clock.rate)),
  };
}
export function loopAdmission(
  plan,
  project = plan.project,
  { recordedLoops = false, rows = [] } = {},
) {
  const activeDocuments = new Set(),
    solo = project.tracks.some((t) => t.solo);
  for (const t of project.tracks)
    if (!t.mute && t.gain > 0 && project.master.volume > 0 && (!solo || t.solo))
      for (const doc of plan.trackDocuments?.get(t.id) ?? [])
        if (doc.composition.master.volume > 0) activeDocuments.add(doc);
  for (const eventDoc of activeDocuments)
    for (const legacyDoc of activeDocuments)
      assertTuningConsent(
        {
          ...eventDoc,
          composition: legacyDoc.composition,
          tuningConsent:
            project.tuningConsent === true ||
            (eventDoc === legacyDoc && eventDoc.tuningConsent === true),
        },
        plan.registry,
      );

  let owned = 0,
    peak = 0;
  const anySolo = project.tracks.some((t) => t.solo);
  const remaining = new Set(rows);
  for (const track of plan.tracks) {
    const t = project.tracks.find((t) => t.id === track.id);
    if (!t) fail("invalidLoopTrack");
    const gain = t.mute || (anySolo && !t.solo) ? 0 : t.gain;
    for (const clip of track.clips) {
      const period = Math.floor(clip.lengthTicks * plan.clock.framesPerTick);
      if (clip.loop && period < 128) fail("invalidLoopPlan");
      const metrics = new Map(),
        weightOf = (v) => {
          const weight =
            v.peak *
            v.velocity *
            0.25 *
            v.scale *
            gain *
            eqBound(t.eq) *
            project.master.volume *
            panPeakFactor(v.buffer?.numberOfChannels ?? 2, v.pan) *
            panPeakFactor(2, t.pan);
          if (!Number.isFinite(weight) || weight < 0) fail("invalidLoopPlan");
          return weight;
        };
      const voices = clip.voices.map((v, i) => {
        const spec = loopVoiceAt(plan.clock, { ...clip, startTick: 0 }, v, 0),
          key = String(i),
          weight = weightOf(v);
        metrics.set(key, { peak: weight * 4 });
        return {
          key,
          startFrame: spec.startFrame,
          endFrame:
            Math.max(
              spec.endFrame,
              spec.startFrame + (v.cycles ? v.frames : 0),
            ) + 2,
          velocity: 1,
          mix: { volume: 1, pan: 0 },
        };
      });
      if (!voices.length) continue;
      const bounds = repeatAdmission(
        {
          rate: plan.clock.rate,
          periodFrames: clip.loop
            ? Math.max(128, period)
            : Math.ceil(
                Math.max(...voices.map((v) => v.endFrame)) +
                  2 * plan.clock.rate,
              ),
          voices,
        },
        metrics,
        1,
      );
      let actual = 0,
        actualPeak = 0;
      for (const row of remaining)
        if (row.clip === clip && row.track === track.id) {
          actual++;
          actualPeak += weightOf(row.spec);
          remaining.delete(row);
        }
      const single = recordedLoops && recordedLoopGeometry(clip, plan.clock);
      owned += Math.max(single ? 1 : bounds.maxOwned, actual);
      // A qualified immutable period is played by one continuous native reader,
      // not overlapping per-cycle sources. Its exact channel peak is certified
      // by that geometry. Keep every actual pending/releasing row in the sum;
      // unqualified/generic cyclic material retains the prior repeat bound.
      peak += Math.max(
        single ? weightOf(single.voice) : bounds.maxPeak,
        actualPeak,
      );
    }
  }
  // Stale/unidentified owners must be disposed, never silently omitted from
  // admission for a new plan or a prospective voice allocation.
  if (remaining.size) fail("recordBusy");
  if (owned > 16) fail("voiceLimit");
  if (peak > 0.95) fail("voiceHeadroom");
  return { maxOwned: owned, maxPeak: peak };
}
export async function prepareLoopPlan(
  value,
  {
    registry,
    rate,
    cache,
    memory,
    signal,
    prepareLegacy = prepareLegacyBus,
    prepareContinuous = prepareLegacyContinuous,
    resolveRecording,
    recordedLoops = false,
  } = {},
) {
  const project = validateLoopProject(value, registry),
    clock = new MasterClock(project, rate),
    resources = new Map(),
    tracks = [],
    documents = new Map(),
    trackDocuments = new Map();
  let released = false;
  const check = () => {
    if (signal?.aborted) fail("cancelled");
  };
  const release = () => {
    if (released) return;
    released = true;
    for (const r of resources.values()) r.release();
    resources.clear();
    cache?.trim();
  };
  try {
    for (const track of project.tracks) {
      const clips = [];
      trackDocuments.set(track.id, new Set());
      for (const c of track.clips) {
        check();
        const voices = [],
          archived = project.origins.find((o) => o.id === c.sourceId),
          working = project.sources?.find((o) => o.id === c.sourceId);
        if (archived || working) {
          let p = documents.get(c.sourceId);
          if (!p) {
            p = instrumentSource((working ?? archived).text, registry);
            documents.set(c.sourceId, p);
          }
          trackDocuments.get(track.id).add(p);
          const legacy = legacyAudible(p.composition);
          let planned = [];
          if (p.events.some((e) => e.action === "strike"))
            planned = takePlan(p, registry, rate, {
              includeMuted: true,
            }).voices;
          for (const v of planned.filter((v) => v.tick < c.lengthTicks)) {
            const id = "sample/" + v.key + "/" + v.version;
            let lease = resources.get(id);
            if (!lease) {
              lease = await cache.acquire(v.bankId, v.version, v.sampleId, {
                signal,
              });
              resources.set(id, lease);
            }
            check();
            const damp =
              p.events
                .filter(
                  (e) =>
                    e.action === "damp" &&
                    e.bankId === v.bankId &&
                    e.sampleId === v.sampleId &&
                    e.tick < c.lengthTicks,
                )
                .map((e) =>
                  e.tick > v.tick
                    ? e.tick
                    : c.loop
                      ? e.tick + c.lengthTicks
                      : Infinity,
                )
                .sort((a, b) => a - b)[0] ?? Infinity;
            voices.push({
              buffer: lease.buffer,
              frames: v.descriptor.frames,
              key: v.key,
              tick: v.tick,
              dampTick: Number.isFinite(damp) ? damp : null,
              velocity: v.velocity,
              scale:
                p.composition.master.volume *
                v.mix.volume *
                gamelanPlaybackScale(
                  registry.bank(v.bankId, v.version),
                  lease.metrics.peak,
                ),
              pan: v.mix.pan,
              peak: lease.metrics.peak,
            });
          }
          if (legacy) {
            if (c.lengthTicks < p.composition.chain.length * 4 * PPQ)
              fail("legacyRegionUnsupported");
            if (
              c.loop &&
              c.lengthTicks !== p.composition.chain.length * 4 * PPQ
            )
              fail("legacyRegionUnsupported");
            const rawPeriod = c.lengthTicks * clock.framesPerTick;
            if (c.loop && Math.abs(rawPeriod - Math.round(rawPeriod)) > 1e-7)
              fail("legacyLoopClockUnsupported");
            const id =
              "legacy/" +
              c.sourceId +
              (c.loop ? "/continuous/" + Math.round(rawPeriod) : "");
            let bus = resources.get(id);
            if (!bus) {
              bus = await (c.loop ? prepareContinuous : prepareLegacy)(p, {
                memory,
                rate,
                signal,
                periodFrames: Math.round(rawPeriod),
              });
              resources.set(id, bus);
            }
            check();
            voices.push({
              buffer: bus.buffer,
              frames: bus.frames,
              key: id,
              tick: 0,
              dampTick: null,
              velocity: 1,
              scale: 4,
              pan: 0,
              peak: bus.peak,
              ...(c.loop ? { cycles: bus } : {}),
            });
          }
        } else {
          const a = project.assetRefs.find((a) => a.id === c.sourceId);
          if (!a || !resolveRecording) fail("missingRecording");
          if (c.offsetFrames !== 0) fail("recordingOffsetUnsupported");
          if (a.sampleRate !== rate) fail("takeRateMismatch");
          if (c.loop && clock.policy.kind !== "fixed-bar")
            fail("loopPeriodMismatch");
          if (
            c.loop &&
            a.frames !==
              clock.frame(c.startTick + c.lengthTicks) -
                clock.frame(c.startTick)
          )
            fail("loopPeriodMismatch");
          let resource = resources.get(a.id);
          if (!resource) {
            resource = await resolveRecording(a, { memory, signal });
            resources.set(a.id, resource);
          }
          check();
          if (
            resource.sha256 !== a.sha256 ||
            resource.buffer.length !== a.frames ||
            resource.buffer.numberOfChannels !== a.channels ||
            resource.buffer.sampleRate !== a.sampleRate
          )
            fail("recordingIdentityMismatch");
          voices.push({
            buffer: resource.buffer,
            frames: a.frames,
            key: a.id,
            tick: 0,
            dampTick: null,
            velocity: 1,
            scale: 4,
            pan: 0,
            peak: resource.peak,
            ...(c.phaseAlignment
              ? { phaseOffsetFrames: phaseAdvance(c, a, project.clock) }
              : {}),
          });
        }
        // The cursor consumes voices in time order. A prepared legacy bus is
        // appended after event voices, but starts at tick zero.
        voices.sort((a, b) => a.tick - b.tick || a.key.localeCompare(b.key));
        const preparedClip = {
          ...c,
          voices,
          maxTailFrames: Math.max(0, ...voices.map((v) => v.frames)),
        };
        const recording = project.assetRefs.find((a) => a.id === c.sourceId);
        if (recording) qualifyRecordedLoop(preparedClip, recording, clock);
        clips.push(preparedClip);
      }
      tracks.push({ ...track, clips });
    }
    const plan = { project, clock, tracks, release, registry, trackDocuments };
    loopAdmission(plan, plan.project, { recordedLoops });
    return plan;
  } catch (e) {
    release();
    throw e;
  }
}
