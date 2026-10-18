import { SessionTakes, liveAssignment } from "./session-takes.js";
import { fail } from "../project/instrument-contract.js";
import { overdubBase, admitOverdubBytes } from "./overdub.js";
import { recordSource } from "./record-sources.js";
import { melodicBank } from "./melodic-sources.js";
import { micAssignment } from "./mic-source.js";

export class SelectedRecorder {
  constructor(owner) {
    this.owner = owner;
    this.takes = owner.takeStore ??= new SessionTakes(owner);
    this.current = null;
    this.assignment = null;
    this.source = null;
    this.busy = false;
    this.overdub = false;
    this.base = null;
  }
  async prepare(
    trackId,
    { overdub = false, instrumentId = "saron-barung" } = {},
  ) {
    if (this.busy) fail("recordBusy");
    this.busy = true;
    try {
      if (
        (this.owner.capture?.snapshot().retained.length ?? 0) ||
        this.owner.claims.size
      )
        fail("captureTakeNeedsReview");
      const c = this.owner.controller;
      if (
        instrumentId !== "microphone" &&
        c.context.sampleRate !== 48000 &&
        !melodicBank(instrumentId, c.context.sampleRate)
      )
        fail("takeRateMismatch");
      if (typeof overdub !== "boolean") fail("invalidCaptureSource");
      const base = overdub ? overdubBase(c.project, trackId) : null;
      if (base) admitOverdubBytes(c.project, base);
      if (
        base &&
        instrumentId !== "microphone" &&
        (base.channels !== 2 || base.sampleRate !== 48000)
      )
        fail("takeRateMismatch");
      if (instrumentId === "microphone") {
        await this.owner.stopMic();
        await this.owner.closeProducers();
        this.assignment = micAssignment(trackId);
        this.source = null;
        this.overdub = overdub;
        this.base = base;
        this.current = null;
        this.cancelled = false;
        return this.assignment;
      }
      const profile = recordSource(instrumentId),
        assignment = liveAssignment(
          trackId,
          c.registry,
          profile.bankId,
          profile.bankVersion,
          profile.sampleIds,
        );
      const source = await this.owner.assignInstrument(trackId, {
        ...assignment,
        overdub,
      });
      this.assignment = assignment;
      this.source = source;
      this.overdub = overdub;
      this.base = base;
      this.current = null;
      this.cancelled = false;
      return assignment;
    } finally {
      this.busy = false;
    }
  }
  arm({ bars = 2, countInBars = 1 } = {}) {
    if (
      this.busy ||
      !this.source ||
      !this.owner.producers.has(this.assignment.trackId)
    )
      fail("instrumentNotReady");
    if (
      this.owner.capture.snapshot().retained.length ||
      this.owner.claims.size ||
      this.owner.playbacks.size
    )
      fail("captureTakeNeedsReview");
    this.cancelled = false;
    if (
      this.overdub &&
      (bars !== this.base.bars ||
        JSON.stringify(
          overdubBase(this.owner.controller.project, this.assignment.trackId),
        ) !== JSON.stringify(this.base))
    )
      fail("overdubGeometryMismatch");
    if (this.overdub && this.source.channels !== this.base.channels)
      fail("overdubGeometryMismatch");
    this.current = this.owner[
      this.assignment.format === "perkusi-mic-assignment"
        ? "armMic"
        : "armInstrument"
    ]({
      source: this.source,
      bars,
      countInBars,
      gain: 1,
      alignBars: this.overdub ? this.base.bars : 1,
    });
    void this.current.ready.catch(() => {});
    void this.current.prepared.catch(() => {});
    return this.current;
  }
  async enableMic() {
    if (this.busy || this.assignment?.format !== "perkusi-mic-assignment")
      fail("micNotReady");
    const assignment = this.assignment;
    const source = await this.owner.enableMic(assignment.trackId);
    if (assignment === this.assignment) this.source = source;
    return source;
  }
  stop() {
    // Adoption unloads prepared playback after closing capture/producers. The
    // retained session library must still be discardable before the next Play.
    if (this.owner.controller && !this.owner.controller.project)
      return this.owner.stopSaved(this.assignment?.trackId);
    return this.assignment
      ? this.owner.stopTrack(this.assignment.trackId)
      : Promise.resolve();
  }
  async cancel() {
    this.cancelled = true;
    await this.stop();
  }
  save() {
    if (this.busy) fail("recordBusy");
    if (!this.current?.take) fail("captureTakeHeld");
    return this.takes.save(
      this.current.take.id,
      this.assignment.trackId,
      this.assignment,
    );
  }
  discardCurrent() {
    return this.discard(false);
  }
  discardAll() {
    return this.discard(true);
  }
  async discard(all) {
    if (this.busy) fail("recordBusy");
    this.busy = true;
    const current = this.current;
    try {
      await this.stop();
      const id = current?.take?.id;
      if (id && this.owner.capture?.retained.has(id))
        this.owner.releaseTake(id);
      if (this.current === current) this.current = null;
      if (all) await this.takes.discard();
    } finally {
      this.busy = false;
    }
  }
  playSaved() {
    if (this.busy) fail("recordBusy");
    const id = this.takes.layers(this.assignment.trackId).at(-1);
    if (!id) fail("unknownTake");
    return this.owner.playSaved(id, this.assignment.trackId);
  }
  snapshot() {
    const h = this.current,
      c = this.owner.engine?.context,
      frame = (c?.currentTime ?? 0) * (c?.sampleRate ?? 48000);
    let state =
      this.source && this.owner.producers.has(this.assignment.trackId)
        ? "ready"
        : "idle";
    if (this.busy) state = "preparing";
    else if (h && h.state !== "closed")
      state = ["preparing", "armed"].includes(h.state)
        ? frame < h.plan.countInFrame
          ? "armed"
          : frame < h.plan.startFrame
            ? "counting"
            : "recording"
        : h.state;
    else if (h?.take)
      state = h.take.partial
        ? "partial"
        : this.takes.saved.has(h.take.id)
          ? "saved"
          : "stopped";
    else if (this.cancelled) state = "cancelled";
    if (h?.take?.partial) state = "partial";
    else if (this.owner.lastFault || h?.inputOutcome || h?.playbackOutcome)
      state = "error";
    return {
      state,
      frame,
      assignment: this.assignment,
      plan: h?.plan ?? null,
      handleState: h?.state ?? null,
      take: h?.take ?? null,
      inputOutcome: h?.inputOutcome ?? null,
      playbackOutcome: h?.playbackOutcome ?? null,
      outcome: h?.outcome ?? null,
      count: h
        ? Math.max(
            0,
            Math.ceil(((h.plan.startFrame - frame) / h.plan.framesPerBar) * 4),
          )
        : 0,
      pendingTake: !!h?.take && !!this.owner.capture?.retained.has(h.take.id),
      saved: this.takes.snapshot(),
      producer: this.source?.snapshot() ?? null,
      monitoring: this.source?.monitoring ?? "disabled",
      memoryOnly: true,
      playingSaved: this.owner.playbacks.size > 0,
      overdub: this.overdub,
      base: this.base,
    };
  }
}
