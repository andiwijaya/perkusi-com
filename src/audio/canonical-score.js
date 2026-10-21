import { compileCanonicalTimeline } from "../project/canonical-timeline.js";
import { canonicalGridStep } from "./canonical-grid-position.js";
import {
  canonicalData,
  canonicalFrozenCopy,
  hashBytes,
} from "../project/canonical-data.js";
import { fail, integer } from "../project/instrument-contract.js";
import { renderCanonicalRun } from "./canonical-dynamic-render.js";
import { gamelanPlaybackScale } from "./gamelan-level.js";
import {
  eqBound,
  fxBytes,
  limiterEnabled,
  BYPASS_LIMITER,
} from "../loop-station/fx-model.js";
import { panPeakFactor } from "../loop-station/pan-headroom.js";
import { bakeCanonicalPlayback } from "./canonical-playback.js";
import {
  hasCanonicalSourceBatch,
  reserveCanonicalSourceBatch,
  canonicalSourceHasVerifiedRecording,
} from "./canonical-source-batch.js";
import { canonicalRecordingLoanHash } from "./canonical-recordings.js";

const states = new WeakMap();
export function canonicalSoundKey(r) {
  if (r.kind === "instrument")
    return `instrument/${r.bankId}/${r.version}/${r.sampleId}`;
  if (r.kind === "recording") return `recording/${r.asset.sha256}`;
  if (r.kind === "phrase")
    return `phrase/${r.pack.id}/${r.pack.version}/${r.pack.processing}/${r.role}/${r.variant}`;
  if (r.kind === "bilah")
    return `bilah/${r.pack.id}/${r.pack.version}/${r.pitch}`;
  return `percussion/${r.pack.id}/${r.pack.version}/${r.role}`;
}
function request(source, item) {
  const p = source.programme;
  if (item.control)
    return {
      kind: "phrase",
      pack: p.clipPack,
      role: item.role,
      variant: item.control.identity.variant,
    };
  if (item.kind === "bilah")
    return {
      kind: "bilah",
      pack: { id: p.bilah.id, version: p.bilah.version },
      pitch: item.pitch,
    };
  return { kind: "percussion", pack: p.pack, role: item.role };
}
// Count actual pending/playing/release owners, with the established lookahead
// and callback grace. Foreign rows are supplied by the native owner, not JSON.
export function canonicalVoiceAdmission(events, project, rate, foreign = []) {
  const solo = project.tracks.some((t) => t.solo),
    points = [];
  for (const { trackId, spec: s } of events) {
    const t = project.tracks.find((t) => t.id === trackId);
    if (!t) fail("invalidCanonicalScore");
    const weight =
      s.peak *
      s.velocity *
      0.25 *
      s.scale *
      (t.mute || (solo && !t.solo) ? 0 : t.gain) *
      eqBound(t.eq) *
      project.master.volume *
      panPeakFactor(s.buffer.numberOfChannels, s.pan) *
      panPeakFactor(2, t.pan);
    if (
      !Number.isFinite(weight) ||
      weight < 0 ||
      !integer(s.startFrame, 0, Number.MAX_SAFE_INTEGER) ||
      !integer(s.endFrame, s.startFrame + 1, Number.MAX_SAFE_INTEGER)
    )
      fail("invalidCanonicalScore");
    points.push(
      [s.startFrame - Math.ceil(0.75 * rate), 1, weight],
      [s.endFrame + Math.ceil(0.45 * rate), -1, -weight],
    );
  }
  for (const r of foreign) {
    if (
      !integer(
        r.startFrame,
        -Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ) ||
      !integer(r.endFrame, r.startFrame + 1, Number.MAX_SAFE_INTEGER) ||
      !Number.isFinite(r.peak) ||
      r.peak < 0
    )
      fail("invalidCanonicalScore");
    points.push([r.startFrame, 1, r.peak], [r.endFrame, -1, -r.peak]);
  }
  let owned = 0,
    peak = 0,
    maxOwned = 0,
    maxPeak = 0;
  for (const [, n, w] of points.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    owned += n;
    peak += w;
    maxOwned = Math.max(maxOwned, owned);
    maxPeak = Math.max(maxPeak, peak);
  }
  if (maxOwned > 16) fail("voiceLimit");
  if (maxPeak > 0.95) fail("voiceHeadroom");
  return Object.freeze({
    maxOwned,
    maxPeak,
    lookahead: 0.75,
    releaseGrace: 0.45,
  });
}

