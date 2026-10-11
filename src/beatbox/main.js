import { AudioEngine } from "../audio/engine.js";
import { characterDefinitions } from "../characters/characters.js";
import { originalGroovePack, originalCatalog } from "./pack.js";
import { beatboxMessages } from "./messages.js";
import { initFocusVisibility } from "./focus-visibility.js";
import { trackEvent } from "../analytics.js";
import { createPlaybackMilestones } from "./playback-milestones.js";
import { createBeatboxOutputStage } from "./output-stage.js";
import { prepareBumiBuffer } from "./bumi-presence.js";
import "../characters/characters.css";
import "./style.css";

export function initBeatbox() {
  trackEvent("playground_open");
  const observePlayback = createPlaybackMilestones(trackEvent);
  let lastError = "";
  const engine = new AudioEngine(originalGroovePack(1), {
    variantPacks: [originalGroovePack(2)],
    outputStageFactory: createBeatboxOutputStage,
    bankOptions: { prepareBuffer: prepareBumiBuffer },
  });
  const roles = characterDefinitions.map((c) => c.role);
  roles.forEach((id) => engine.setLayer(id, false));
  const root = document.querySelector(".beatbox-page");
  const disposeFocusVisibility = initFocusVisibility(root);
  let copy,
    disposed = false,
    frame,
    lastRender = 0;
  const text = (el, value) => {
    if (el.textContent !== value) el.textContent = value;
  };
  const announce = (value) =>
    text(document.querySelector("#bb-announcement"), value);
  function localize() {
    copy = beatboxMessages[document.documentElement.lang] || beatboxMessages.id;
    root
      .querySelectorAll("[data-bb-copy]")
      .forEach((el) => text(el, copy[el.dataset.bbCopy]));
    for (const c of characterDefinitions) {
      text(
        root.querySelector(`[data-role-label="${c.role}"]`),
        copy.roles[c.role],
      );
      root
        .querySelector(`[data-variant-group="${c.role}"]`)
        .setAttribute("aria-label", `${copy.variantLabel} — ${c.name}`);
      root
        .querySelectorAll(`[data-variant-role="${c.role}"]`)
        .forEach((el) =>
          el.setAttribute(
            "aria-label",
            `${c.name} — ${copy.variant} ${el.dataset.variant === "1" ? "A" : "B"}`,
          ),
        );
      text(root.querySelector(`[data-retry="${c.role}"]`), copy.retry);
    }
    root.querySelector(".bb-guide").setAttribute("aria-label", copy.guide);
    root.querySelector(".bb-stage").setAttribute("aria-label", copy.stageLabel);
    root
      .querySelector(".bb-transport")
      .setAttribute("aria-label", copy.transport);
    document
      .querySelector("#bb-volume")
      .setAttribute("aria-label", copy.volume);
    for (const id of ["pause", "reset", "demo"])
      text(document.querySelector("#bb-" + id), copy[id]);
    render();
  }
  function render() {
    if (disposed) return;
    const s = engine.snapshot();
    for (const c of characterDefinitions) {
      const state = s.stems[c.role],
        el = root.querySelector(`[data-role="${c.role}"]`);
      const pending = state.pendingAt !== null;
      el.dataset.state =
        state.state === "error"
          ? "error"
          : state.state === "loading"
            ? "loading"
            : state.active
              ? "active"
              : "idle";
      el.dataset.active = String(state.active);
      el.dataset.selected = String(state.enabled);
      el.dataset.pending = String(pending);
      el.setAttribute("aria-pressed", String(state.enabled));
      let label = state.active
        ? copy.active
        : state.enabled
          ? copy.selected
          : copy.off;
      if (pending)
        label = !state.enabled
          ? copy.pendingOff
          : !state.active
            ? copy.pendingOn
            : copy.pendingVariant;
      if (state.state === "loading") label = copy.loading;
      if (state.state === "error") label = copy.assetError;
      if (state.active && state.variant !== state.appliedVariant)
        label += ` ${copy.current} ${state.appliedVariant === 1 ? "A" : "B"}. ${copy.chosen} ${state.variant === 1 ? "A" : "B"}.`;
      if (state.state === "error" && state.active)
        label += " " + copy.oldStillPlays;
      text(root.querySelector(`[data-role-status="${c.role}"]`), label);
      el.setAttribute(
        "aria-label",
        `${c.name} — ${copy.roles[c.role]}. ${label}`,
      );
      root.querySelector(`[data-retry="${c.role}"]`).hidden =
        state.state !== "error";
      root
        .querySelectorAll(`[data-variant-role="${c.role}"]`)
        .forEach((button) =>
          button.setAttribute(
            "aria-pressed",
            String(Number(button.dataset.variant) === state.variant),
          ),
        );
      const asset = originalCatalog.assets.find(
        (a) =>
          a.role === c.role &&
          a.variant === (state.appliedVariant || state.variant),
      );
      const beat = ((s.beat % 8) + 8) % 8;
      const events = asset?.events || [];
      const distances = events.map(
        (event) =>
          (((beat - (typeof event === "number" ? event : event.beat)) % 8) +
            8) %
          8,
      );
      const pulse =
        state.active && distances.length
          ? Math.max(0, 1 - Math.min(...distances) / 0.28)
          : 0;
      el.style.setProperty("--pulse", String(pulse));
    }
    const active = Object.values(s.stems).filter((stem) => stem.active).length;
    observePlayback(s);
    const errorState =
      s.status === "error"
        ? "audio"
        : Object.values(s.stems)
            .filter((stem) => stem.state === "error")
            .map((stem) => stem.error)
            .join("|");
    if (errorState && errorState !== lastError) trackEvent("audio_error");
    lastError = errorState;
    const status =
      s.status === "loading"
        ? `${copy.waiting} ${Object.values(s.stems).filter((stem) => stem.state === "ready").length}/6 ${copy.loadingProgress}`
        : s.status === "playing"
          ? `${active} ${copy.playing}`
          : copy[s.status] ||
            (s.status === "error"
              ? typeof window.AudioContext === "function"
                ? copy.audioError
                : copy.audioUnsupported
              : copy.idle);
    text(document.querySelector("#bb-status"), status);
    text(
      document.querySelector("[data-play-label]"),
      s.status === "idle" ? copy.start : copy.play,
    );
    document.querySelector("#bb-play").disabled =
      s.status === "loading" || s.status === "playing";
    text(
      document.querySelector("#bb-position"),
      `${copy.bar} ${Math.floor(s.beat / 4) + 1} · ${copy.beat} ${Math.floor(s.beat % 4) + 1}`,
    );
    root
      .querySelectorAll(".bb-beats i")
      .forEach((dot, i) =>
        dot.classList.toggle(
          "is-current",
          s.status === "playing" && i === Math.floor(s.beat % 4),
        ),
      );
    root
      .querySelector(".bb-bar-track i")
      .style.setProperty("--bar-progress", String((s.beat % 4) / 4));
  }
  const run = (action) => {
    try {
      const pending = action();
      render();
      Promise.resolve(pending).then(render, () => {
        announce(copy.audioError);
        render();
      });
    } catch {
      announce(copy.audioError);
      render();
    }
  };
  function play() {
    if (!roles.some((id) => engine.enabled.get(id)))
      engine.setLayer("kick", true);
    return engine.play();
  }
  function toggle(id) {
    engine.setLayer(id, !engine.enabled.get(id));
    if (engine.enabled.get(id) && !engine.transport.running)
      return engine.play();
  }
  root
    .querySelectorAll("button:disabled,input:disabled")
    .forEach((el) => (el.disabled = false));
  root
    .querySelectorAll("[data-role]")
    .forEach((el) =>
      el.addEventListener("click", () => run(() => toggle(el.dataset.role))),
    );
  root
    .querySelectorAll("[data-variant-role]")
    .forEach((el) =>
      el.addEventListener("click", () =>
        run(() =>
          engine.setVariation(
            el.dataset.variantRole,
            Number(el.dataset.variant),
          ),
        ),
      ),
    );
  root
    .querySelectorAll("[data-retry]")
    .forEach((el) =>
      el.addEventListener("click", () =>
        run(() => engine.retry(el.dataset.retry)),
      ),
    );
  document.querySelector("#bb-play").addEventListener("click", () => run(play));
  document
    .querySelector("#bb-pause")
    .addEventListener("click", () => run(() => engine.pause()));
  document.querySelector("#bb-reset").addEventListener("click", () =>
    run(() => {
      engine.reset();
      announce(copy.resetAnnouncement);
    }),
  );
  document.querySelector("#bb-demo").addEventListener("click", () =>
    run(() => {
      roles.forEach((id) =>
        engine.setLayer(id, ["kick", "hat", "vocal-bass"].includes(id)),
      );
      announce(copy.demoAnnouncement);
      return engine.play();
    }),
  );
  document
    .querySelector("#bb-volume")
    .addEventListener("input", (event) =>
      engine.setVolume(Number(event.target.value)),
    );
  document.addEventListener("keydown", (event) => {
    if (
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.repeat ||
      /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) ||
      event.target.isContentEditable
    )
      return;
    const id = roles[Number(event.key) - 1];
    if (id) {
      event.preventDefault();
      run(() => toggle(id));
    }
  });
  document.addEventListener("perkusi:locale", localize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) run(() => engine.suspend());
  });
  function dispose() {
    disposed = true;
    disposeFocusVisibility();
    cancelAnimationFrame(frame);
    engine.dispose();
  }
  window.addEventListener("pagehide", dispose);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && disposed) location.reload();
  });
  if (navigator.hardwareConcurrency <= 2) root.classList.add("motion-lite");
  function animate(now) {
    if (disposed) return;
    if (now - lastRender > 75) {
      render();
      lastRender = now;
    }
    frame = requestAnimationFrame(animate);
  }
  localize();
  frame = requestAnimationFrame(animate);
  if (["localhost", "127.0.0.1"].includes(location.hostname))
    window.perkusiBeatbox = {
      engine,
      catalog: originalCatalog,
      render,
      dispose,
    };
}
