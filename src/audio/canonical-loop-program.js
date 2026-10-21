import {
  canonicalLoopMaterial,
  retainCanonicalScore,
  canonicalVoiceAdmission,
} from "./canonical-score.js";
import { MasterClock } from "../loop-station/master-clock.js";
import {
  SourceWindows,
  SOURCE_WINDOW_BYTES,
} from "../loop-station/source-windows.js";
import { createCanonicalLoopBus } from "./canonical-loop-bus.js";
import { canonicalLoopSourcePeak } from "./canonical-loop-bounds.js";
import { createPortableMixState } from "../loop-station/portable-mix-state.js";
import { BYPASS_LIMITER } from "../loop-station/fx-model.js";
import { PPQ } from "../project/instrument-project.js";
import { fail } from "../project/instrument-contract.js";

const HORIZON = 2 ** 42;
// Trusted producer capability, never imported project JSON. Exactly one song's
// immutable cue stencils are reused; active metadata/cache capacity is bounded.
export function createCanonicalLoopProgram(
  score,
  { memory, cycles = null, frames = null } = {},
) {
  const releaseScore = retainCanonicalScore(score, memory),
    material = canonicalLoopMaterial(score, memory),
    timeline = score.timeline,
    rate = score.program.rate,
    root = timeline.project,
    clock = new MasterClock(
      { timing: root.timing, clock: root.timing.clock },
      rate,
    ),
    periodTicks = timeline.occurrences.reduce(
      (n, o) => Math.max(n, o.startTick + o.lengthTicks),
      0,
    );
  if (!periodTicks || clock.frame(periodTicks) !== timeline.bodyFrames) {
    releaseScore();
    fail("canonicalLoopGeometry");
  }
  let terminalTick = cycles === null ? Infinity : periodTicks * cycles,
    disposed = false,
    state,
    held,
    frontierLease;
  const instances = new Set(),
    slots = [],
    heap = [],
    tracks = new Map(score.project.tracks.map((t, i) => [t.id, i]));
  try {
    held = memory.reserve(
      65537 * 4 +
        SOURCE_WINDOW_BYTES +
        16 * (2048 * 8 + 32768) +
        timeline.admission.candidateCount * 512 +
        65536,
      "canonical/rolling-stencils-control-curve-source-and-cache-pool",
    );
    const curve = Float32Array.from({ length: 65537 }, (_, i) => {
        const x = i / 32768 - 1,
          a = Math.abs(x);
        return a <= 0.7
          ? x
          : Math.sign(x) *
              (0.7 + 0.2 * (1 - (1 - Math.min(1, (a - 0.7) / 0.3)) ** 1.5));
      }),
      sourceWindows = new SourceWindows();
    for (let i = 0; i < 16; i++)
      slots.push({
        channels: [new Float32Array(2048), new Float32Array(2048)],
        used: false,
      });
    const acquireCache = () => {
      const s = slots.find((s) => !s.used);
      if (!s) fail("voiceLimit");
      s.used = true;
      return {
        channels: s.channels,
        release() {
          s.used = false;
        },
      };
    };
    function makeTemplate(run) {
      const segments = run.pieces.flatMap((piece) =>
          piece.composition.segments.map((s) => ({
            ...s,
            tick: piece.startTick + s.bar * 4 * PPQ,
            phrases: s.phrases.map((p) => ({
              ...p,
              entry: p.control.enabled ? material.entry(run.source, p) : null,
            })),
          })),
        ),
        present =
          root.compatibility.rolePresence.find(
            (r) => r.sourceId === run.source.id,
          )?.roles ?? [],
        first = run.pieces[0],
        last = run.pieces.at(-1),
        startTick = first.startTick,
        occurrence = timeline.occurrences.find(
          (o) => o.id === last.occurrenceId,
        ),
        spanTicks =
          last.sourceRef.id === run.source.id
            ? Math.min(
                last.lengthTicks,
                occurrence.startTick + occurrence.lengthTicks - last.startTick,
              )
            : run.source.programme.chain.length * 4 * PPQ,
        endTick = last.startTick + spanTicks;
      if (clock.frame(endTick) !== last.composition.endFrame)
        fail("canonicalLoopGeometry");
      return {
        id: "composition/" + first.id,
        trackId: run.trackId,
        sourceId: run.source.id,
        placementIds: run.pieces.map((p) => p.id),
        programme: run.source.programme,
        startTick,
        endTick,
        master: first.composition.masterVolume,
        roles: [
          ...present,
          ...segments[0].phrases
            .map((s) => s.role)
            .filter((r) => !present.includes(r)),
        ],
        segments,
        shots: run.pieces.flatMap((p) =>
          p.composition.shots.map((s) => ({
            ...s,
            entry: material.entry(run.source, s),
          })),
        ),
        entryContinuous: first.phasePolicy === "continuous",
        continuous: false,
      };
    }
    const templates = material.runs.map(makeTemplate),
      groups = [];
    const peakBound = canonicalLoopSourcePeak;
    for (const template of templates) {
      if (groups.includes(template)) continue;
      if (
        template.startTick === 0 &&
        template.endTick === periodTicks &&
        template.entryContinuous
      ) {
        template.continuous = true;
        groups.push(template);
        continue;
      }
      const last =
        template.startTick === 0 && template.entryContinuous
          ? templates.findLast(
              (t) =>
                t !== template &&
                t.endTick === periodTicks &&
                t.trackId === template.trackId &&
                t.sourceId === template.sourceId,
            )
          : null;
      if (last) {
        groups.push({ ...template, oneShot: true });
        groups.push({
          ...last,
          placementIds: [...last.placementIds, ...template.placementIds],
          endTick: periodTicks + template.endTick,
          segments: [
            ...last.segments,
            ...template.segments.map((s) => ({
              ...s,
              tick: s.tick + periodTicks,
            })),
          ],
          shots: [
            ...last.shots,
            ...template.shots.map((s) => ({
              ...s,
              tick: s.tick + periodTicks,
            })),
          ],
        });
        last.joined = true;
      } else if (!template.joined) groups.push(template);
    }
    const cues = [];
    for (const g of groups)
      cues.push({
        kind: "bus",
        id: g.id,
        trackId: g.trackId,
        tick: g.startTick,
        repeat: !g.continuous && !g.oneShot,
        template: g,
      });
    for (const e of score.program.events) {
      if (e.nativeIdentity) {
        const p = timeline.placements.find(
            (p) =>
              p.trackId === e.trackId &&
              p.native?.voices.some(
                (v) => e.id === `native/${p.id}/${v.event.localId}`,
              ),
          ),
          v = p.native.voices.find(
            (v) => v.event.localId === e.nativeIdentity.eventId,
          ),
          ev = v.event,
          damp = timeline.placements
            .filter(
              (o) =>
                o.originalId === p.originalId &&
                o.trackId === p.trackId &&
                o.sourceRef.id === p.sourceRef.id,
            )
            .flatMap((o) => o.native?.events ?? [])
            .filter(
              (d) =>
                d.action === "damp" &&
                d.bankId === ev.bankId &&
                d.sampleId === ev.sampleId,
            )
            .map((d) => d.tick)
            .sort((a, b) => a - b);
        cues.push({
          kind: "native",
          id: e.id,
          trackId: e.trackId,
          tick: ev.tick,
          repeat: true,
          spec: e.spec,
          voice: v,
          placement: p,
          damp,
        });
      } else if (e.recordingIdentity) {
        const p = timeline.placements.find((p) =>
          e.placementIds.includes(p.id),
        );
        cues.push({
          kind: "recording",
          id: e.id,
          trackId: e.trackId,
          tick: p.startTick,
          repeat: true,
          spec: e.spec,
          endTick: clock.tick(e.spec.endFrame),
          spanTicks: p.lengthTicks,
        });
      }
    }
    const at = (q) => clock.frame(q.cue.tick + q.cycle * periodTicks),
      compare = (a, b) =>
        at(a) - at(b) ||
        tracks.get(a.cue.trackId) - tracks.get(b.cue.trackId) ||
        a.cue.id.localeCompare(b.cue.id),
      push = (row) => {
        let i = heap.length;
        heap.push(row);
        while (i) {
          const p = (i - 1) >> 1;
          if (compare(heap[p], row) <= 0) break;
          heap[i] = heap[p];
          i = p;
        }
        heap[i] = row;
      },
      pop = () => {
        const top = heap[0],
          last = heap.pop();
        if (heap.length) {
          let i = 0;
          while (2 * i + 1 < heap.length) {
            let c = 2 * i + 1;
            if (c + 1 < heap.length && compare(heap[c + 1], heap[c]) < 0) c++;
            if (compare(last, heap[c]) <= 0) break;
            heap[i] = heap[c];
            i = c;
          }
          heap[i] = last;
        }
        return top;
      };
    for (const cue of cues) push({ cue, cycle: 0 });
    function nativeSpec(c, cycle) {
      const offset = cycle * periodTicks,
        startFrame = clock.frame(c.tick + offset),
        naturalEnd = startFrame + c.spec.buffer.length;
      let dampFrame = null;
      const next = c.damp.find((t) => t > c.tick);
      if (next !== undefined && next + offset < terminalTick)
        dampFrame = clock.frame(next + offset);
      else if (c.damp.length && offset + periodTicks + c.damp[0] < terminalTick)
        dampFrame = clock.frame(offset + periodTicks + c.damp[0]);
      else if (c.damp.length) {
        const local = c.placement.native.events.filter(
          (d) =>
            d.action === "damp" &&
            d.bankId === c.voice.event.bankId &&
            d.sampleId === c.voice.event.sampleId,
        );
        if (local.length)
          dampFrame = Math.min(
            ...local.map((d) =>
              clock.frame(d.tick + offset + c.placement.lengthTicks),
            ),
          );
      }
      if (dampFrame !== null && dampFrame >= naturalEnd) dampFrame = null;
      return {
        ...c.spec,
        startFrame,
        naturalEndFrame: naturalEnd,
        endFrame:
          dampFrame === null
            ? naturalEnd
            : Math.min(naturalEnd, dampFrame + Math.round(0.02 * rate)),
        dampFrame,
      };
    }
    // Preflight a conservative periodic frontier in real musical-frame space.
    // +/-one frame covers every absolute-rounding phase, including late cycles.
    // No actual source gain/PCM is changed to obtain this certificate.
    let maxTail = Math.round(0.004 * rate);
    for (const x of material.requests.values())
      maxTail = Math.max(maxTail, x.descriptor.frames);
    const period = periodTicks * clock.framesPerTick,
      contexts = Math.ceil((maxTail + 1.2 * rate) / period) + 3,
      frontierCount = cues.length * (contexts * 2 + 1);
    if (frontierCount > 100000) fail("combinedMemoryLimit");
    frontierLease = memory.reserve(
      4096 + frontierCount * 512,
      "canonical/periodic-frontier-proof",
    );
    const frontier = [];
    for (const c of cues) {
      if (c.kind === "bus" && c.template.continuous) {
        frontier.push({
          trackId: c.trackId,
          spec: {
            buffer: { numberOfChannels: 2 },
            startFrame: 0,
            endFrame: HORIZON,
            peak: peakBound(c.template),
            velocity: 1,
            scale: 4,
            pan: 0,
          },
        });
        continue;
      }
      for (let k = 0; k <= contexts * 2; k++) {
        if (!c.repeat && k) break;
        const start = Math.max(
          0,
          Math.floor((c.tick + k * periodTicks) * clock.framesPerTick) - 1,
        );
        if (c.kind === "bus")
          frontier.push({
            trackId: c.trackId,
            spec: {
              buffer: { numberOfChannels: 2 },
              startFrame: start,
              endFrame:
                Math.ceil(
                  (c.template.endTick + k * periodTicks) * clock.framesPerTick,
                ) +
                maxTail +
                1,
              peak: peakBound(c.template),
              velocity: 1,
              scale: 4,
              pan: 0,
            },
          });
        else {
          const s = c.kind === "native" ? nativeSpec(c, k) : c.spec;
          frontier.push({
            trackId: c.trackId,
            spec: {
              ...s,
              startFrame: start,
              endFrame:
                start +
                (c.kind === "native"
                  ? s.endFrame - s.startFrame
                  : c.spec.endFrame - c.spec.startFrame) +
                2,
            },
          });
        }
      }
    }
    const admission = canonicalVoiceAdmission(frontier, score.project, rate);
    frontierLease.release();
    frontierLease = null;
    const source = {
      get nextFrame() {
        const q = heap[0];
        return !q || q.cue.tick + q.cycle * periodTicks >= terminalTick
          ? Infinity
          : at(q);
      },
      beforeFrame(frame, active) {
        for (const e of active) if (e.loopBus) e.endFrame = e.loopBus.endFrame;
        for (const bus of instances)
          if (bus.endFrame <= frame) {
            bus.dispose();
            instances.delete(bus);
          }
      },
      take() {
        const q = pop(),
          c = q.cue,
          cycle = q.cycle,
          offset = cycle * periodTicks;
        if (c.repeat) {
          q.cycle++;
          push(q);
        }
        let spec;
        if (c.kind === "native") spec = nativeSpec(c, cycle);
        else if (c.kind === "recording") {
          const startFrame = clock.frame(c.tick + offset),
            span = c.spec.endFrame - c.spec.startFrame;
          spec = {
            ...c.spec,
            startFrame,
            naturalEndFrame: startFrame + span,
            endFrame: startFrame + span,
            stopFrame: startFrame + span,
          };
        } else {
          const bus = createCanonicalLoopBus(c.template, {
            clock,
            rate,
            cycleTick: offset,
            periodTicks,
            stopTick: () => terminalTick,
            sourceWindows,
            curve,
            acquireCache,
          });
          instances.add(bus);
          spec = {
            buffer: bus.buffer,
            frames: bus.buffer.length,
            startFrame: bus.startFrame,
            endFrame: bus.endFrame,
            naturalEndFrame: bus.endFrame,
            dampFrame: null,
            velocity: 1,
            scale: 4,
            pan: 0,
            peak: peakBound(c.template),
            loopBus: bus,
          };
        }
        return { id: c.id, trackId: c.trackId, spec };
      },
    };
    state = createPortableMixState(
      {
        ...score.project,
        master: { ...score.project.master, limiter: BYPASS_LIMITER },
      },
      { rate, frames: frames ?? HORIZON, events: [] },
      { memory, boundedSourceViews: true, eventSource: source },
    );
    function finalFrames() {
      let end = clock.frame(terminalTick);
      const lastCycle = Math.max(
        0,
        Math.floor((terminalTick - 1) / periodTicks),
      );
      for (const c of cues) {
        if (c.kind === "native")
          end = Math.max(end, nativeSpec(c, lastCycle).endFrame);
        else if (c.kind === "recording")
          end = Math.max(
            end,
            clock.frame(c.tick + lastCycle * periodTicks) +
              c.spec.endFrame -
              c.spec.startFrame,
          );
        else {
          const cycles =
            c.template.continuous || c.template.oneShot
              ? [0]
              : lastCycle
                ? [lastCycle - 1, lastCycle]
                : [0];
          for (const cycle of cycles) {
            const bus = createCanonicalLoopBus(c.template, {
              clock,
              rate,
              cycleTick: cycle * periodTicks,
              periodTicks,
              stopTick: () => terminalTick,
              sourceWindows,
              curve,
              acquireCache,
            });
            end = Math.max(end, bus.endFrame);
            bus.dispose();
          }
        }
      }
      return end + score.program.tailFrames;
    }
    return Object.freeze({
      admission,
      periodTicks,
      clock,
      rate,
      renderInto: (channels) => {
        if (disposed) fail("memoryReleased");
        return state.renderInto(channels);
      },
      snapshot: () => ({
        ...state.snapshot(),
        instances: instances.size,
        cacheSlots: slots.filter((s) => s.used).length,
        cueStencils: cues.length,
        terminalTick,
      }),
      phasesAt(rows, absoluteFrame) {
        const tick = clock.tick(absoluteFrame),
          same = (a, b) =>
            JSON.stringify(a.identity) === JSON.stringify(b.identity);
        return rows.map((row) => {
          if (!row.control.enabled) return row;
          let instanceCycle = 0;
          const g = groups.find((g) => {
            if (
              g.sourceId !== row.sourceId ||
              g.trackId !== row.trackId ||
              !g.placementIds.includes(row.placementId)
            )
              return false;
            if (g.continuous) {
              instanceCycle = 0;
              return tick >= g.startTick;
            }
            const k = g.oneShot
                ? 0
                : Math.floor((tick - g.startTick) / periodTicks),
              local = tick - k * periodTicks;
            if (k < 0 || local < g.startTick || local >= g.endTick)
              return false;
            instanceCycle = k;
            return true;
          });
          if (!g) return row;
          const states = g.segments.map((s) => ({
              tick: s.tick,
              state: s.phrases.find((p) => p.role === row.role),
            })),
            currentCycle = g.continuous
              ? Math.floor(tick / periodTicks)
              : instanceCycle,
            firstCycle = g.continuous
              ? Math.max(0, currentCycle - 1)
              : instanceCycle;
          let previous =
              g.continuous && firstCycle > 0
                ? states.at(-1).state.control
                : null,
            anchor =
              clock.frame(g.startTick) - (states[0].state.phaseFrame ?? 0),
            action = "restart",
            absoluteStartFrame = anchor;
          for (let k = firstCycle; k <= currentCycle; k++)
            for (const s of states) {
              const at = s.tick + k * periodTicks;
              if (at > tick) break;
              const c = s.state.control,
                continuing =
                  c.enabled &&
                  previous?.enabled &&
                  same(previous, c) &&
                  c.phasePolicy === "continue-source";
              action = c.enabled
                ? continuing
                  ? "continue"
                  : "restart"
                : previous?.enabled
                  ? "exit"
                  : "silent";
              if (c.enabled && !continuing)
                anchor =
                  clock.frame(at) -
                  (k === 0 && s === states[0] ? (s.state.phaseFrame ?? 0) : 0);
              absoluteStartFrame = clock.frame(at);
              previous = c;
            }
          return {
            ...row,
            action,
            anchorFrame: anchor,
            absoluteStartFrame,
            phaseFrame:
              (((absoluteFrame - anchor) % (5 * rate)) + 5 * rate) % (5 * rate),
          };
        });
      },
      finish() {
        const cursor = state.snapshot().frame,
          future =
            Math.max(cursor, ...[...instances].map((b) => b.renderedThrough)) +
            4096;
        terminalTick =
          (Math.floor(clock.tick(future) / periodTicks) + 1) * periodTicks;
        return {
          bodyFrames: clock.frame(terminalTick),
          frames: finalFrames(),
        };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        state.dispose();
        for (const b of instances) b.dispose();
        instances.clear();
        for (const s of slots) s.channels = null;
        slots.length = heap.length = 0;
        held.release();
        releaseScore();
      },
    });
  } catch (e) {
    frontierLease?.release();
    state?.dispose();
    for (const b of instances) b.dispose();
    held?.release();
    releaseScore();
    throw e;
  }
}