/** Trusted provider boundary: describe is synchronous; load owns its partial
 * decode on rejection and returns one releasable loan on success. All declared
 * source/decode/view/output allowances reserve BEFORE the first load/allocation.
 */
export async function prepareCanonicalScore(
  value,
  {
    registry,
    rate,
    memory,
    provider,
    createBuffer,
    command,
    signal,
    yieldTask,
    sharedMaster = false,
  } = {},
) {
  if (
    !["qa", "production"].includes(provider?.purpose) ||
    typeof provider.describe !== "function" ||
    typeof provider.load !== "function" ||
    typeof createBuffer !== "function"
  )
    fail("invalidCanonicalProvider");
  const timeline = await compileCanonicalTimeline(value, {
    registry,
    rate,
    memory,
    command,
    signal,
  });
  const loans = [],
    runs = [],
    requests = new Map();
  let staging = null,
    sourceBatch = null,
    published = false,
    freed = false,
    cleanupAttempted = false,
    playback = null,
    sharedPlayback = null;
  const check = () => {
    if (signal?.aborted) fail("cancelled");
  };
  const cleanup = () => {
    if (freed) return;
    if (cleanupAttempted) {
      if (sourceBatch && sourceBatch.pendingPrivate === 0) freed = true;
      return;
    }
    cleanupAttempted = true;
    playback?.dispose();
    sharedPlayback?.dispose();
    let cleanupError;
    for (const l of loans)
      try {
        l.release();
      } catch (e) {
        cleanupError ??= e;
      }
    sourceBatch?.dispose();
    staging?.release();
    timeline.dispose();
    freed = !cleanupError;
    if (cleanupError) throw cleanupError;
  };
  try {
    const defs = new Map(timeline.project.sourceDefs.map((d) => [d.id, d]));
    const rootSolo = timeline.project.tracks.some((t) => t.mix.solo);
    const active = (p) => {
      const t = timeline.project.tracks.find((t) => t.id === p.trackId);
      return (
        !t.mix.mute &&
        t.mix.volume > 0 &&
        (!rootSolo || t.mix.solo) &&
        timeline.project.master.volume > 0
      );
    };
    const nativePitch = timeline.placements.filter(
      (p) =>
        active(p) &&
        p.native?.voices.some(
          (v) =>
            v.event.masterVolume > 0 &&
            v.event.mix.volume > 0 &&
            ["pelog", "slendro"].includes(
              registry.bank(v.event.bankId, v.event.version).laras,
            ),
        ),
    );
    const legacyPitch = timeline.placements.filter(
      (p) =>
        active(p) &&
        p.composition?.masterVolume > 0 &&
        (p.composition.shots.some((s) => s.kind === "bilah" && s.gain > 0) ||
          p.composition.segments.some((s) =>
            s.phrases.some(
              (x) =>
                ["hum", "vocal-bass"].includes(x.role) &&
                x.control.enabled &&
                x.control.gate &&
                x.control.volume > 0,
            ),
          )),
    );
    for (const native of nativePitch)
      for (const legacy of legacyPitch)
        if (
          !timeline.project.tuningConsent &&
          !(
            native.sourceRef.id === legacy.sourceRef.id &&
            defs.get(native.sourceRef.id).programme.tuningConsent
          )
        )
          fail("tuningConsentRequired");
    const add = (r) => {
      const key = canonicalSoundKey(r);
      if (requests.has(key)) return;
      const raw = provider.describe(r);
      canonicalData(raw);
      const d = canonicalFrozenCopy(raw);
      if (
        !integer(d.frames, 1, 8388608) ||
        ![1, 2].includes(d.channels) ||
        d.sampleRate !== rate ||
        !integer(d.encodedBytes, 0, 16777216) ||
        !Number.isFinite(d.gainTrim) ||
        d.gainTrim < 0 ||
        d.gainTrim > 1 ||
        !/^[a-f0-9]{64}$/.test(d.contentHash) ||
        !["decoded-pcm", "encoded-asset"].includes(d.hashKind)
      )
        fail("invalidCanonicalSample");
      if (
        r.kind === "instrument" &&
        (d.frames !== r.descriptor.frames ||
          d.channels !== r.descriptor.channels ||
          d.sampleRate !== r.descriptor.sampleRate)
      )
        fail("instrumentBufferMismatch");
      if (
        r.kind === "recording" &&
        (d.frames !== r.asset.frames ||
          d.channels !== r.asset.channels ||
          d.sampleRate !== r.asset.sampleRate)
      )
        fail("recordingIdentityMismatch");
      if (r.kind === "phrase" && Math.abs(d.frames - 5 * rate) > 2)
        fail("invalidCanonicalSample");
      requests.set(key, { request: r, descriptor: d });
    };
    for (const placement of timeline.placements) {
      if (placement.recording) {
        if (placement.recording.playbackIssue)
          fail(placement.recording.playbackIssue);
        add({ kind: "recording", asset: placement.recording.asset });
      }
      for (const v of placement.native?.voices ?? [])
        add({
          kind: "instrument",
          bankId: v.event.bankId,
          version: v.event.version,
          sampleId: v.event.sampleId,
          descriptor: v.event.descriptor,
        });
      if (!placement.composition) continue;
      const source = defs.get(placement.composition.sourceId);
      for (const s of placement.composition.shots) add(request(source, s));
      for (const segment of placement.composition.segments)
        for (const s of segment.phrases)
          if (s.control.enabled) add(request(source, s));
      const prior = runs.findLast(
        (r) =>
          r.trackId === placement.trackId &&
          r.source.id === source.id &&
          r.pieces.at(-1).composition.endFrame ===
            placement.composition.startFrame,
      );
      if (prior && placement.phasePolicy === "continuous") {
        prior.pieces.push(placement);
        prior.continuous = true;
      } else
        runs.push({
          source,
          timeline,
          trackId: placement.trackId,
          originalId: placement.originalId,
          pieces: [placement],
          continuous: placement.loop || timeline.command.kind === "repeat",
        });
    }
    const project = Object.freeze({
      master: Object.freeze({
        ...timeline.project.master,
        volume:
          timeline.project.compatibility.sourceVersion < 5 &&
          !timeline.project.mixPolicy
            ? 1
            : timeline.project.master.volume,
      }),
      tracks: Object.freeze(
        timeline.project.tracks.map((t) =>
          Object.freeze({
            id: t.id,
            gain: t.mix.volume,
            pan: t.mix.pan,
            mute: t.mix.mute,
            solo: t.mix.solo,
            eq: t.fx.eq,
          }),
        ),
      ),
    });
    const batchOwned = hasCanonicalSourceBatch(provider, memory);
    let sourceBytes = 0,
      retainedSourceBytes = 0,
      runBytes = 0;
    for (const x of requests.values()) {
      const pcm = x.descriptor.frames * x.descriptor.channels * 4;
      if (batchOwned) {
        // Private source copies and actual cache owners have their own exact
        // tickets. Only this renderer's extra interleaved digest remains here.
        if (
          x.descriptor.hashKind === "decoded-pcm" ||
          x.request.kind === "recording"
        )
          if (!canonicalSourceHasVerifiedRecording(provider, x.request, memory))
            sourceBytes += 2 * pcm;
      } else {
        sourceBytes += 3 * pcm + 2 * x.descriptor.encodedBytes + 8192;
        retainedSourceBytes += 2 * pcm + 8192;
      }
    }
    for (const run of runs) {
      let tail = 0;
      for (const p of run.pieces)
        for (const s of p.composition.shots)
          tail = Math.max(
            tail,
            requests.get(canonicalSoundKey(request(run.source, s))).descriptor
              .frames,
          );
      run.maxFrames =
        run.pieces.at(-1).composition.endFrame -
        run.pieces[0].composition.startFrame +
        (run.continuous ? Math.max(tail, Math.round(0.004 * rate)) : 0);
      run.controlBytes =
        4096 +
        run.pieces.reduce(
          (n, p) => n + p.composition.segments.length * 6 * 128,
          0,
        );
      runBytes += run.maxFrames * 16 + 65537 * 4 + run.controlBytes;
    }
    const futureBytes =
      524288 +
      4096 +
      project.tracks.length * 8192 +
      fxBytes(project) +
      16 * 8192;
    // Structural owner admission precedes any decode/PCM allocation. Natural
    // ends are a conservative upper bound when a later wrap damp shortens them.
    const structural = [];
    for (const run of runs)
      structural.push({
        trackId: run.trackId,
        spec: {
          buffer: { numberOfChannels: 2 },
          startFrame: run.pieces[0].composition.startFrame,
          endFrame: run.pieces[0].composition.startFrame + run.maxFrames,
          peak: 0,
          velocity: 1,
          scale: 4,
          pan: 0,
        },
      });
    for (const p of timeline.placements) {
      for (const v of p.native?.voices ?? [])
        structural.push({
          trackId: p.trackId,
          spec: {
            buffer: { numberOfChannels: v.event.descriptor.channels },
            startFrame: v.startFrame,
            endFrame: v.endFrame,
            peak: 0,
            velocity: 1,
            scale: 0,
            pan: 0,
          },
        });
      if (p.recording)
        structural.push({
          trackId: p.trackId,
          spec: {
            buffer: { numberOfChannels: p.recording.asset.channels },
            startFrame: p.startFrame,
            endFrame: p.recording.readerEndFrame,
            peak: 0,
            velocity: 1,
            scale: 4,
            pan: 0,
          },
        });
    }
    canonicalVoiceAdmission(structural, project, rate);
    const preparationBytes = sourceBytes + runBytes + futureBytes + 8192;
    if (preparationBytes > 67108864) fail("combinedMemoryLimit");
    staging = memory.reserve(
      preparationBytes,
      "canonical/preparation-decode-output-and-future-native",
    );
    check();
    if (batchOwned)
      sourceBatch = reserveCanonicalSourceBatch(
        provider,
        [...requests.values()].map((x) => x.request),
        memory,
      );
    check();
    for (const x of requests.values()) {
      const loan = await (sourceBatch ?? provider).load(x.request, { signal });
      if (!loan || typeof loan.release !== "function")
        fail("invalidCanonicalProvider");
      loans.push(loan);
      check();
      const b = loan.buffer,
        d = x.descriptor;
      if (
        b?.length !== d.frames ||
        b.numberOfChannels !== d.channels ||
        b.sampleRate !== rate
      )
        fail("invalidCanonicalSample");
      const data = Array.from({ length: d.channels }, (_, c) =>
        b.getChannelData(c),
      );
      let peak = 0;
      for (const a of data) {
        if (!(a instanceof Float32Array) || a.length !== d.frames)
          fail("invalidCanonicalSample");
        for (const n of a) {
          if (!Number.isFinite(n)) fail("invalidCanonicalSample");
          peak = Math.max(peak, Math.abs(n));
        }
      }
      if (canonicalSourceHasVerifiedRecording(provider, x.request, memory)) {
        // This module-private loan verified the original digest and every
        // native Float32 bit before borrowing the exclusive buffer. Keep the
        // full finite/peak scan above; project receipts grant no authority.
        if (
          canonicalRecordingLoanHash(loan, memory) !== d.contentHash ||
          d.contentHash !== x.request.asset.sha256
        )
          fail("recordingIdentityMismatch");
      } else if (
        d.hashKind === "decoded-pcm" ||
        x.request.kind === "recording"
      ) {
        const raw = new Uint8Array(d.frames * d.channels * 4),
          view = new DataView(raw.buffer);
        for (let f = 0; f < d.frames; f++)
          for (let c = 0; c < d.channels; c++)
            view.setFloat32(
              (x.request.kind === "recording"
                ? c * d.frames + f
                : f * d.channels + c) * 4,
              data[c][f],
              true,
            );
        const hash = await hashBytes(raw);
        check();
        if (
          hash !== d.contentHash ||
          (x.request.kind === "recording" && hash !== x.request.asset.sha256)
        )
          fail("recordingIdentityMismatch");
      } else {
        const expected =
          x.request.kind === "instrument"
            ? x.request.descriptor.sha256
            : d.contentHash;
        if (
          provider.purpose !== "production" ||
          d.contentHash !== expected ||
          loan.verifiedHash !== expected
        )
          fail("canonicalAssetIdentityMismatch");
      }
      x.receipt = loan.receipt ?? null;
      x.entry = { buffer: b, stem: { gainTrim: d.gainTrim }, peak };
    }
    const entry = (source, item) =>
      requests.get(canonicalSoundKey(request(source, item))).entry;
    const events = [],
      phaseStates = [];
    let retainedRunBytes = 0;
    for (const run of runs) {
      check();
      const result = await renderCanonicalRun(run, {
        rate,
        entry,
        createBuffer,
        check,
        yieldTask,
      });
      retainedRunBytes += result.buffer.length * 16 + run.controlBytes;
      for (const phase of result.phaseStates) {
        const placed = timeline.placements.find(
          (p) => p.id === phase.placementId,
        );
        phaseStates.push(
          Object.freeze({
            ...phase,
            originalPlacementId: placed.originalId,
            occurrenceId: placed.occurrenceId,
          }),
        );
      }
      events.push({
        id: "composition/" + run.pieces[0].id,
        trackId: run.trackId,
        spec: {
          buffer: result.buffer,
          frames: result.buffer.length,
          startFrame: result.startFrame,
          naturalEndFrame: result.endFrame,
          endFrame: result.endFrame,
          dampFrame: null,
          velocity: 1,
          scale: 4,
          pan: 0,
          peak: result.peak,
        },
        internalMaxVoices: result.maxLogicalVoices,
      });
    }
    for (const p of timeline.placements) {
      for (const v of p.native?.voices ?? []) {
        const e = v.event,
          r = {
            kind: "instrument",
            bankId: e.bankId,
            version: e.version,
            sampleId: e.sampleId,
          },
          x = requests.get(canonicalSoundKey(r));
        let dampFrame = v.dampFrame;
        if (p.loop || timeline.command.kind === "repeat") {
          const candidates = [];
          for (const other of timeline.placements)
            if (
              other.originalId === p.originalId &&
              other.trackId === p.trackId &&
              other.sourceRef.id === p.sourceRef.id
            )
              for (const d of other.native?.events ?? [])
                if (
                  d.action === "damp" &&
                  d.bankId === e.bankId &&
                  d.sampleId === e.sampleId &&
                  d.tick > e.tick
                )
                  candidates.push(d.startFrame);
          if (!candidates.length)
            for (const d of p.native.events)
              if (
                d.action === "damp" &&
                d.bankId === e.bankId &&
                d.sampleId === e.sampleId
              )
                candidates.push(d.startFrame + (p.endFrame - p.startFrame));
          dampFrame = candidates.length
            ? candidates.reduce((a, b) => Math.min(a, b), Infinity)
            : null;
          if (dampFrame !== null && dampFrame >= v.naturalEndFrame)
            dampFrame = null;
        }
        events.push({
          id: `native/${p.id}/${e.localId}`,
          trackId: p.trackId,
          nativeIdentity: Object.freeze({
            sourceId: e.sourceId,
            eventId: e.localId,
            originalPlacementId: p.originalId,
            occurrenceId: p.occurrenceId,
          }),
          spec: {
            buffer: x.entry.buffer,
            frames: x.descriptor.frames,
            startFrame: v.startFrame,
            naturalEndFrame: v.naturalEndFrame,
            endFrame:
              dampFrame === null
                ? v.naturalEndFrame
                : Math.min(
                    v.naturalEndFrame,
                    dampFrame + Math.round(0.02 * rate),
                  ),
            dampFrame,
            velocity: e.velocity,
            scale:
              e.masterVolume *
              e.mix.volume *
              gamelanPlaybackScale(
                registry.bank(e.bankId, e.version),
                x.entry.peak,
              ),
            pan: e.mix.pan,
            peak: x.entry.peak,
          },
        });
      }
      if (p.recording) {
        const x = requests.get(
            canonicalSoundKey({ kind: "recording", asset: p.recording.asset }),
          ),
          endFrame = p.startFrame + x.descriptor.frames;
        const identity = {
          sha256: p.recording.asset.sha256,
          phase: p.alignment?.advanceFrames ?? 0,
        };
        const prior =
          p.loop && p.phasePolicy === "continuous"
            ? events.findLast(
                (e) =>
                  e.recordingIdentity?.sha256 === identity.sha256 &&
                  e.recordingIdentity.phase === identity.phase &&
                  e.trackId === p.trackId &&
                  e.spec.endFrame === p.startFrame,
              )
            : null;
        if (prior) {
          prior.spec.naturalEndFrame = endFrame;
          prior.spec.endFrame = endFrame;
          prior.spec.stopFrame = endFrame;
          prior.placementIds.push(p.id);
          continue;
        }
        events.push({
          id: "recording/" + p.id,
          recordingIdentity: identity,
          placementIds: [p.id],
          trackId: p.trackId,
          spec: {
            buffer: x.entry.buffer,
            frames: x.descriptor.frames,
            startFrame: p.startFrame,
            naturalEndFrame: endFrame,
            endFrame,
            dampFrame: null,
            velocity: 1,
            scale: 4,
            pan: 0,
            peak: x.entry.peak,
            ...(p.loop || p.alignment
              ? {
                  phaseOffsetFrames: p.alignment?.advanceFrames ?? 0,
                  loopFrames: x.descriptor.frames,
                  stopFrame: endFrame,
                }
              : {}),
          },
        });
      }
    }
    events.sort(
      (a, b) =>
        a.spec.startFrame - b.spec.startFrame ||
        a.trackId.localeCompare(b.trackId) ||
        a.id.localeCompare(b.id),
    );
    let naturalEnd = timeline.bodyFrames;
    for (const e of events) naturalEnd = Math.max(naturalEnd, e.spec.endFrame);
    const admission = canonicalVoiceAdmission(events, project, rate);
    const program = Object.freeze({
      rate,
      bodyFrames: timeline.bodyFrames,
      naturalEnd,
      tailFrames: timeline.eqTailFrames,
      frames: naturalEnd + timeline.eqTailFrames,
      events: Object.freeze(
        events.map((e) =>
          Object.freeze({
            ...e,
            spec: Object.freeze(e.spec),
            ...(e.placementIds
              ? {
                  placementIds: Object.freeze(e.placementIds),
                  recordingIdentity: Object.freeze(e.recordingIdentity),
                }
              : {}),
          }),
        ),
      ),
    });
    staging.resize(retainedSourceBytes + retainedRunBytes + 8192);
    check();
    const state = {
      disposed: false,
      refs: 0,
      cleanup,
      memory,
      loopMaterial: Object.freeze({ runs, entry, requests, registry }),
      getPlayback: (shared = false) => (shared ? sharedPlayback : playback),
      setPlayback: (value, shared = false) => {
        if (shared) sharedPlayback = value;
        else playback = value;
      },
      createBuffer,
      yieldTask,
    };
    const score = Object.freeze({
      kind: "canonical-prepared-score",
      revision: 1,
      project,
      program,
      timeline,
      admission,
      phaseStates: Object.freeze(phaseStates),
      // Borrow immutable non-PCM receipts from the independently retained
      // provider loans. Export keeps provenance without retaining sound data.
      sourceCredits: Object.freeze(
        [...requests].map(([key, x]) =>
          Object.freeze({
            key,
            descriptor: x.descriptor,
            receipt: x.receipt,
          }),
        ),
      ),
      provenance:
        provider.purpose === "qa" ? "synthetic-qa" : "trusted-asset-provider",
      playableVerified: provider.purpose === "production",
      durableSaved: false,
      dispose() {
        state.disposed = true;
        if (state.refs === 0) cleanup();
      },
      get disposed() {
        return state.disposed;
      },
      get resourcesReleased() {
        return freed;
      },
    });
    states.set(score, state);
    if (program.events.length > 16)
      await prepareCanonicalPlayback(score, {
        memory,
        createBuffer,
        signal,
        yieldTask,
        sharedMaster,
      });
    published = true;
    return score;
  } finally {
    if (!published) cleanup();
  }
}
export function retainCanonicalScore(score, memory = null) {
  const state = states.get(score);
  if (!state || state.disposed) fail("invalidCanonicalScore");
  if (memory && memory !== state.memory) fail("canonicalMemoryMismatch");
  state.refs++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    state.refs--;
    if (state.disposed && state.refs === 0) state.cleanup();
  };
}

