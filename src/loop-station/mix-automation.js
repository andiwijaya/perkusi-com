import { fail } from "../project/instrument-contract.js";

export const MIX_LEAD_SECONDS = 0.05;
export const MIX_RAMP_SECONDS = 0.02;
export const MIX_GRACE_FRAMES = 128;

// Exclusive owner of the mixer parameters' constant/linear segments. Native
// AudioParam.value is not an authoritative query for a pending/current ramp.
export class MixAutomation {
  constructor() {
    this.clear();
  }
  clear() {
    this.segments = new WeakMap();
  }
  set(param, target, now, instant) {
    this.checkParam(param, now);
    const old = this.segments.get(param),
      held = !old
        ? target
        : now >= old.end
          ? old.to
          : old.from +
            ((old.to - old.from) * (now - old.start)) / (old.end - old.start);
    // Seed intrinsic AND scheduled values at graph initialization. Chromium
    // can otherwise report the constructor value before rendering starts.
    if (!old) param.value = target;
    param.cancelScheduledValues(now);
    // Removing the old ramp endpoint also removes its incoming slope. Restore
    // the truncated ramp before anchoring its held value and the replacement.
    if (old && now > 0 && old.start <= now && now <= old.end)
      param.linearRampToValueAtTime(held, now);
    param.setValueAtTime(instant ? target : held, now);
    const end = instant ? now : now + MIX_RAMP_SECONDS;
    if (!instant) param.linearRampToValueAtTime(target, end);
    this.segments.set(param, {
      start: now,
      end,
      from: instant ? target : held,
      to: target,
    });
  }
  checkParam(param, when) {
    const old = this.segments.get(param);
    if (!Number.isFinite(when) || when < 0 || (old && when < old.start))
      fail("mixProgramLate");
  }
  check(graphs, master, when) {
    for (const g of graphs.values()) {
      this.checkParam(g.gain.gain, when);
      this.checkParam(g.pan.pan, when);
    }
    if (master) this.checkParam(master.gain, when);
  }
  apply(project, graphs, master, now, instant = false) {
    // Preflight the entire graph before the first native parameter mutation.
    this.check(graphs, master, now);
    const solo = project.tracks.some((t) => t.solo);
    for (const t of project.tracks) {
      const g = graphs.get(t.id);
      if (!g) continue;
      this.set(
        g.gain.gain,
        t.mute || (solo && !t.solo) ? 0 : t.gain,
        now,
        instant,
      );
      this.set(g.pan.pan, t.pan, now, instant);
    }
    if (master) this.set(master.gain, project.master.volume, now, instant);
  }
}
