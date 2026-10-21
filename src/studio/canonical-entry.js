import { AudioMemory } from "../audio/audio-memory.js";
import { canonicalRegisteredAssets } from "../audio/canonical-registered-assets.js";
import { createCanonicalDemo } from "./canonical-demos.js";
import { createFreshCanonicalProject } from "./canonical-fresh-project.js";
import { createCanonicalStudioOwner } from "./canonical-owner.js";
import { canonicalAssetUrl } from "./canonical-asset-urls.js";
import { canonicalLocalRoute, canonicalStudioHref } from "./canonical-route.js";
import { initStudio } from "./main.js";

export async function initCanonicalLocalEntry() {
  if (
    !(
      import.meta.env.DEV ||
      import.meta.env.CANONICAL_LOCAL_REVIEW ||
      import.meta.env.CANONICAL_FINAL_STUDIO ||
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
    assets = canonicalRegisteredAssets(48000, canonicalAssetUrl);
  const bundle = await createFreshCanonicalProject({
    registry: assets.registry,
    memory,
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
        noticeSuffix: import.meta.env.CANONICAL_PUBLIC_PREVIEW
          ? locale === "en"
              ? " This optional unified Studio Preview has a known playback risk. Repeated playback stopped during an earlier long test; its cause remains unresolved. This version still uses that playback path. Save and download your project before playback. If audio stops, use Return to start then Play to try again, or use ordinary Rhythm Studio. Editing may stop playback; record through Loop Station."
              : " Studio gabungan ini Preview opsional dengan risiko playback yang diketahui. Dalam pengujian panjang sebelumnya, pemutaran berulang pernah terhenti; penyebabnya belum diketahui. Versi ini masih memakai jalur playback tersebut. Simpan dan unduh proyek sebelum memutar. Jika audio terhenti, tekan Kembali ke awal lalu Putar untuk mencoba lagi, atau gunakan Rhythm Studio biasa. Edit dapat menghentikan playback; rekam melalui Loop Station."
          : "",
        loadDemo: (kind) =>
          createCanonicalDemo(kind, {
            registry: assets.registry,
            memory,
            locale,
          }),
        createOwner: ({ signal, bundle }) =>
          createCanonicalStudioOwner({
            rate: bundle.project.timing.clock.sampleRate ?? 48000,
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
  root.dataset.canonicalRoute = import.meta.env.CANONICAL_FINAL_STUDIO
    ? "studio"
    : import.meta.env.CANONICAL_PUBLIC_PREVIEW
      ? "public-preview"
      : "local";
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement("meta");
    robots.name = "robots";
    document.head.append(robots);
  }
  robots.content = import.meta.env.CANONICAL_FINAL_STUDIO
    ? "index,follow"
    : "noindex,nofollow";
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
  const { attachCanonicalBeatboxPanel } =
    await import("./canonical-beatbox-panel.js");
  const reverse = attachCanonicalBeatboxPanel({
    app,
    root,
    registry: assets.registry,
    memory,
    locale,
  });
  let transferId = new URL(location.href).searchParams.get("handoff"),
    beatboxTransfer = null;
  if (!transferId) {
    const { stageBeatboxTransfer } =
        await import("../project/canonical-beatbox-transfer.js"),
      { CanonicalHandoffStore } =
        await import("../project/canonical-handoff.js"),
      staging = new CanonicalHandoffStore({ memory });
    try {
      beatboxTransfer = await stageBeatboxTransfer({ store: staging, memory });
      transferId = beatboxTransfer?.id ?? null;
    } catch (error) {
      const status = root.querySelector("#st-project-status");
      status.setAttribute("role", "alert");
      status.textContent =
        locale === "en"
          ? "Beatbox transfer is unfinished. Your original and current Studio project remain available; retry the transfer or import its backup file."
          : "Transfer Beatbox belum selesai. Sumber asli dan proyek Studio tetap tersedia; coba transfer lagi atau impor berkas cadangannya.";
      root.dataset.canonicalTransferError = error.code ?? error.message;
    } finally {
      staging.close();
    }
  }
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
      autoOpen: !!beatboxTransfer,
      onAccepted: () => beatboxTransfer?.acknowledge(),
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
        if (
          !import.meta.env.CANONICAL_FINAL_STUDIO &&
          destination.searchParams.get("workspace") !== "legacy"
        )
          destination.searchParams.set("candidate", "canonical");
        if (transferId && !beatboxTransfer && link.dataset.locale)
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
          reverse.dispose();
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
      reverse.dispose();
      void (async () => {
        await handoff?.dispose();
        await app.dispose();
      })().catch(() => {});
    },
    { once: true },
  );
  root.dataset.canonicalReady = "true";
  return app;
}