// Internal capability: decoded originals remain under the prepared score's
// real source loans. Caller must retain that score for the producer lifetime.
export function canonicalLoopMaterial(score, memory) {
  const state = states.get(score);
  if (!state || state.disposed || state.memory !== memory)
    fail("invalidCanonicalScore");
  return state.loopMaterial;
}

export async function prepareCanonicalPlayback(
  score,
  { memory, createBuffer, signal, yieldTask, sharedMaster = false } = {},
) {
  const release = retainCanonicalScore(score, memory),
    state = states.get(score);
  let candidate = null;
  const shared = sharedMaster && limiterEnabled(score.project.master);
  const check = () => {
    if (signal?.aborted || state.disposed) fail("cancelled");
  };
  try {
    check();
    if (state.getPlayback(shared)) return score;
    candidate = await bakeCanonicalPlayback(score, {
      memory: state.memory,
      createBuffer: createBuffer ?? state.createBuffer,
      yieldTask: yieldTask ?? state.yieldTask,
      check,
      sharedMaster: shared,
    });
    check();
    if (state.getPlayback(shared)) candidate.dispose();
    else state.setPlayback(candidate, shared);
    candidate = null;
    return score;
  } finally {
    candidate?.dispose();
    release();
  }
}
export function canonicalPlaybackView(
  score,
  fromFrame = 0,
  { sharedMaster = false } = {},
) {
  const state = states.get(score);
  if (!state || state.disposed) fail("invalidCanonicalScore");
  const shared = sharedMaster && limiterEnabled(score.project.master);
  const needs =
    score.program.events.length > 16 ||
    (fromFrame > 0 &&
      score.project.tracks.some(
        (t) =>
          !t.eq.bypass &&
          (t.eq.lowDb !== 0 || t.eq.midDb !== 0 || t.eq.highDb !== 0),
      ));
  if (needs) {
    const ready = state.getPlayback(shared);
    if (!ready) fail("canonicalPlaybackNotPrepared");
    return ready.view;
  }
  return shared
    ? Object.freeze({
        ...score,
        project: Object.freeze({
          ...score.project,
          master: Object.freeze({
            ...score.project.master,
            limiter: BYPASS_LIMITER,
          }),
        }),
      })
    : score;
}
export function canonicalScoreFrame(score, frame) {
  const state = states.get(score);
  if (
    !state ||
    score.resourcesReleased ||
    !integer(frame, 0, score.program.frames)
  )
    fail("invalidCanonicalScore");
  const { program, project } = score,
    rate = program.rate,
    solo = project.tracks.some((t) => t.solo);
  const phases = score.phaseStates
    .filter((s) => s.startFrame <= frame && frame < s.endFrame)
    .map((s) => {
      const track = project.tracks.find((t) => t.id === s.trackId),
        outer =
          track &&
          !track.mute &&
          (!solo || track.solo) &&
          track.gain > 0 &&
          project.master.volume > 0;
      return Object.freeze({
        ...s,
        phaseFrame:
          s.anchorFrame === null
            ? null
            : (((frame - s.anchorFrame) % (5 * rate)) + 5 * rate) % (5 * rate),
        audible:
          s.control.enabled && s.gain > 0 && s.sourceMaster > 0 && !!outer,
      });
    });
  const recordings = program.events
    .filter(
      (e) =>
        e.recordingIdentity &&
        e.spec.startFrame <= frame &&
        frame < e.spec.endFrame,
    )
    .map((e) => {
      const s = e.spec,
        n = s.loopFrames ?? s.frames;
      return Object.freeze({
        id: e.id,
        trackId: e.trackId,
        sha256: e.recordingIdentity.sha256,
        placementIds: e.placementIds,
        originalPlacementIds: Object.freeze(
          e.placementIds
            .map(
              (id) =>
                score.timeline.placements.find((p) => p.id === id)?.originalId,
            )
            .filter(Boolean),
        ),
        rawFrame:
          (((frame - s.startFrame + (s.phaseOffsetFrames ?? 0)) % n) + n) % n,
      });
    });
  const voices = program.events
    .filter(
      (e) =>
        e.id.startsWith("native/") &&
        e.spec.startFrame <= frame &&
        frame < e.spec.endFrame,
    )
    .map((e) =>
      Object.freeze({
        id: e.id,
        trackId: e.trackId,
        startFrame: e.spec.startFrame,
        endFrame: e.spec.endFrame,
        dampFrame: e.spec.dampFrame,
        ...e.nativeIdentity,
        audible:
          e.spec.scale > 0 &&
          e.spec.velocity > 0 &&
          project.master.volume > 0 &&
          project.tracks.some(
            (t) =>
              t.id === e.trackId && !t.mute && (!solo || t.solo) && t.gain > 0,
          ),
      }),
    );
  const compositions = score.timeline.placements.flatMap((placement) => {
    const plan = placement.composition;
    if (!plan) return [];
    const segment = plan.segments.find(
      (s) => s.startFrame <= frame && frame < s.endFrame,
    );
    if (!segment) return [];
    const source = score.timeline.project.sourceDefs.find(
      (d) => d.id === plan.sourceId,
    );
    return [
      Object.freeze({
        sourceId: plan.sourceId,
        trackId: placement.trackId,
        patternId: segment.patternId,
        patternName: source.programme.patterns.find(
          (p) => p.id === segment.patternId,
        ).name,
        bar: segment.bar,
        step: canonicalGridStep(frame, {
          startTick: placement.startTick,
          bar: segment.bar,
          timing: score.timeline.project.timing,
          rate,
          swing: source.programme.timing.swing,
        }),
        startFrame: segment.startFrame,
        endFrame: segment.endFrame,
      }),
    ];
  });
  return Object.freeze({
    frame,
    stage:
      frame === program.frames
        ? "ended"
        : frame >= program.naturalEnd
          ? "eq-tail"
          : frame >= program.bodyFrames
            ? "natural-tail"
            : "body",
    occurrences: Object.freeze(
      score.timeline.occurrences
        .filter((o) => o.startFrame <= frame && frame < o.endFrame)
        .map((o) =>
          Object.freeze({
            ...o,
            sectionName: score.timeline.project.sections.find(
              (s) => s.id === o.sectionId,
            ).name,
          }),
        ),
    ),
    nativePlacements: Object.freeze(
      score.timeline.placements
        .filter((p) => p.native && p.startFrame <= frame && frame < p.endFrame)
        .map((p) =>
          Object.freeze({
            sourceId: p.sourceRef.id,
            placementId: p.id,
            originalPlacementId: p.originalId,
            occurrenceId: p.occurrenceId,
            startFrame: p.startFrame,
            endFrame: p.endFrame,
            progress: (frame - p.startFrame) / (p.endFrame - p.startFrame),
          }),
        ),
    ),
    phases: Object.freeze(phases),
    recordings: Object.freeze(recordings),
    voices: Object.freeze(voices),
    compositions: Object.freeze(compositions),
  });
}
