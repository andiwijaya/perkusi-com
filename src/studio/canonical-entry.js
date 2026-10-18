import { AudioMemory } from "../audio/audio-memory.js";
import { canonicalRegisteredAssets } from "../audio/canonical-registered-assets.js";
import { createCanonicalBundle } from "../project/canonical-package.js";
import { migrateLegacyMetadata } from "../project/canonical-metadata.js";
import { newComposition } from "../project/composition-model.js";
import { createFlagshipDemo } from "../project/flagship-demo.js";
import { createCanonicalStudioOwner } from "./canonical-owner.js";
import { canonicalAssetUrl } from "./canonical-asset-urls.js";
import { canonicalLocalRoute, canonicalStudioHref } from "./canonical-route.js";
import { initStudio } from "./main.js";

export async function initCanonicalLocalEntry() {
  if (
    !(
      import.meta.env.DEV ||
      import.meta.env.CANONICAL_LOCAL_REVIEW ||
      import.meta.env.CANONICAL_PUBLIC_PREVIEW
    ) ||
    !canonicalLocalRoute(
      true,
      location.href,
      import.meta.env.CANONICAL_PUBLIC_PREVIEW,
    )
  )
    throw Error("canonicalLocalOnly");
  const root = document.querySelector(".studio-page"),
    locale = document.documentElement.lang === "en" ? "en" : "id",
    memory = new AudioMemory(),
    assets = canonicalRegisteredAssets(48000, canonicalAssetUrl),
    initial = await migrateLegacyMetadata(JSON.stringify(newComposition()), {
      registry: assets.registry,
    }),
    bundle = await createCanonicalBundle(initial.project, {
      registry: assets.registry,
      memory,
      originals: initial.originals,
    });
  let app;
  try {
    app = await initStudio({
      canonicalCandidate: {
        editable: true,
        bundle,
        registry: assets.registry,
        memory,
        recover: true,
        locale,
        sourceRights: [...assets.catalog, ...assets.nativeRights],
        loadDemo: async () => {
          const demo = await createFlagshipDemo(assets.registry, locale);
          return createCanonicalBundle(demo.canonical, {
            registry: assets.registry,
            memory,
            originals: demo.originals,
          });
        },
        createOwner: ({ signal, bundle }) =>
          createCanonicalStudioOwner({
            rate: 48000,
            memory,
            signal,
            bundle,
            resolveUrl: canonicalAssetUrl,
            contextFactory: (rate) => new AudioContext({ sampleRate: rate }),
            outputFactory: (context) => context.destination,
          }),
      },
    });
  } finally {
    bundle.dispose();
  }
  root.dataset.canonicalRoute = import.meta.env.CANONICAL_PUBLIC_PREVIEW
    ? "public-preview"
    : "local";
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement("meta");
    robots.name = "robots";
    document.head.append(robots);
  }
  robots.content = "noindex,nofollow";
  root.dataset.canonicalReady = "true";
  const { attachCanonicalHandoffInbox } =
    await import("./canonical-handoff-inbox.js");
  const inbox = attachCanonicalHandoffInbox({ root, memory, locale });
  const { attachCanonicalLegacyPanel } =
    await import("./canonical-legacy-panel.js");
  const legacy = attachCanonicalLegacyPanel({
    root,
    app,
    registry: assets.registry,
    memory,
    locale,
  });
  const transferId = new URL(location.href).searchParams.get("handoff");
  let handoff = null;
  if (transferId) {
    const { attachCanonicalHandoff } =
      await import("./canonical-handoff-panel.js");
    handoff = await attachCanonicalHandoff({
      app,
      root,
      memory,
      id: transferId,
      locale,
    });
  }
  let leaving = false;
  const life = new AbortController();
  window.addEventListener(
    "beforeunload",
    (event) => {
      if (!app.isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    },
    { signal: life.signal },
  );
  // A language or workspace change checkpoints the accepted document in the
  // separate canonical store before closing audio and navigating. A failed
  // save/close leaves this document and its owner available for retry.
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest(
        "a[data-locale],a[data-route],a[data-gamelan-link],a[data-loop-link]",
      );
      if (
        !link ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      let href = link.dataset.locale
        ? canonicalStudioHref(link.dataset.locale)
        : link.href;
      const destination = new URL(href, location.href);
      if (
        destination.origin === location.origin &&
        /\/(?:studio|gamelan|loop-station)\/?$/.test(destination.pathname)
      ) {
        if (destination.searchParams.get("workspace") !== "legacy")
          destination.searchParams.set("candidate", "canonical");
        if (transferId && link.dataset.locale)
          destination.searchParams.set("handoff", transferId);
        href = destination.href;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (app.snapshot().pendingTasks) {
        root.querySelector("#st-project-status").textContent =
          locale === "en"
            ? "Wait for the current operation before leaving."
            : "Tunggu operasi saat ini sebelum berpindah.";
        return;
      }
      if (leaving) return;
      leaving = true;
      void (async () => {
        try {
          const revision = app.editor.snapshot().revision;
          await app.workflow.save();
          if (app.editor.snapshot().revision !== revision)
            throw Error("draftConflict");
          await app.controller.stop();
          if (app.editor.snapshot().revision !== revision)
            throw Error("draftConflict");
          await handoff?.dispose();
          await app.dispose();
          inbox.dispose();
          legacy.dispose();
          life.abort();
          location.assign(href);
        } catch {
          leaving = false;
          const status = root.querySelector("#st-project-status");
          status.setAttribute("role", "alert");
          status.textContent =
            locale === "en"
              ? "Navigation paused. Keep this page open; save or release audio, then retry."
              : "Pindah halaman ditunda. Tetap di sini; simpan atau lepaskan audio, lalu coba lagi.";
        }
      })();
    },
    { capture: true, signal: life.signal },
  );
  window.addEventListener(
    "pagehide",
    () => {
      life.abort();
      inbox.dispose();
      legacy.dispose();
      void (async () => {
        await handoff?.dispose();
        await app.dispose();
      })().catch(() => {});
    },
    { once: true },
  );
  return app;
}
