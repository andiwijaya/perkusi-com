import "../style.css";
import "../studio/style.css";
import "./v5-shell.css";
import { renderSiteShell } from "../app/site-shell.js";
import { initNavigation } from "../app/navigation.js";
import { INSTRUMENT_DEMOS } from "./instrument-demos.js";
import {
  leaveInstrumentWorkspace,
  instrumentHandoffText,
} from "./v5-navigation.js";
import { instrumentRouteHref } from "./route-context.js";
import { instrumentNames } from "./instrument-focus.js";
import { initSequencePanel } from "./sequence-panel.js";
import {
  canonicalLocalSession,
  canonicalStudioHref,
} from "../studio/canonical-route.js";

const copy = {
  id: {
    title: "Gamelan",
    studio: "Studio Gamelan",
    intro: "Pilih instrumen dan laras, lalu mainkan atau rekam pukulanmu.",
    studioIntro:
      "Susun pola drum dan edit pukulan Gamelan dalam proyek yang sama.",
    preview:
      "Preview · Asal budaya dan permainan pada perangkat fisik belum diverifikasi.",
    backup: "Simpan, backup & pindah halaman",
    instruments: "Jelajahi instrumen",
    demoDetails: "Tentang demo & status penilaian",
    studioHelp: "Petunjuk editor & batas ekspor",
    play: "Putar sekali",
    load: "Muat demo",
    once: "Pemutaran sekali sampai selesai; Jeda mempertahankan posisi.",
    repeating:
      "Pola berulang. Berhenti untuk mengedit atau mengekspor; sumber dan laras tetap utuh.",
  },
  en: {
    title: "Gamelan",
    studio: "Gamelan Studio",
    intro:
      "Choose an instrument and tuning bank, then play or record your strikes.",
    studioIntro:
      "Arrange drum patterns and edit Gamelan strikes in the same project.",
    preview:
      "Preview · Cultural origin and physical-device performance remain unverified.",
    backup: "Save, back up & switch pages",
    instruments: "Explore instruments",
    demoDetails: "About this demo & review status",
    studioHelp: "Editor help & export limits",
    play: "Play once",
    load: "Load demo",
    once: "One pass through the score; Pause preserves your position.",
    repeating:
      "The pattern repeats. Stop to edit or export; sources and tuning are retained.",
  },
};

