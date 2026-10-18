export function secondsPerBeat(bpm) {
  if (!Number.isFinite(bpm) || bpm < 60 || bpm > 180)
    throw new RangeError("Tempo outside 60–180 BPM");
  return 60 / bpm;
}

// All positions derive from an absolute audio-clock origin, never tick counts.
export class Transport {
  constructor({ bpm = 96, beatsPerBar = 4 } = {}) {
    this.beatSeconds = secondsPerBeat(bpm);
    if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > 16)
      throw new RangeError("Invalid meter");
    this.beatsPerBar = beatsPerBar;
    this.running = false;
    this.position = 0;
    this.origin = 0;
  }
  beatsAt(time) {
    return this.running
      ? Math.max(0, (time - this.origin) / this.beatSeconds)
      : this.position;
  }
  timeAt(beat) {
    return this.origin + beat * this.beatSeconds;
  }
  start(time) {
    this.origin = time - this.position * this.beatSeconds;
    this.running = true;
  }
  pause(time) {
    this.position = this.beatsAt(time);
    this.running = false;
  }
  reset() {
    this.running = false;
    this.position = 0;
    this.origin = 0;
  }
  nextBar(time, minimumLead = 0.015) {
    const beat = this.beatsAt(time + minimumLead);
    const bar = Math.floor(beat / this.beatsPerBar + 1e-10) + 1;
    return this.timeAt(bar * this.beatsPerBar);
  }
  phaseSeconds(time, bars) {
    const duration = bars * this.beatsPerBar * this.beatSeconds;
    return (
      (((this.beatsAt(time) * this.beatSeconds) % duration) + duration) %
      duration
    );
  }
}
