import { instrumentCopy } from "./copy.js";
import { renderArticleButtons, articleNoteLabel } from "./render.js";

export function initArticlePad(instrument) {
  const root = document.querySelector(".article-pad");
  if (!root) return;
  const $ = (id) => document.querySelector("#article-" + id);
  let bank = instrument.banks[0].key,
    player = null,
    ticket = 0,
    disposed = false;
  let state = "idle",
    ready = 0,
    total = instrument.banks[0].notes.length,
    activated = false;
  let currentNotices = {};
  const life = new AbortController(),
    options = { signal: life.signal };
  const t = () => instrumentCopy[document.documentElement.lang];
  function renderStatus() {
    const copy = t();
    root.dataset.state = state;
    $("pad-status").textContent =
      state === "loading"
        ? `${copy.loading}… ${ready}/${total}`
        : state === "ready"
          ? `${copy.ready} · ${ready}/${total}`
          : copy[state] || copy.error;
    $("pad-status").setAttribute(
      "role",
      state === "error" || state === "playError" ? "alert" : "status",
    );
    $("prepare").textContent = state === "error" ? copy.retry : copy.prepare;
    $("prepare").disabled =
      state === "loading" || state === "ready" || state === "stopped";
    $("stop").textContent = copy.stop;
    $("stop").disabled = !activated;
    $("volume").setAttribute("aria-label", copy.volume);
    root.querySelectorAll("[data-article-note]").forEach((button) => {
      button.disabled = !player?.isReady();
      const note = instrument.banks
        .find((b) => b.key === bank)
        .notes.find((n) => n[0] === button.dataset.articleNote);
      button.querySelector("strong").textContent = articleNoteLabel(
        instrument,
        note[0],
        note[1],
        document.documentElement.lang,
      );
    });
    const links = $("audio-links");
    links.replaceChildren();
    for (const [key, url] of Object.entries(currentNotices)) {
      if (typeof url !== "string" || !/^(\/|https:\/\/)/.test(url)) continue;
      const item = document.createElement("li"),
        link = document.createElement("a");
      link.href = url;
      link.textContent =
        (/license/i.test(key)
          ? copy.license
          : /^page/.test(key)
            ? "Freesound"
            : /notice/i.test(key)
              ? "NOTICE"
              : copy.archive) +
        " · " +
        key;
      item.append(link);
      links.append(item);
    }
  }
  async function prepare() {
    const intent = ++ticket,
      selected = bank;
    activated = true;
    state = "loading";
    ready = 0;
    total = instrument.banks.find((b) => b.key === bank).notes.length;
    renderStatus();
    try {
      if (!player) {
        const [{ loadInstrumentBank }, { createArticlePlayer }] =
          await Promise.all([import("./banks.js"), import("./player.js")]);
        const descriptor = await loadInstrumentBank(instrument.slug, selected);
        if (disposed || intent !== ticket) return;
        currentNotices = descriptor.notices || {};
        player = createArticlePlayer(descriptor, { family: instrument.slug });
        player.setVolume(Number($("volume").value));
      }
      const owner = player;
      await owner.prepare((count, max) => {
        if (disposed || intent !== ticket) return;
        ready = count;
        total = max;
        renderStatus();
      });
      if (disposed || intent !== ticket) return;
      state = "ready";
      renderStatus();
    } catch {
      if (disposed || intent !== ticket) return;
      state = "error";
      renderStatus();
    }
  }
  const play = async (button) => {
    if (!button || button.disabled || !player?.isReady()) return;
    const owner = player,
      intent = ticket;
    button.classList.add("is-struck");
    setTimeout(() => button.classList.remove("is-struck"), 140);
    try {
      await owner.play(button.dataset.articleNote);
    } catch {
      if (!disposed && intent === ticket) {
        state = "playError";
        renderStatus();
      }
    }
  };
  $("prepare").addEventListener("click", prepare, options);
  $("stop").addEventListener(
    "click",
    () => {
      player?.stop();
      if (player?.isReady()) state = "stopped";
      renderStatus();
    },
    options,
  );
  $("volume").addEventListener(
    "input",
    (event) => player?.setVolume(Number(event.target.value)),
    options,
  );
  root.addEventListener(
    "click",
    (event) => {
      void play(event.target.closest("[data-article-note]"));
    },
    options,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.defaultPrevented ||
        event.target.closest("input,textarea,select,[contenteditable]")
      )
        return;
      const index = Number(event.key) - 1;
      if (!/^[1-8]$/.test(event.key)) return;
      const button = root.querySelectorAll("[data-article-note]")[index];
      if (button && !button.disabled) {
        event.preventDefault();
        void play(button);
      }
    },
    options,
  );
  $("bank")?.addEventListener(
    "change",
    (event) => {
      ticket++;
      void player?.dispose();
      player = null;
      currentNotices = {};
      bank = event.target.value;
      root.querySelector(".article-pad-buttons").innerHTML =
        renderArticleButtons(instrument, bank);
      state = "idle";
      ready = 0;
      total = instrument.banks.find((b) => b.key === bank).notes.length;
      renderStatus();
      if (activated) void prepare();
    },
    options,
  );
  document.addEventListener("perkusi:locale", renderStatus, options);
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) player?.stop();
    },
    options,
  );
  window.addEventListener(
    "pagehide",
    () => {
      disposed = true;
      ticket++;
      life.abort();
      void player?.dispose();
    },
    { once: true },
  );
  renderStatus();
}