// Opt-in local S6A presentation. Existing project/audio owners remain in charge.
export function initV5Shell({
  host,
  session,
  studio,
  locale,
  setLocale,
  act,
  ...navigation
}) {
  host.classList.add("v5-gamelan");
  document.body.classList.add("v5-gamelan-page");
  host.querySelector(":scope > header").hidden = true;
  host.querySelector(":scope > .skip-link").hidden = true;
  const frame = document.createElement("div");
  frame.className = "v5-site-shell";
  host.prepend(frame);
  const main = host.querySelector("main");
  main.classList.add("studio-page", "v5-main");
  const context = document.createElement("p");
  context.className = "v5-context";
  main.querySelector(".intro").after(context);
  const details = (className) => {
    const e = document.createElement("details");
    e.className = className + " st-panel";
    e.append(document.createElement("summary"));
    return e;
  };
  const backup = details("v5-backup"),
    gallery = details("v5-gallery");
  gallery.append(host.querySelector("#if-ensemble-stage"));
  const workspace = host.querySelector("#if-focus-workspace");
  const performanceTools = host.querySelector(".take-panel > .toolbar");
  performanceTools.classList.add("v5-performance-tools");
  workspace.querySelector(".controls").after(performanceTools);
  context.after(
    workspace,
    gallery,
    host.querySelector("#if-demo-panel"),
    backup,
  );
  const loopLink = document.createElement("a");
  loopLink.id = "v5-open-loop";
  loopLink.className = "button";
  loopLink.href = "/loop-station/?lang=" + locale();
  context.after(loopLink);
  loopLink.addEventListener("click", (event) => {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    void act(() =>
      leaveInstrumentWorkspace(
        {
          session,
          ...navigation,
          flushDraft: () => {
            if (!navigation.flushDraft()) return false;
            try {
              sessionStorage.setItem(
                "perkusi.loop-station.incoming.v4",
                session.toJSON(),
              );
              return true;
            } catch {
              return false;
            }
          },
          navigate: (href) => location.assign(href),
        },
        loopLink.href,
      ),
    );
  });
  const sequenceHost = document.createElement("section");
  context.after(sequenceHost);
  const sequence = initSequencePanel({
    host: sequenceHost,
    session,
    studio,
    locale,
    act,
    onPosition: (position) => studio.renderPosition?.(position),
  });
  for (const node of [
    host.querySelector("#if-route"),
    host.querySelector("#if-library"),
    host.querySelector(".file-actions"),
  ])
    if (node) backup.append(node);
  const help = host.querySelector("#if-help");
  help.append(host.querySelector(".steps"));
  backup.after(help, host.querySelector(".credit"));
  const playbackNote = document.createElement("p");
  playbackNote.className = "v5-playback-note";
  workspace.prepend(playbackNote);
  const selectedInstrument = document.createElement("output");
  selectedInstrument.id = "v5-selected-instrument";
  selectedInstrument.className = "v5-selected-name";
  host.querySelector("#if-instrument").after(selectedInstrument);
  host
    .querySelector("#if-instrument")
    .setAttribute("aria-describedby", selectedInstrument.id);
  const studioHelp = details("v5-studio-help"),
    studioTools = host.querySelector("#is-play").closest(".toolbar"),
    studioStatus = host.querySelector("#is-status");
  studioHelp.append(
    host.querySelector("#is-intro"),
    host.querySelector("#is-desktop-hint"),
  );
  host.querySelector("#is-title").after(studioTools, studioStatus, studioHelp);
  let language = null,
    removeNavigation,
    moving = false;
  let mainStudio = null;
  if (
    (import.meta.env.DEV ||
      import.meta.env.CANONICAL_LOCAL_REVIEW ||
      import.meta.env.CANONICAL_PUBLIC_PREVIEW) &&
    canonicalLocalSession(
      true,
      location.href,
      import.meta.env.CANONICAL_PUBLIC_PREVIEW,
    )
  ) {
    mainStudio = document.createElement("button");
    mainStudio.type = "button";
    mainStudio.id = "v5-main-studio";
    context.after(mainStudio);
    mainStudio.addEventListener(
      "click",
      () =>
        void act(async () => {
          if (moving || navigation.blocked())
            throw Object.assign(Error("recordBusy"), { code: "recordBusy" });
          moving = true;
          mainStudio.disabled = true;
          let held, store;
          try {
            const text = await instrumentHandoffText(session);
            held = session.memory.reserve(
              new TextEncoder().encode(text).length * 2 + 4096,
              "canonical/gamelan-handoff-blob",
            );
            const { CanonicalHandoffStore } =
              await import("../project/canonical-handoff.js");
            store = new CanonicalHandoffStore({ memory: session.memory });
            const transfer = await store.stage(
              new Blob([text], { type: "application/json" }),
              { kind: "gamelan", title: session.project.composition.title },
            );
            if (session.toJSON() !== text)
              throw Object.assign(Error("routeConflict"), {
                code: "routeConflict",
              });
            const href = new URL(canonicalStudioHref(locale()), location.href);
            href.searchParams.set("handoff", transfer.id);
            await leaveInstrumentWorkspace(
              {
                session,
                ...navigation,
                navigate: (url) => location.assign(url),
              },
              href.href,
            );
          } finally {
            store?.close();
            held?.release();
            moving = false;
            if (mainStudio) mainStudio.disabled = false;
          }
        }),
    );
  }
  frame.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (
      !link ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    if (link.dataset.locale) {
      event.preventDefault();
      setLocale(link.dataset.locale);
    } else if (
      !link.hash ||
      link.pathname !== location.pathname ||
      link.search !== location.search
    ) {
      event.preventDefault();
      if (moving) return;
      moving = true;
      void act(async () => {
        try {
          await leaveInstrumentWorkspace(
            {
              session,
              ...navigation,
              navigate: (href) => location.assign(href),
            },
            link.href,
          );
        } finally {
          moving = false;
        }
      });
    }
  });
  const compactDemos = (t, lang) => {
    for (const demo of INSTRUMENT_DEMOS) {
      for (const button of host.querySelectorAll(
        `[data-play-demo="${demo.id}"], [data-demo="${demo.id}"]`,
      )) {
        const existing = button.closest(".v5-demo-card");
        if (existing) continue;
        const isStudio = button.hasAttribute("data-demo");
        const card = isStudio
          ? button.parentElement
          : document.createElement("article");
        if (!isStudio) {
          button.before(card);
          card.append(button);
        }
        card.classList.add("v5-demo-card");
        const title = document.createElement("h3"),
          badge = document.createElement("span");
        title.textContent = demo.title[lang];
        badge.className = "v5-tuning";
        badge.textContent = demo.laras === "pelog" ? "Pelog" : "Slendro";
        const expanded = document.createElement("details"),
          summary = document.createElement("summary");
        summary.textContent = t.demoDetails;
        const description =
          card.querySelector("p") ?? document.createElement("p");
        description.textContent = demo.detail[lang]
          .replace(
            "Validasi budaya/listening masih UNVERIFIED.",
            "Penilaian budaya dan bunyi komposisi ini belum selesai.",
          )
          .replace(
            "Listening masih UNVERIFIED.",
            "Penilaian bunyi komposisi ini belum selesai.",
          )
          .replace("Mute grup", "Bisukan grup");
        expanded.append(summary, description);
        card.prepend(badge, title);
        card.append(button, expanded);
        button.textContent = isStudio ? t.load : t.play;
        button.setAttribute(
          "aria-label",
          button.textContent + ": " + demo.title[lang],
        );
      }
    }
  };
  const render = (s, studio) => {
    const lang = locale(),
      t = copy[lang];
    loopLink.href = "/loop-station/?lang=" + lang;
    if (
      (import.meta.env.DEV ||
        import.meta.env.CANONICAL_LOCAL_REVIEW ||
        import.meta.env.CANONICAL_PUBLIC_PREVIEW) &&
      canonicalLocalSession(
        true,
        location.href,
        import.meta.env.CANONICAL_PUBLIC_PREVIEW,
      )
    )
      loopLink.href += "&candidate=canonical";
    if (mainStudio) {
      mainStudio.textContent =
        lang === "en"
          ? "Bring project to Rhythm Studio"
          : "Bawa proyek ke Rhythm Studio";
      mainStudio.disabled = moving || navigation.blocked();
      const ownEditor = host.querySelector("#if-studio");
      if (ownEditor)
        ownEditor.textContent =
          lang === "en" ? "Open Gamelan editor" : "Buka editor Gamelan";
    }
    loopLink.textContent =
      lang === "id" ? "Lanjutkan ke Loop Station" : "Continue in Loop Station";
    sequence.render(s);
    selectedInstrument.textContent = instrumentNames[s.focus.instrument];
    if (language !== lang) {
      const focusedLocale = frame.contains(document.activeElement)
        ? document.activeElement.dataset.locale
        : null;
      language = lang;
      removeNavigation?.();
      frame.innerHTML = renderSiteShell("studio", lang, {
        gamelanHref: instrumentRouteHref(false, lang),
        languageHref: (language) => {
          const url = new URL(location.href);
          url.searchParams.set("lang", language);
          return url.pathname + url.search;
        },
      }).header;
      frame.querySelector(".skip-link").href = "#if-main";
      removeNavigation = initNavigation();
      if (focusedLocale)
        frame.querySelector(`[data-locale="${focusedLocale}"]`).focus();
    }
    main.querySelector("h1").textContent = studio ? t.studio : t.title;
    main.querySelector(".intro").textContent = studio ? t.studioIntro : t.intro;
    context.textContent = t.preview;
    gallery.firstElementChild.textContent = t.instruments;
    gallery.hidden = studio;
    backup.firstElementChild.textContent = t.backup;
    studioHelp.firstElementChild.textContent = t.studioHelp;
    playbackNote.textContent = s.repeating ? t.repeating : t.once;
    const play = host.querySelector(studio ? "#is-play" : "#if-replay");
    if (play) play.textContent = t.play;
    if (host.querySelector("#if-notice.error-notice")?.textContent || s.error)
      backup.open = true;
    const composition = host.querySelector("#is-composition"),
      demos = host.querySelector("#is-demos");
    if (composition && demos && demos.previousElementSibling !== composition)
      composition.after(demos);
    compactDemos(t, lang);
  };
  window.addEventListener(
    "pagehide",
    () => {
      removeNavigation?.();
      sequence.dispose();
    },
    {
      once: true,
    },
  );
  return { render };
}
