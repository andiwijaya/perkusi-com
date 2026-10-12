import { SampleBank } from "./sample-bank.js";
import { prepareBumiBuffer } from "../beatbox/bumi-presence.js";
import { createLoopVoice, createOneShotVoice, fadeOutVoice } from "./voice.js";
import {
  CLIP_ROLES,
  allMix,
  mixedStudioView,
} from "../project/composition-model.js";
import { trackGain, stepTime } from "./sequencing.js";
import { ProjectError } from "../project/schema.js";

// All loops occupy the full arrangement, at their original 96 BPM. Their native
// two-bar phase continues across pattern boundaries. No time stretch or repitch.
export function compositionNote(project, index, arrangement = true) {
  const id = arrangement
    ? project.chain[Math.floor(index / 16) % project.chain.length]
    : project.activePattern;
  return project.patterns.find((p) => p.id === id).notes[index % 16];
}
export function createCompositionMixer(context, master, project) {
  const nodes = new Map();
  for (const role of [...CLIP_ROLES.map((role) => "clip-" + role), "bilah"]) {
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
    update(p, immediate = false) {
      const tracks = allMix(p);
      for (const t of tracks) {
        const n = nodes.get(t.role);
        if (!n) continue;
        const set = (param, value) =>
          immediate
            ? (param.value = value)
            : param.setTargetAtTime(value, context.currentTime, 0.004);
        set(n.gain.gain, trackGain(t, tracks));
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
    this.banks = [...this.loops, this.instrument];
  }
  async load(p, context, signal) {
    const jobs = p.clips
      .filter((c) => c.enabled)
      .map((c) => [this.loops[c.variant - 1], c.role]);
    if (p.patterns.some((a) => a.notes.some(Boolean)))
      for (const id of this.instrument.entries.keys())
        jobs.push([this.instrument, id]);
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
export function compositionShot(context, mixer, banks, n, when, prior = null) {
  if (prior && prior.endTime > when && prior.when <= when)
    fadeOutVoice(prior, when);
  const v = createOneShotVoice(
    context,
    mixer.nodes.get("bilah").gain,
    banks.instrument.get(n.pitch),
    when,
    n.velocity,
  );
  v.id = "bilah";
  v.pitch = n.pitch;
  return v;
}
export class CompositionPlayback {
  constructor(engine, { loopPack, instrumentPack }) {
    this.engine = engine;
    this.project = null;
    this.mixer = null;
    this.banks = new CompositionBanks(loopPack, instrumentPack, {
      validateCandidate: (entry, metrics) =>
        engine.admitCandidate(entry, metrics),
    });
    for (const b of this.banks.banks) engine.banks.add(b);
    engine.composition = this;
  }
  configure(p, variant, force = false) {
    const previous = this.project;
    if (
      previous &&
      (JSON.stringify(
        previous.clips.map((c) => [c.role, c.variant, c.enabled]),
      ) !==
        JSON.stringify(p.clips.map((c) => [c.role, c.variant, c.enabled])) ||
        (p.patterns.some((a) => a.notes.some(Boolean)) &&
          !previous.patterns.some((a) => a.notes.some(Boolean))))
    )
      this.engine.pause();
    const notesChanged =
      !!previous &&
      JSON.stringify(previous.patterns.map((a) => a.notes)) !==
        JSON.stringify(p.patterns.map((a) => a.notes));
    this.project = structuredClone(p);
    this.engine.configureSequence(
      mixedStudioView(p),
      variant,
      force || notesChanged,
    );
    this.mixer?.update(p);
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
    const n = compositionNote(this.project, index, this.engine.arrangement);
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
  async pad(pitch) {
    const e = this.engine;
    if (e.disposed) return;
    const context = e.ensureContext(),
      operation = e.operation;
    if (context.state !== "running") await context.resume();
    if (!this.mixer || this.context !== context) {
      this.mixer?.dispose();
      this.context = context;
      this.mixer = createCompositionMixer(context, e.master, this.project);
      this.mixer.update(this.project, true);
    }
    const entry = this.banks.instrument.get(pitch);
    if (!entry.buffer) await this.banks.instrument.load(pitch, context);
    if (e.disposed || operation !== e.operation || context.state !== "running")
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
    if (e.voices.size < 64)
      this.own(
        compositionShot(
          context,
          this.mixer,
          this.banks,
          { pitch, velocity: 1 },
          when,
        ),
        "note-pad",
        { pitch },
      );
  }
  dispose() {
    this.mixer?.dispose();
    this.mixer = null;
    this.banks.dispose();
  }
}
export function compositionExportExtras({ loopPack, instrumentPack }) {
  return {
    budget(p) {
      if (p.schemaVersion !== 3) return { decode: 0, audible: false };
      const mix = allMix(p),
        i = mix.find((t) => t.role === "bilah");
      const audible =
        p.clips.some(
          (c) =>
            c.enabled &&
            trackGain(
              mix.find((t) => t.role === "clip-" + c.role),
              mix,
            ) > 0,
        ) ||
        (trackGain(i, mix) > 0 &&
          p.patterns.some(
            (a) => p.chain.includes(a.id) && a.notes.some(Boolean),
          ));
      const decode =
        p.clips.filter((c) => c.enabled).length * 240000 * 4 +
        (p.patterns.some((a) => a.notes.some(Boolean)) ? 5 * 67200 * 4 : 0);
      return { decode, audible };
    },
    async prepare(context, p, signal) {
      if (p.schemaVersion !== 3) return null;
      const banks = new CompositionBanks(loopPack, instrumentPack);
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
    schedule(context, master, p, extras, voices) {
      if (!extras) return;
      const mixer = createCompositionMixer(context, master, p);
      mixer.update(p, true);
      extras.mixer = mixer;
      for (const c of p.clips.filter((c) => c.enabled))
        voices.push(compositionLoop(context, mixer, extras.banks, c, 0));
      let prior;
      for (let i = 0; i < p.chain.length * 16; i++) {
        const n = compositionNote(p, i);
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
