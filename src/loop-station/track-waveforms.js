import { mergeWaveform, waveformPath } from "./waveform.js";
import { recordCopy } from "./record-copy.js";
import { phaseAdvance } from "./phase-alignment.js";

export const waveformCopy = {
  id: {
    source: "Rekaman asli",
    session: "Take sesi / rekaman berjalan",
    hint: "Envelope PCM asli sebelum posisi/mixer/FX; gabungan rentang kanal, skala ±1. Bagian yang belum diterima tetap kosong.",
    waiting: "Menunggu PCM diterima",
    unavailable: "Waveform belum tersedia",
    retry: "Coba waveform lagi",
    frames: "frame diterima",
    peak: "puncak asli",
    outside: "Puncak di luar skala gambar; PCM tidak diubah",
    partial: "Parsial",
  },
  en: {
    source: "Original recording",
    session: "Session take / live capture",
    hint: "Original PCM envelope before position/mixer/FX; combined channel range, scale ±1. Unreceived audio stays blank.",
    waiting: "Waiting for received PCM",
    unavailable: "Waveform unavailable",
    retry: "Retry waveform",
    frames: "frames received",
    peak: "original peak",
    outside: "Peak exceeds display scale; PCM unchanged",
    partial: "Partial",
  },
};
const VIEW_BYTES = 16384;
export const waveformSourceKey = (ref) =>
  [ref.sha256, ref.sampleRate, ref.channels, ref.frames, ref.encoding].join(
    ":",
  );

