import { createCanonicalLegacyBridge } from "./canonical-legacy-bridge.js";
import { inspectBuffer } from "./sample-bank.js";
import {
  compositionLoop,
  compositionShot,
  compositionNote,
  createCompositionMixer,
} from "./composition.js";
import { stepBeat } from "./sequencing.js";
import { fail } from "../project/instrument-contract.js";

export function canonicalLegacyNeededPitches(project, arrangement) {
  const ids = new Set(arrangement ? project.chain : [project.activePattern]);
  return [
    ...new Set(
      project.patterns
        .filter((p) => ids.has(p.id))
        .flatMap((p) => p.notes.filter(Boolean).map((n) => n.pitch)),
    ),
  ];
}

// Opt-in instance hooks for a NEW isolated legacy engine. No prototype/global
// patch and no app auto-initialization. Reserve context cost before creation.
export function createCanonicalLegacyOwner({ memory, contextFactory } = {}) {
  const contextLease = memory.reserve(
    524288,
    "legacy/owned-context-and-common-graph",
  );
  let context;
  try {
    context = contextFactory();
  } catch (error) {
    contextLease.release();
    throw error;
  }
  let bridge;
  try {
    bridge = createCanonicalLegacyBridge({ memory, context });
  } catch (error) {
    let pendingCleanup = null;
    const cleanup = () => {
      if (!pendingCleanup) {
        pendingCleanup = (async () => {
          if (context?.state !== "closed") await context.close();
          if (context.state !== "closed") fail("canonicalContextStillOwned");
          contextLease.release();
        })();
        pendingCleanup.catch(() => {
          pendingCleanup = null;
        });
      }
      return pendingCleanup;
    };
    error.cleanup = cleanup;
    error.cleanupPromise = cleanup();
    throw error;
  }
  const rows = new Set(),
    bindings = new Map(),
    pending = new Map();
  let terminal = false,
    closing = null,
    engine = null,
    oldDispose = null,
    oldRetry = null;
  const check = () => {
    if (terminal || context.state === "closed") fail("canonicalBridgeClosed");
  };
  function pin(entry) {
    const binding = bindings.get(entry);
    if (!binding) fail("canonicalAssetUnavailable");
    binding.refs++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      binding.refs--;
    };
  }
  function finish(row) {
    if (row.released || row.cleaning) return;
    const physicallyClosed = context.state === "closed",
      disconnected = row.nodes.every((n) => n.disconnected);
    if (!physicallyClosed && !(row.ended && disconnected) && !row.cancelled)
      return;
    row.cleaning = true;
    try {
      if (row.cancelled && !row.started) row.ticket.failedBeforeStart();
      else if (disconnected && row.started) row.ticket.disconnected();
      row.releasePin();
      row.held.release();
      row.released = true;
      rows.delete(row);
      row.nodes.length = 0;
    } catch (error) {
      row.cleanupError = error;
    } finally {
      row.cleaning = false;
    }
  }
  function construct(entry, velocity, create) {
    check();
    const releasePin = pin(entry);
    let ticket, held;
    try {
      ticket = bridge.pending({
        peak: entry.metrics.peak * entry.stem.gainTrim * velocity * Math.SQRT2,
        label: "actual-legacy-voice",
      });
      held = bridge.reserveMemory(8192, "actual-voice-nodes");
    } catch (error) {
      ticket?.failedBeforeStart();
      releasePin();
      throw error;
    }
    const row = {
      ticket,
      held,
      releasePin,
      nodes: [],
      source: null,
      started: false,
      ended: false,
      cancelled: false,
      released: false,
      cleaning: false,
      cleanupError: null,
    };
    rows.add(row);
    const wrap = (node) => {
      const tracked = { node, disconnected: false },
        disconnect = node.disconnect.bind(node);
      row.nodes.push(tracked);
      node.disconnect = (...args) => {
        const result = disconnect(...args);
        if (!args.length) tracked.disconnected = true;
        finish(row);
        return result;
      };
      return node;
    };
    const guarded = new Proxy(context, {
      get(target, key) {
        if (key === "createBufferSource")
          return (...args) => {
            if (row.source) fail("invalidCanonicalOwner");
            const source = wrap(target.createBufferSource(...args)),
              start = source.start.bind(source);
            row.source = source;
            source.start = (...values) => {
              const result = start(...values);
              row.started = true;
              ticket.started(source);
              source.addEventListener(
                "ended",
                () => {
                  row.ended = true;
                  finish(row);
                },
                { once: true },
              );
              return result;
            };
            return source;
          };
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (["createGain", "createStereoPanner"].includes(key))
          return (...args) => wrap(value.apply(target, args));
        return value.bind(target);
      },
    });
    try {
      const voice = create(guarded);
      if (!row.source) {
        row.cancelled = true;
        for (const n of row.nodes) n.node.disconnect();
        finish(row);
      }
      return voice;
    } catch (error) {
      row.cancelled = !row.started;
      try {
        row.source?.stop();
      } catch {
        /* Actual ended/close still owns a started source. */
      }
      for (const n of row.nodes)
        try {
          n.node.disconnect();
        } catch {
          /* Close owns a failed disconnect. */
        }
      finish(row);
      throw error;
    }
  }
  function bind(entry, loan, bank) {
    if (bindings.has(entry)) {
      loan.release();
      return entry;
    }
    const duration =
        bank.pack.kind === "one-shot"
          ? entry.stem.durationSeconds
          : bank.duration,
      metrics = inspectBuffer(loan.buffer, duration);
    engine.admitCandidate(entry, metrics);
    const binding = { entry, loan, refs: 1 };
    bindings.set(entry, binding);
    Object.assign(entry, {
      buffer: loan.buffer,
      metrics,
      state: "ready",
      error: null,
      progress: null,
    });
    return entry;
  }
  async function close(options = {}) {
    if (closing) return closing;
    terminal = true;
    closing = (async () => {
      if (engine && !engine.disposed) await oldDispose(options);
      else if (engine?.disposalClosePending) await oldRetry();
      await Promise.allSettled([...pending.values()].map((job) => job.promise));
      await bridge.close();
      for (const row of [...rows]) finish(row);
      const errors = [];
      for (const row of rows)
        if (row.cleanupError) errors.push(row.cleanupError);
      for (const [entry, binding] of [...bindings]) {
        if (binding.refs > 1) {
          errors.push(Error("canonicalVoiceStillOwned"));
          continue;
        }
        try {
          binding.loan.release();
          entry.buffer = null;
          entry.metrics = null;
          bindings.delete(entry);
        } catch (error) {
          errors.push(error);
        }
      }
      contextLease.release();
      if (errors.length)
        throw new AggregateError(errors, "canonicalLegacyCleanupPending");
    })();
    closing.catch(() => {
      closing = null;
    });
    return closing;
  }
  return Object.freeze({
    context,
    bridge,
    construct,
    close,
    snapshot() {
      return Object.freeze({
        terminal,
        voices: rows.size,
        cachePins: bindings.size,
        pendingLoads: pending.size,
        cleanupPending: [...rows].filter((r) => r.cleanupError).length,
        bridge: bridge.snapshot(),
      });
    },
    attach(target, { acquireEntry } = {}) {
      check();
      if (
        engine ||
        target.context !== context ||
        target.voices.size ||
        target.pending.size ||
        target.playbackRequested ||
        typeof acquireEntry !== "function"
      )
        fail("legacyEngineBusy");
      engine = target;
      oldDispose = engine.dispose.bind(engine);
      oldRetry = engine.retryDisposedClose.bind(engine);
      for (const bank of engine.banks) {
        const oldCancel = bank.cancelLoading.bind(bank);
        bank.cancelLoading = () => {
          for (const job of pending.values())
            if (job.bank === bank) job.abort.abort();
          oldCancel();
        };
        bank.load = (id, requestedContext) => {
          check();
          if (requestedContext !== context) fail("invalidCanonicalOwner");
          const entry = bank.get(id);
          if (bindings.has(entry))
            return Promise.resolve(bank.verifyRetained(id));
          if (pending.has(entry)) return pending.get(entry).promise;
          const abort = new AbortController(),
            job = { bank, abort, promise: null };
          pending.set(entry, job);
          job.promise = (async () => {
            let loan = null;
            try {
              loan = await acquireEntry(entry.stem, {
                signal: abort.signal,
                bank,
              });
              if (abort.signal.aborted || terminal) fail("cancelled");
              const result = bind(entry, loan, bank);
              loan = null;
              return result;
            } finally {
              pending.delete(entry);
              loan?.release();
            }
          })();
          return job.promise;
        };
      }
      for (const name of ["addVoice", "addShot"]) {
        const original = engine[name].bind(engine);
        engine[name] = (...args) => {
          const entry = engine.playableEntry(
            args[0],
            name === "addVoice"
              ? (args[2] ?? engine.selectedVariant.get(args[0]))
              : engine.selectedVariant.get(args[0]),
          );
          if (!entry) fail("canonicalAssetUnavailable");
          return construct(
            entry,
            name === "addShot" ? (args[2] ?? 1) : 1,
            (guarded) => {
              const prior = engine.context;
              engine.context = guarded;
              try {
                return original(...args);
              } finally {
                engine.context = prior;
              }
            },
          );
        };
      }
      const c = engine.composition;
      if (c) {
        c.banks.load = async (project, requestedContext, signal) => {
          if (signal?.aborted) fail("cancelled");
          const jobs = project.clips
            .filter((clip) => clip.enabled)
            .map((clip) => [c.banks.loops[clip.variant - 1], clip.role]);
          for (const pitch of canonicalLegacyNeededPitches(
            project,
            engine.arrangement,
          ))
            jobs.push([c.banks.instrument, pitch]);
          await Promise.all(
            jobs.map(async ([bank, id]) => {
              await bank.load(id, requestedContext);
              if (signal?.aborted) fail("cancelled");
            }),
          );
        };
        c.start = (when) => {
          for (const clip of c.project.clips.filter((x) => x.enabled)) {
            const entry = c.banks.loop(clip);
            c.own(
              construct(entry, 1, (ctx) =>
                compositionLoop(
                  ctx,
                  c.mixer,
                  c.banks,
                  clip,
                  when,
                  engine.transport.phaseSeconds(when, 2),
                ),
              ),
              "clip",
              { variant: clip.variant },
            );
          }
        };
        c.step = (index, when) => {
          const note = compositionNote(c.project, index, engine.arrangement);
          if (!note) return;
          const entry = c.banks.instrument.get(note.pitch),
            prior = [...engine.voices]
              .filter((v) => v.id === "bilah" && v.when <= when)
              .sort((a, b) => b.when - a.when)[0];
          c.own(
            construct(entry, note.velocity, (ctx) =>
              compositionShot(ctx, c.mixer, c.banks, note, when, prior),
            ),
            "note",
            { index, pitch: note.pitch, velocity: note.velocity },
          );
        };
        c.pad = async (pitch) => {
          check();
          const operation = engine.operation,
            ctx = engine.ensureContext();
          if (ctx.state !== "running") await ctx.resume();
          if (!c.mixer || c.context !== ctx) {
            c.mixer?.dispose();
            c.context = ctx;
            c.mixer = createCompositionMixer(ctx, engine.master, c.project);
            c.mixer.update(c.project, true);
          }
          const entry = c.banks.instrument.get(pitch);
          if (!entry.buffer) await c.banks.instrument.load(pitch, ctx);
          if (
            engine.disposed ||
            operation !== engine.operation ||
            ctx.state !== "running"
          )
            return;
          let when = ctx.currentTime + 0.005;
          if (engine.transport.running && c.project.timing.quantize) {
            const index = engine.nextSequenceStep(ctx.currentTime, 0.005);
            when = engine.transport.timeAt(
              stepBeat(index, c.project.timing.swing),
            );
          }
          c.own(
            construct(entry, 1, (guarded) =>
              compositionShot(
                guarded,
                c.mixer,
                c.banks,
                { pitch, velocity: 1 },
                when,
              ),
            ),
            "note-pad",
            { pitch },
          );
        };
      }
      engine.dispose = (options) => close(options);
      engine.retryDisposedClose = () => close();
      return engine;
    },
  });
}
