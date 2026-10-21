import { eqGains, hasEQ, limiterEnabled, softLimit } from "./fx-model.js";
import { fail } from "../project/instrument-contract.js";

// Shared native graph for live monitor/replay and offline final mix. The two
// first-order crossover poles have no feedback path outside their stable IIR.
export function buildMixGraph(
  context,
  project,
  memory,
  output,
  { connectOutput = true } = {},
) {
  const graphs = new Map(),
    leases = [],
    nodes = [];
  let anchor;
  const reserve = (bytes, name) => {
    const lease = memory.reserve(bytes, name);
    leases.push(lease);
    return lease;
  };
  const keep = (n) => {
    nodes.push(n);
    return n;
  };
  const release = () => {
    if (anchor) {
      try {
        anchor.stop();
      } catch {
        /* Closed native context. */
      }
      anchor = null;
    }
    for (const n of nodes) n.disconnect();
    nodes.length = 0;
    for (const l of leases) l.release();
    leases.length = 0;
    graphs.clear();
  };
  try {
    const masterLease = reserve(4096, "loop-master-node"),
      master = keep(context.createGain());
    if (project.tracks.some((t) => hasEQ(t.eq))) {
      // A zero-valued active input preserves native IIR state when the final
      // musical source ends exactly on a render quantum. It adds no signal.
      reserve(8192, "loop-EQ-silent-input-anchor");
      if (!context.createConstantSource) fail("loopFXUnavailable");
      anchor = keep(context.createConstantSource());
      anchor.offset.value = 0;
      anchor.start(context.currentTime);
    }
    master.gain.value = project.master.volume;
    let final = master;
    if (limiterEnabled(project.master)) {
      reserve(2 * 65537 * 4 + 8192, "loop-soft-limiter-curve/native");
      if (!context.createWaveShaper) fail("loopFXUnavailable");
      const limiter = keep(context.createWaveShaper()),
        curve = new Float32Array(65537);
      for (let i = 0; i < curve.length; i++)
        curve[i] = softLimit(i / 32768 - 1);
      limiter.curve = curve;
      limiter.oversample = "none";
      master.connect(limiter);
      final = limiter;
    }
    if (connectOutput) final.connect(output);
    const anySolo = project.tracks.some((t) => t.solo);
    for (const track of project.tracks) {
      const lease = reserve(8192, "loop-track-gain-pan"),
        gain = keep(context.createGain()),
        pan = keep(context.createStereoPanner());
      gain.channelCount = 2;
      gain.channelCountMode = "explicit";
      gain.gain.value = track.mute || (anySolo && !track.solo) ? 0 : track.gain;
      pan.pan.value = track.pan;
      if (hasEQ(track.eq)) {
        anchor.connect(gain);
        reserve(32768, "loop-three-band-EQ/nodes-and-state");
        if (!context.createIIRFilter) fail("loopFXUnavailable");
        const g = eqGains(track.eq),
          sum = keep(context.createGain());
        sum.gain.value = 1;
        const dry = keep(context.createGain());
        dry.gain.value = g.high;
        gain.connect(dry);
        dry.connect(sum);
        for (const [frequency, level] of [
          [3000, g.upper],
          [200, g.lower],
        ]) {
          const pole = Math.exp(
              (-2 * Math.PI * frequency) / context.sampleRate,
            ),
            filter = keep(context.createIIRFilter([1 - pole], [1, -pole])),
            trim = keep(context.createGain());
          trim.gain.value = level;
          gain.connect(filter);
          filter.connect(trim);
          trim.connect(sum);
        }
        sum.connect(pan);
      } else gain.connect(pan);
      pan.connect(master);
      graphs.set(track.id, { gain, pan, lease });
    }
    return { master, graphs, masterLease, final, release };
  } catch (e) {
    release();
    throw e;
  }
}