export class TrackWaveforms {
  constructor({ documentStore, memory }) {
    Object.assign(this, { documentStore, memory });
    this.cache = new Map();
    this.live = new Map();
    this.views = [];
    this.queue = Promise.resolve();
    this.closed = false;
    this.reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  }
  begin(project) {
    if (this.closed) return;
    this.views = [];
    const wanted = new Set(project.assetRefs.map(waveformSourceKey));
    for (const [key, entry] of this.cache)
      if (!wanted.has(key)) {
        entry.abort.abort();
        entry.lease?.release();
        this.cache.delete(key);
      }
  }
  figure(host, key, locale, label, live = false) {
    const d = host.ownerDocument,
      t = waveformCopy[locale],
      figure = d.createElement("figure");
    figure.className = "ls-waveform";
    figure.dataset.waveformKey = key;
    figure.dataset.waveformKind = live ? "capture" : "recording";
    figure.hidden = live;
    const svg = d.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 512 96");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label + ". " + t.hint);
    const path = d.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "ls-waveform-path");
    const cursor = d.createElementNS("http://www.w3.org/2000/svg", "line");
    cursor.setAttribute("class", "ls-waveform-playhead");
    cursor.setAttribute("y1", "0");
    cursor.setAttribute("y2", "96");
    cursor.setAttribute("x1", "0");
    cursor.setAttribute("x2", "0");
    cursor.setAttribute("visibility", "hidden");
    cursor.setAttribute("aria-hidden", "true");
    svg.append(path, cursor);
    const caption = d.createElement("figcaption"),
      retry = d.createElement("button");
    retry.type = "button";
    retry.textContent = t.retry;
    retry.hidden = true;
    retry.onclick = () => this.load(key);
    figure.append(svg, caption, retry);
    host.append(figure);
    const view = {
      key,
      locale,
      label,
      figure,
      path,
      cursor,
      caption,
      retry,
      live,
      cursorVisible: false,
    };
    this.views.push(view);
    this.paint(view);
    return view;
  }
  mount(host, track, project, locale) {
    for (const [i, clip] of track.clips.entries()) {
      const ref = project.assetRefs.find((r) => r.id === clip.sourceId);
      if (!ref) continue;
      const key = waveformSourceKey(ref);
      const view = this.figure(
        host,
        key,
        locale,
        waveformCopy[locale].source + " " + (i + 1),
      );
      view.figure.dataset.waveformKey = ref.sha256;
      view.figure.dataset.clipId = clip.id;
      Object.assign(view, { clip, ref, projectClock: project.clock });
      if (!this.cache.has(key)) {
        this.cache.set(key, {
          ref,
          abort: new AbortController(),
          wave: null,
        });
        this.load(key);
      }
      this.paint(view);
    }
    this.figure(
      host,
      "live:" + track.id,
      locale,
      waveformCopy[locale].session,
      true,
    );
  }
  load(key) {
    const entry = this.cache.get(key);
    if (!entry || entry.pending || this.closed) return;
    entry.error = false;
    entry.pending = true;
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        if (entry.abort.signal.aborted || this.closed) return;
        try {
          entry.lease ??= this.memory.reserve(
            VIEW_BYTES,
            "track-waveform-summary-and-view",
          );
          const wave = await this.documentStore.waveform(entry.ref, {
            signal: entry.abort.signal,
          });
          if (!entry.abort.signal.aborted && !this.closed) entry.wave = wave;
        } catch {
          if (!entry.abort.signal.aborted) entry.error = true;
        } finally {
          entry.pending = false;
          this.repaint(key);
        }
      });
  }
  position(position, clock) {
    for (const view of this.views) {
      const { clip, ref, cursor } = view;
      let visible = !!(
          clip &&
          ref &&
          clock &&
          ["playing", "paused"].includes(position.state)
        ),
        phase = 0;
      if (visible) {
        const elapsed = position.frame - clock.frame(clip.startTick);
        visible = elapsed >= 0 && (clip.loop || elapsed < ref.frames);
        if (visible) {
          const advance = clip.phaseAlignment
            ? phaseAdvance(clip, ref, view.projectClock)
            : 0;
          const source =
            (((elapsed + advance) % ref.frames) + ref.frames) % ref.frames;
          phase = source / ref.frames;
          if (this.reduced?.matches) phase = Math.floor(phase * 16) / 16;
        }
      }
      if (view.cursorVisible !== visible) {
        view.cursorVisible = visible;
        cursor.setAttribute("visibility", visible ? "visible" : "hidden");
      }
      if (visible) {
        const x = String(phase * 512);
        const key = x + "/" + position.state;
        if (view.cursorPosition !== key) {
          view.cursorPosition = key;
          cursor.setAttribute("transform", `translate(${x} 0)`);
          cursor.setAttribute(
            "opacity",
            position.state === "paused" ? "0.5" : "1",
          );
        }
      }
    }
  }
  updateLive(
    trackId,
    identity,
    frames,
    read,
    { partial = false, state = "" } = {},
  ) {
    if (this.closed) return;
    const key = "live:" + trackId;
    let entry = this.live.get(key);
    if (entry && entry.identity !== identity) {
      entry.lease?.release();
      this.live.delete(key);
      entry = null;
    }
    if (!identity) {
      this.repaint(key);
      return;
    }
    if (!entry) {
      entry = { identity, wave: null };
      this.live.set(key, entry);
    }
    entry.partial = partial;
    entry.state = state;
    try {
      entry.lease ??= this.memory.reserve(
        VIEW_BYTES,
        "live-waveform-summary-and-view",
      );
      if (!entry.wave || entry.wave.frames !== frames) {
        const delta = read(entry.wave?.frames ?? 0);
        if (delta) entry.wave = mergeWaveform(entry.wave, delta);
      }
      entry.error = false;
    } catch {
      entry.error = true;
    }
    this.repaint(key);
  }
  repaint(key) {
    for (const view of this.views) if (view.key === key) this.paint(view);
  }
  paint(view) {
    const t = waveformCopy[view.locale],
      entry = (view.live ? this.live : this.cache).get(view.key),
      wave = entry?.wave;
    if (view.live) view.figure.hidden = !entry;
    view.retry.hidden = view.live || !entry?.error;
    const state = view.live ? recordCopy[view.locale].states[entry?.state] : "";
    const text = wave
      ? `${view.label}${state ? " · " + state : ""} · ${wave.frames}/${wave.capacity} ${t.frames} · ${t.peak} ${wave.peak.toFixed(4)}${entry.partial ? " · " + t.partial : ""}${wave.peak > 1 ? " · " + t.outside : ""}`
      : view.label + " · " + (entry?.error ? t.unavailable : t.waiting);
    if (view.caption.textContent !== text) view.caption.textContent = text;
    view.figure.dataset.state =
      entry?.state ??
      (wave ? "ready" : entry?.error ? "unavailable" : "loading");
    view.figure.dataset.frames = String(wave?.frames ?? 0);
    view.figure.dataset.capacity = String(wave?.capacity ?? 0);
    view.figure.dataset.peak = String(wave?.peak ?? 0);
    view.figure.dataset.partial = String(!!entry?.partial);
    if (view.lastWave !== wave || view.lastFrames !== wave?.frames) {
      const path = wave ? waveformPath(wave) : "";
      if (view.path.getAttribute("d") !== path)
        view.path.setAttribute("d", path);
      view.lastWave = wave;
      view.lastFrames = wave?.frames;
    }
  }
  async dispose() {
    this.closed = true;
    for (const entry of this.cache.values()) entry.abort.abort();
    await this.queue.catch(() => {});
    for (const entry of [...this.cache.values(), ...this.live.values()])
      entry.lease?.release();
    this.cache.clear();
    this.live.clear();
    this.views = [];
  }
}
