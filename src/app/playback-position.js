import "./playback-position.css";

const copy = {
  id: {
    bar: "Bar",
    step: "Langkah",
    beat: "Ketukan",
    stopped: "Berhenti",
    paused: "Dijeda",
    waiting: "Menunggu audio",
    tail: "Resonansi",
  },
  en: {
    bar: "Bar",
    step: "Step",
    beat: "Beat",
    stopped: "Stopped",
    paused: "Paused",
    waiting: "Waiting for audio",
    tail: "Tail",
  },
};

export function playbackDisplay(host, id, locale, { unit = "step" } = {}) {
  const root = document.createElement("div"),
    label = document.createElement("output"),
    rail = document.createElement("div"),
    fill = document.createElement("i"),
    reduced = matchMedia("(prefers-reduced-motion: reduce)");
  root.className = "playback-position";
  label.id = id;
  label.setAttribute("aria-live", "off");
  rail.className = "playback-position-rail";
  rail.setAttribute("aria-hidden", "true");
  rail.append(fill);
  root.append(label, rail);
  host.append(root);
  let signature = "",
    lastPhase = -1;
  return (position) => {
    const t = copy[locale()],
      { state, bar, step } = position,
      phase = reduced.matches
        ? Math.floor(position.phase * 16) / 16
        : position.phase,
      next = [locale(), state, bar, step].join("/");
    if (next !== signature) {
      signature = next;
      const place = `${t.bar} ${bar + 1}${step === null ? "" : ` · ${t[unit]} ${unit === "beat" ? Math.floor(step / 4) + 1 : step + 1}`}`;
      label.textContent =
        state === "stopped"
          ? t.stopped
          : `${t[state] ? t[state] + " · " : ""}${place}`;
      root.dataset.state = state;
      label.dataset.state = state;
      label.dataset.bar = String(bar);
      label.dataset.step = step === null ? "" : String(step);
    }
    if (phase !== lastPhase) {
      lastPhase = phase;
      fill.style.transform = `scaleX(${phase})`;
    }
  };
}

// A single UI reader per workspace. Audio currentTime is supplied by its owner;
// animation frames only project that position and never advance the transport.
export function positionDriver(read, paint) {
  let frame = 0,
    disposed = false;
  const update = () => {
    if (disposed) return;
    const p = read();
    paint(p);
    if (["playing", "waiting"].includes(p.state)) {
      if (!frame) frame = requestAnimationFrame(tick);
    } else if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  const tick = () => {
    frame = 0;
    update();
  };
  return {
    update,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
