import { SampleBank } from "./sample-bank.js";
import { INSTRUMENT_BASE_GAIN } from "./instrument-levels.js";
import { prepareBumiBuffer } from "../beatbox/bumi-presence.js";
import {
  createLoopVoice,
  createOneShotVoice,
  fadeOutVoice,
  cancelFade,
} from "./voice.js";
import {
  CLIP_ROLES,
  allMix,
  mixedStudioView,
  studioView,
  patternClips,
  compositionClips,
} from "../project/composition-model.js";
import { trackGain, stepTime } from "./sequencing.js";
import { ProjectError } from "../project/schema.js";
import {
  KENDHANG_STROKES,
  KENDHANG_CREDITS,
  kendhangUsed,
} from "../project/kendhang.js";
import { BASS_PITCHES, BASS_CREDITS, bassUsed } from "../project/bass.js";
import {
  GUITAR_PITCHES,
  GUITAR_CREDITS,
  guitarUsed,
} from "../project/guitar.js";

// All loops occupy the full arrangement, at their original 96 BPM. Their native
// two-bar phase continues across pattern boundaries. No time stretch or repitch.
export function compositionNote(project, index, arrangement = true) {
  const id = compositionPatternId(project, index, arrangement);
  return project.patterns.find((p) => p.id === id).notes[index % 16];
}
export function compositionPatternId(project, index, arrangement = true) {
  return arrangement
    ? project.chain[Math.floor(index / 16) % project.chain.length]
    : project.activePattern;
}
// Shared live/offline transition rule: equal role+variant retains its native
// source. Changed/disabled sources crossfade; joins use absolute two-bar phase.
export function transitionPatternLoops(state, clips, start, end) {
  const next = new Map(),
    started = [],
    ended = [];
  for (const c of clips.filter((c) => c.enabled)) {
    const old = state.get(c.role);
    if (old?.variant === c.variant) next.set(c.role, old);
    else {
      const voice = start(c);
      started.push(voice);
      next.set(c.role, { variant: c.variant, voice });
    }
  }
  for (const [role, old] of state)
    if (next.get(role) !== old) {
      end(old.voice);
      ended.push(old.voice);
    }
  return { next, started, ended };
}
export function createCompositionMixer(context, master, project) {
  const nodes = new Map();
  for (const role of [
    ...CLIP_ROLES.map((role) => "clip-" + role),
    "bilah",
    ...(project.kendhang ? ["kendhang"] : []),
    ...(project.bass ? ["bass"] : []),
    ...(project.guitar ? ["guitar"] : []),
  ]) {
    const gain = context.createGain();
    if (role.startsWith("clip-")) {
      const left = context.createGain(),
        right = context.createGain(),
        merge = context.createChannelMerger(2);
      gain.connect(left);
      gain.connect(right);
      left.connect(merge, 0, 0);
      right.connect(merge, 0, 1);
      merge.connect(master);
      nodes.set(role, { gain, left, right, merge });
    } else {
      const pan = context.createStereoPanner();
      gain.connect(pan);
      pan.connect(master);
      nodes.set(role, { gain, pan });
    }
  }
  const mixer = {
    nodes,
    update(
      p,
      immediate = false,
      when = context.currentTime,
      patternId = p.activePattern,
    ) {
      const tracks = allMix(p, patternId);
      for (const t of tracks) {
        const n = nodes.get(t.role);
        if (!n) continue;
        const set = (param, value) =>
          immediate
            ? (param.value = value)
            : param.setTargetAtTime(value, when, 0.004);
        set(
          n.gain.gain,
          trackGain(t, tracks) * (INSTRUMENT_BASE_GAIN[t.role] ?? 1),
        );
        if (n.pan) set(n.pan.pan, t.pan);
        else {
          // Center is exactly dual mono (legacy loudness), with constant-energy
          // pan rather than adding both duplicate channels at the far edge.
          set(
            n.left.gain,
            t.pan === 0
              ? 1
              : Math.SQRT2 * Math.cos(((t.pan + 1) * Math.PI) / 4),
          );
          set(
            n.right.gain,
            t.pan === 0
              ? 1
              : Math.SQRT2 * Math.sin(((t.pan + 1) * Math.PI) / 4),
          );
        }
      }
    },
    cancelFrom(when) {
      for (const n of nodes.values())
        for (const node of Object.values(n))
          for (const param of [node.gain, node.pan].filter(Boolean)) {
            try {
              param.cancelAndHoldAtTime?.(when);
            } catch {
              /* Explicit target below remains the fallback. */
            }
            param.cancelScheduledValues(when);
          }
    },
    dispose() {
      for (const n of nodes.values())
        for (const node of Object.values(n)) node.disconnect();
      nodes.clear();
    },
  };
  mixer.update(project, true);
  return mixer;
}
export class CompositionBanks {
  constructor(loopPack, instrumentPack, options = {}) {
    this.loops = [1, 2].map(
      (v) =>
        new SampleBank(loopPack(v), {
          ...options,
          prepareBuffer: prepareBumiBuffer,
        }),
    );
    this.instrument = new SampleBank(instrumentPack(), options);
    this.kendhang = options.kendhangPack
      ? new SampleBank(options.kendhangPack(), options)
      : null;
    this.bass = options.bassPack
      ? new SampleBank(options.bassPack(), options)
      : null;
    this.guitar = options.guitarPack
      ? new SampleBank(options.guitarPack(), options)
      : null;
    this.banks = [
      ...this.loops,
      this.instrument,
      ...(this.kendhang ? [this.kendhang] : []),
      ...(this.bass ? [this.bass] : []),
      ...(this.guitar ? [this.guitar] : []),
    ];
  }
  async load(p, context, signal) {
    const jobs = [
      ...new Map(
        compositionClips(p)
          .filter((c) => c.enabled)
          .map((c) => [c.role + "/" + c.variant, c]),
      ).values(),
    ]
      .filter((c) => c.enabled)
      .map((c) => [this.loops[c.variant - 1], c.role]);
    if (p.patterns.some((a) => a.notes.some(Boolean)))
      for (const id of this.instrument.entries.keys())
        jobs.push([this.instrument, id]);
    if (kendhangUsed(p))
      for (const id of KENDHANG_STROKES)
        if (p.patterns.some((a) => a.kendhang[id].some((v) => v > 0)))
          jobs.push([this.kendhang, id]);
    if (bassUsed(p))
      for (const id of new Set(
        p.patterns.flatMap((a) =>
          a.bassNotes.filter(Boolean).map((n) => n.pitch),
        ),
      ))
        jobs.push([this.bass, id]);
    if (guitarUsed(p))
      for (const id of new Set(
        p.patterns.flatMap((a) =>
          a.guitarNotes.filter(Boolean).map((n) => n.pitch),
        ),
      ))
        jobs.push([this.guitar, id]);
    await Promise.all(
      jobs.map(async ([bank, id]) => {
        await bank.load(id, context);
        if (signal?.aborted) throw new ProjectError("cancelled");
        if (!bank.get(id).buffer) throw new ProjectError("assetFailed");
      }),
    );
  }
  loop(c) {
    return this.loops[c.variant - 1].get(c.role);
  }
  cancel() {
    for (const b of this.banks) b.cancelLoading();
  }
  dispose() {
    for (const b of this.banks) b.dispose();
  }
}
export function compositionLoop(context, mixer, banks, c, when, phase = 0) {
  const entry = banks.loop(c),
    voice = createLoopVoice(
      context,
      mixer.nodes.get("clip-" + c.role).gain,
      entry,
      { duration: 5 },
      when,
      phase,
    );
  voice.id = "clip-" + c.role;
  return voice;
}
export function compositionShot(
  context,
  mixer,
  banks,
  n,
  when,
  prior = null,
  family = "bilah",
) {
  if (prior && prior.endTime > when && prior.when <= when)
    fadeOutVoice(
      prior,
      when,
      family === "bass" ? 0.02 : family === "guitar" ? 0.01 : undefined,
    );
  const v = createOneShotVoice(
    context,
    mixer.nodes.get(family).gain,
    (family === "bilah"
      ? banks.instrument
      : family === "bass"
        ? banks.bass
        : family === "guitar"
          ? banks.guitar
          : banks.kendhang
    ).get(n.pitch),
    when,
    n.velocity,
  );
  v.id = family;
  v.pitch = n.pitch;
  return v;
}
export class CompositionPlayback {
  constructor(
    engine,
    { loopPack, instrumentPack, kendhangPack, bassPack, guitarPack },
  ) {
    this.engine = engine;
    this.project = null;
    this.mixer = null;
    this.banks = new CompositionBanks(loopPack, instrumentPack, {
      kendhangPack,
      bassPack,
      guitarPack,
      validateCandidate: (entry, metrics) =>
        engine.admitCandidate(entry, metrics),
    });
    for (const b of this.banks.banks) engine.banks.add(b);
    engine.composition = this;
  }
  configure(p, variant, force = false) {
    const previous = this.project;
    const kendhangChanged =
      !!previous &&
      JSON.stringify(previous.patterns.map((a) => a.kendhang)) !==
        JSON.stringify(p.patterns.map((a) => a.kendhang));
    if (kendhangChanged) this.engine.pause();
    const bassChanged =
      !!previous &&
      JSON.stringify(previous.patterns.map((a) => a.bassNotes)) !==
        JSON.stringify(p.patterns.map((a) => a.bassNotes));
    if (bassChanged) this.engine.pause();
    const guitarChanged =
      !!previous &&
      JSON.stringify(previous.patterns.map((a) => a.guitarNotes)) !==
        JSON.stringify(p.patterns.map((a) => a.guitarNotes));
    if (guitarChanged) this.engine.pause();
    const patterned = p.loopScope === "pattern-v1";
    const loopChange =
      previous &&
      JSON.stringify(
        patterned ? previous.patterns.map((a) => a.clips) : previous.clips,
      ) !==
        JSON.stringify(patterned ? p.patterns.map((a) => a.clips) : p.clips);
    if (
      previous &&
      ((patterned
        ? loopChange
        : JSON.stringify(
            previous.clips.map((c) => [c.role, c.variant, c.enabled]),
          ) !==
          JSON.stringify(p.clips.map((c) => [c.role, c.variant, c.enabled]))) ||
        (p.patterns.some((a) => a.notes.some(Boolean)) &&
          !previous.patterns.some((a) => a.notes.some(Boolean))))
    )
      this.engine.pause();
    const notesChanged =
      !!previous &&
      JSON.stringify(previous.patterns.map((a) => a.notes)) !==
        JSON.stringify(p.patterns.map((a) => a.notes));
    this.project = structuredClone(p);
    const sequence = patterned ? studioView(p) : mixedStudioView(p);
    // In chain mode selection belongs to the editor, not the sounding bar.
    if (
      patterned &&
      this.engine.arrangement &&
      this.engine.sequence &&
      sequence.patterns.some((a) => a.id === this.engine.sequence.activePattern)
    )
      sequence.activePattern = this.engine.sequence.activePattern;
    const mixChanged =
      patterned &&
      previous &&
      JSON.stringify([
        previous.tracks,
        previous.instrument,
        previous.kendhang,
        previous.bass,
        previous.guitar,
      ]) !==
        JSON.stringify([p.tracks, p.instrument, p.kendhang, p.bass, p.guitar]);
    this.engine.configureSequence(
      sequence,
      variant,
      force ||
        notesChanged ||
        mixChanged ||
        kendhangChanged ||
        bassChanged ||
        guitarChanged,
    );
    if (patterned && this.context)
      this.applyPatternMix(
        Math.floor(this.engine.transport.beatsAt(this.context.currentTime) * 4),
        this.context.currentTime,
      );
    else this.mixer?.update(p);
  }
  async load(context) {
    if (this.context !== context) {
      this.mixer?.dispose();
      this.context = context;
      this.mixer = createCompositionMixer(
        context,
        this.engine.master,
        this.project,
      );
      this.mixer.update(this.project, true);
    }
    await this.banks.load(this.project, context);
  }
  own(v, type, detail = {}) {
    const e = this.engine;
    e.voices.add(v);
    ++e.stats.created;
    v.source.onended = () => e.removeVoice(v);
    e.record(type, { id: v.id, when: v.when, ...detail });
    return v;
  }
  start(when) {
    this.bassChokes = [];
    this.guitarChokes = [];
    if (this.project.loopScope === "pattern-v1") {
      this.loopState = new Map();
      this.loopTransitions = [];
      this.lastLoopBar = null;
      this.patternBoundary(
        Math.floor(this.engine.transport.position * 4),
        when,
        true,
      );
      return;
    }
    for (const c of this.project.clips.filter((c) => c.enabled))
      this.own(
        compositionLoop(
          this.context,
          this.mixer,
          this.banks,
          c,
          when,
          this.engine.transport.phaseSeconds(when, 2),
        ),
        "clip",
        { variant: c.variant },
      );
  }
  step(index, when) {
    if (
      this.project.loopScope === "pattern-v1" &&
      this.lastLoopBar !== Math.floor(index / 16)
    )
      this.patternBoundary(index, when);
    const pattern = this.project.patterns.find(
      (p) =>
        p.id ===
        compositionPatternId(this.project, index, this.engine.arrangement),
    );
    if (this.project.kendhang)
      for (const id of KENDHANG_STROKES) {
        const velocity = pattern.kendhang[id][index % 16];
        if (!velocity || this.engine.voices.size >= 64) continue;
        const prior = [...this.engine.voices]
          .filter(
            (v) => v.id === "kendhang" && v.pitch === id && v.when <= when,
          )
          .sort((a, b) => b.when - a.when)[0];
        this.own(
          compositionShot(
            this.context,
            this.mixer,
            this.banks,
            { pitch: id, velocity },
            when,
            prior,
            "kendhang",
          ),
          "kendhang",
          { index, pitch: id, velocity },
        );
      }
    const n = compositionNote(this.project, index, this.engine.arrangement);
    const bassNote = this.project.bass ? pattern.bassNotes[index % 16] : null;
    if (bassNote && this.engine.voices.size < 64)
      this.bassShot(bassNote, when, { index });
    const guitarNote = this.project.guitar
      ? pattern.guitarNotes[index % 16]
      : null;
    if (guitarNote && this.engine.voices.size < 64)
      this.guitarShot(guitarNote, when, { index });
    if (!n || this.engine.voices.size >= 64) return;
    const prior = [...this.engine.voices]
      .filter((v) => v.id === "bilah" && v.when <= when)
      .sort((a, b) => b.when - a.when)[0];
    this.own(
      compositionShot(this.context, this.mixer, this.banks, n, when, prior),
      "note",
      { index, pitch: n.pitch, velocity: n.velocity },
    );
  }
  bassShot(n, when, detail = {}) {
    const prior = [...this.engine.voices]
        .reverse()
        .filter((v) => v.id === "bass" && v.when <= when)
        .sort((a, b) => b.when - a.when)[0],
      priorEnd = prior?.endTime;
    const v = compositionShot(
      this.context,
      this.mixer,
      this.banks,
      n,
      when,
      prior,
      "bass",
    );
    this.bassChokes = (this.bassChokes ?? []).filter(
      (t) => t.when > this.context.currentTime,
    );
    if (prior && priorEnd > when && when > this.context.currentTime)
      this.bassChokes.push({ when, prior, priorEnd });
    return this.own(v, "bass", {
      pitch: n.pitch,
      velocity: n.velocity,
      ...detail,
    });
  }
  guitarShot(n, when, detail = {}) {
    const prior = [...this.engine.voices]
        .reverse()
        .filter(
          (v) => v.id === "guitar" && v.pitch === n.pitch && v.when <= when,
        )
        .sort((a, b) => b.when - a.when)[0],
      priorEnd = prior?.endTime;
    const v = compositionShot(
      this.context,
      this.mixer,
      this.banks,
      n,
      when,
      prior,
      "guitar",
    );
    this.guitarChokes = (this.guitarChokes ?? []).filter(
      (t) => t.when > this.context.currentTime,
    );
    if (prior && priorEnd > when && when > this.context.currentTime)
      this.guitarChokes.push({ when, prior, priorEnd });
    return this.own(v, "guitar", {
      pitch: n.pitch,
      velocity: n.velocity,
      ...detail,
    });
  }
  applyPatternMix(index, when, immediate = false) {
    const id = compositionPatternId(
      this.project,
      index,
      this.engine.arrangement,
    );
    this.mixer?.update(this.project, immediate, when, id);
    this.engine.mixer?.update(
      mixedStudioView(this.project, id).tracks,
      when,
      immediate,
    );
  }
  patternBoundary(index, when, initial = false) {
    const patternId = compositionPatternId(
      this.project,
      index,
      this.engine.arrangement,
    );
    const clips = patternClips(this.project, patternId);
    const joins = clips.filter(
      (c) => c.enabled && this.loopState?.get(c.role)?.variant !== c.variant,
    ).length;
    if (this.engine.voices.size + joins > 64) {
      this.engine.pause();
      this.engine.error = "audio-start: pattern-loop-voice-limit";
      return;
    }
    this.applyPatternMix(index, when, initial);
    this.lastLoopBar = Math.floor(index / 16);
    this.loopTransitions ??= [];
    this.loopTransitions = this.loopTransitions.filter(
      (t) => t.when > this.context.currentTime,
    );
    const prior = this.loopState ?? new Map(),
      id = compositionPatternId(this.project, index, this.engine.arrangement);
    const result = transitionPatternLoops(
      prior,
      patternClips(this.project, id),
      (c) =>
        this.own(
          compositionLoop(
            this.context,
            this.mixer,
            this.banks,
            c,
            when,
            this.engine.transport.phaseSeconds(when, 2),
          ),
          "pattern-clip",
          { index, patternId: id, variant: c.variant },
        ),
      (v) => fadeOutVoice(v, when),
    );
    this.loopState = result.next;
    this.loopTransitions.push({ when, prior, ...result });
  }
  cancelScheduled(when) {
    for (const t of [...(this.bassChokes ?? [])].reverse())
      if (
        t.when > when &&
        t.prior.when <= when &&
        this.engine.voices.has(t.prior) &&
        t.priorEnd > when
      ) {
        cancelFade(t.prior, when);
        t.prior.endTime = t.priorEnd;
      }
    for (const t of [...(this.guitarChokes ?? [])].reverse())
      if (
        t.when > when &&
        t.prior.when <= when &&
        this.engine.voices.has(t.prior) &&
        t.priorEnd > when
      ) {
        cancelFade(t.prior, when);
        t.prior.endTime = t.priorEnd;
      }
    this.bassChokes = [];
    this.guitarChokes = [];
    if (this.project?.loopScope !== "pattern-v1") return;
    for (const t of [...(this.loopTransitions ?? [])].reverse())
      if (t.when > when) {
        for (const v of t.started) this.engine.removeVoice(v);
        for (const v of t.ended)
          if (this.engine.voices.has(v)) cancelFade(v, when);
        this.loopState = t.prior;
      }
    this.loopTransitions = [];
    this.lastLoopBar = null;
    this.mixer?.cancelFrom(when);
    this.engine.mixer?.cancelFrom(when);
    this.applyPatternMix(
      Math.floor(this.engine.transport.beatsAt(when) * 4),
      when,
    );
  }
  async pad(pitch, family = "bilah") {
    if (
      (family !== "bilah" &&
        family !== "kendhang" &&
        family !== "bass" &&
        family !== "guitar") ||
      (family === "kendhang" && !KENDHANG_STROKES.includes(pitch)) ||
      (family === "bass" && !BASS_PITCHES.includes(pitch)) ||
      (family === "guitar" && !GUITAR_PITCHES.includes(pitch))
    )
      throw new Error("Unknown pad");
    const e = this.engine;
    if (e.disposed) return;
    const context = e.ensureContext(),
      operation = e.operation;
    if (context.state !== "running") {
      try {
        await context.resume();
      } catch (error) {
        if (e.disposed || operation !== e.operation || context !== e.context)
          return;
        throw error;
      }
    }
    // An obsolete resume must not allocate a mixer or start a new bank load.
    if (
      e.disposed ||
      operation !== e.operation ||
      context !== e.context ||
      context.state !== "running"
    )
      return;
    if (!this.mixer || this.context !== context) {
      this.mixer?.dispose();
      this.context = context;
      this.mixer = createCompositionMixer(context, e.master, this.project);
      this.mixer.update(this.project, true);
    }
    const bank =
      family === "bilah"
        ? this.banks.instrument
        : family === "bass"
          ? this.banks.bass
          : family === "guitar"
            ? this.banks.guitar
            : this.banks.kendhang;
    const entry = bank.get(pitch);
    if (!entry.buffer) await bank.load(pitch, context);
    if (
      e.disposed ||
      operation !== e.operation ||
      context !== e.context ||
      context.state !== "running"
    )
      return;
    if (!entry.buffer) {
      e.error = "asset-failed";
      return;
    }
    let when = context.currentTime + 0.005;
    if (e.transport.running && this.project.timing.quantize) {
      const index = e.nextSequenceStep(context.currentTime, 0.005);
      when = e.transport.timeAt(
        index / 4 + (index % 2 ? this.project.timing.swing / 4 : 0),
      );
    }
    if (family === "bass") {
      if (e.voices.size < 64)
        this.bassShot({ pitch, velocity: 1 }, when, { pad: true });
      return;
    }
    if (family === "guitar") {
      if (e.voices.size < 64)
        this.guitarShot({ pitch, velocity: 1 }, when, { pad: true });
      return;
    }
    if (e.voices.size < 64)
      this.own(
        compositionShot(
          context,
          this.mixer,
          this.banks,
          { pitch, velocity: 1 },
          when,
          family === "kendhang"
            ? [...e.voices]
                .filter(
                  (v) => v.id === family && v.pitch === pitch && v.when <= when,
                )
                .sort((a, b) => b.when - a.when)[0]
            : null,
          family,
        ),
        "note-pad",
        { pitch },
      );
  }
  dispose() {
    this.mixer?.dispose();
    this.mixer = null;
    this.bassChokes = [];
    this.guitarChokes = [];
    this.banks.dispose();
  }
}
export function compositionExportExtras({
  loopPack,
  instrumentPack,
  kendhangPack,
  bassPack,
  guitarPack,
}) {
  return {
    credits(p) {
      return (
        [
          kendhangUsed(p) ? KENDHANG_CREDITS : null,
          bassUsed(p) ? BASS_CREDITS : null,
          guitarUsed(p) ? GUITAR_CREDITS : null,
        ]
          .filter(Boolean)
          .join("\n\n") || null
      );
    },
    budget(p) {
      if (p.schemaVersion !== 3) return { decode: 0, audible: false };
      const audible = p.chain.some((id) => {
        const mix = allMix(p, id),
          pattern = p.patterns.find((a) => a.id === id);
        return (
          patternClips(p, id).some(
            (c) => c.enabled && !c.mute && trackGain(c, mix) > 0,
          ) ||
          (p.bass &&
            trackGain({ ...p.bass, role: "bass" }, mix) > 0 &&
            pattern.bassNotes.some(Boolean)) ||
          (p.guitar &&
            trackGain({ ...p.guitar, role: "guitar" }, mix) > 0 &&
            pattern.guitarNotes.some(Boolean)) ||
          (p.kendhang &&
            trackGain({ ...p.kendhang, role: "kendhang" }, mix) > 0 &&
            KENDHANG_STROKES.some((id) =>
              pattern.kendhang[id].some((v) => v > 0),
            )) ||
          (trackGain(
            mix.find((t) => t.role === "bilah"),
            mix,
          ) > 0 &&
            pattern.notes.some(Boolean))
        );
      });
      const decode =
        new Set(
          compositionClips(p)
            .filter((c) => c.enabled)
            .map((c) => c.role + "/" + c.variant),
        ).size *
          240000 *
          4 +
        (p.patterns.some((a) => a.notes.some(Boolean)) ? 5 * 67200 * 4 : 0) +
        (kendhangUsed(p) ? (42780 + 32821) * 2 * 4 : 0) +
        (bassUsed(p)
          ? new Set(
              p.patterns.flatMap((a) =>
                a.bassNotes.filter(Boolean).map((n) => n.pitch),
              ),
            ).size *
            57600 *
            4
          : 0) +
        (guitarUsed(p)
          ? new Set(
              p.patterns.flatMap((a) =>
                a.guitarNotes.filter(Boolean).map((n) => n.pitch),
              ),
            ).size *
            86400 *
            4
          : 0);
      return { decode, audible };
    },
    async prepare(context, p, signal) {
      if (p.schemaVersion !== 3) return null;
      const banks = new CompositionBanks(loopPack, instrumentPack, {
        kendhangPack,
        bassPack,
        guitarPack,
      });
      const cancel = () => banks.cancel();
      signal.addEventListener("abort", cancel);
      try {
        await banks.load(p, context, signal);
        return { banks, signal, cancel };
      } catch (e) {
        banks.dispose();
        signal.removeEventListener("abort", cancel);
        throw e;
      }
    },
    schedule(context, master, p, extras, voices, drumMixer) {
      if (!extras) return;
      const mixer = createCompositionMixer(context, master, p);
      mixer.update(p, true, 0, compositionPatternId(p, 0));
      extras.mixer = mixer;
      if (p.loopScope !== "pattern-v1")
        for (const c of p.clips.filter((c) => c.enabled))
          voices.push(compositionLoop(context, mixer, extras.banks, c, 0));
      let loopState = new Map();
      let prior;
      let priorBass;
      const priorGuitar = new Map();
      const kendhangPrior = new Map();
      for (let i = 0; i < p.chain.length * 16; i++) {
        if (p.loopScope === "pattern-v1" && i % 16 === 0) {
          const id = compositionPatternId(p, i),
            when = stepTime(i, p.timing.bpm, p.timing.swing);
          mixer.update(p, i === 0, when, id);
          drumMixer?.update(mixedStudioView(p, id).tracks, when, i === 0);
          const result = transitionPatternLoops(
            loopState,
            patternClips(p, id),
            (c) => {
              const v = compositionLoop(
                context,
                mixer,
                extras.banks,
                c,
                when,
                (((i / 4) * 60) / p.timing.bpm) % 5,
              );
              voices.push(v);
              return v;
            },
            (v) => fadeOutVoice(v, when),
          );
          loopState = result.next;
        }
        const n = compositionNote(p, i);
        const pattern = p.patterns.find(
          (a) => a.id === compositionPatternId(p, i),
        );
        if (p.kendhang)
          for (const id of KENDHANG_STROKES) {
            const velocity = pattern.kendhang[id][i % 16];
            if (!velocity) continue;
            const v = compositionShot(
              context,
              mixer,
              extras.banks,
              { pitch: id, velocity },
              stepTime(i, p.timing.bpm, p.timing.swing),
              kendhangPrior.get(id),
              "kendhang",
            );
            voices.push(v);
            kendhangPrior.set(id, v);
          }
        const bassNote = p.bass ? pattern.bassNotes[i % 16] : null;
        if (bassNote) {
          const b = compositionShot(
            context,
            mixer,
            extras.banks,
            bassNote,
            stepTime(i, p.timing.bpm, p.timing.swing),
            priorBass,
            "bass",
          );
          voices.push(b);
          priorBass = b;
        }
        const guitarNote = p.guitar ? pattern.guitarNotes[i % 16] : null;
        if (guitarNote) {
          const b = compositionShot(
            context,
            mixer,
            extras.banks,
            guitarNote,
            stepTime(i, p.timing.bpm, p.timing.swing),
            priorGuitar.get(guitarNote.pitch),
            "guitar",
          );
          voices.push(b);
          priorGuitar.set(guitarNote.pitch, b);
        }
        if (!n) continue;
        const v = compositionShot(
          context,
          mixer,
          extras.banks,
          n,
          stepTime(i, p.timing.bpm, p.timing.swing),
          prior,
        );
        voices.push(v);
        prior = v;
      }
    },
    dispose(extras) {
      if (!extras) return;
      extras.signal.removeEventListener("abort", extras.cancel);
      extras.mixer?.dispose();
      extras.banks.dispose();
    },
  };
}
