import { routeCopy } from "./route-copy.js";
import { instrumentRouteHref } from "./route-context.js";
import { trackEvent } from "../analytics.js";
export function initRoutePanel({
  host,
  session,
  store,
  studio,
  locale,
  act,
  blocked,
  downloadRaw,
  restore,
  releaseProjectOutput,
  flushDraft,
  sharedDraftAvailable,
  readSharedDraft,
}) {
  host.innerHTML =
    '<p data-session></p><div class="toolbar"><button data-go></button><button data-raw></button><button data-original></button><button data-restore></button><button data-shared></button><a data-fresh target="_blank" rel="noopener"></a></div><dialog aria-labelledby="if-route-dialog-title" aria-describedby="if-route-dialog-explain"><h2 id="if-route-dialog-title"></h2><p data-explain id="if-route-dialog-explain"></p><div class="toolbar"><button data-confirm></button><button data-cancel></button></div></dialog>';
  const $ = (s) => host.querySelector(s),
    dialog = $("dialog");
  let moving = false,
    closed = false;
  dialog.tabIndex = -1;
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [
      ...dialog.querySelectorAll(
        "button:enabled,a[href],input:enabled,select:enabled",
      ),
    ].filter((node) => node.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1),
      active = document.activeElement;
    if (!first) {
      event.preventDefault();
      dialog.focus();
    } else if (
      !controls.includes(active) ||
      (event.shiftKey && active === first) ||
      (!event.shiftKey && active === last)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  });
  function render() {
    const t = routeCopy[locale()],
      busy = blocked() || moving;
    dialog.setAttribute("aria-busy", String(moving));
    $("[data-session]").textContent = t.session;
    $("[data-go]").textContent = studio ? t.toGamelan : t.toStudio;
    $("h2").textContent = t.title;
    $("[data-explain]").textContent = t.explain;
    $("[data-confirm]").textContent = t.continue;
    $("[data-cancel]").textContent = t.cancel;
    $("[data-raw]").textContent = t.raw;
    $("[data-original]").textContent = t.original;
    $("[data-restore]").textContent = t.restore;
    $("[data-fresh]").textContent = t.fresh;
    $("[data-shared]").textContent = t.shared;
    $("[data-fresh]").href = instrumentRouteHref(studio, locale());
    for (const button of host.querySelectorAll("button"))
      button.disabled = busy || closed;
    $("[data-raw]").disabled ||= !store.hasRaw;
    $("[data-original]").disabled ||= !store.hasOriginal;
    $("[data-restore]").disabled ||= !store.hasRaw;
    $("[data-shared]").disabled ||= !sharedDraftAvailable();
  }
  $("[data-go]").onclick = () => {
    if (!blocked() && !moving) dialog.showModal();
  };
  $("[data-cancel]").onclick = () => dialog.close();
  dialog.addEventListener("cancel", (e) => {
    if (moving) e.preventDefault();
  });
  $("[data-raw]").onclick = () =>
    act(() => {
      const raw = store.rawBackup();
      if (raw !== null) downloadRaw(raw, "perkusi-tab-draft.json");
    });
  $("[data-original]").onclick = () =>
    act(() => {
      const original = store.original();
      if (original)
        downloadRaw(
          JSON.stringify(original, null, 2) + "\n",
          "perkusi-pre-transfer.perkusi.json",
        );
    });
  $("[data-restore]").onclick = () =>
    act(() => {
      if (confirm(routeCopy[locale()].restoreConfirm)) {
        const latest = store.readDraft();
        if (latest) restore(latest);
      }
    });
  $("[data-shared]").onclick = () =>
    act(() => {
      if (confirm(routeCopy[locale()].restoreConfirm)) {
        const project = readSharedDraft();
        if (project) restore(project);
      }
    });
  $("[data-confirm]").onclick = () =>
    act(async () => {
      if (blocked() || moving || closed) return;
      moving = true;
      render();
      try {
        store.prepare(session.project);
        if (!flushDraft())
          throw Object.assign(Error("draft conflict"), {
            code: "routeConflict",
          });
        releaseProjectOutput();
        try {
          await session.dispose();
        } catch {
          // Retry existing cleanup without reviving the terminal owner. Keep the
          // saved project here and require reload even if this recovery succeeds.
          try {
            await session.closeAudio();
            session.releaseExport();
          } catch {
            /* Retain admissions; do not falsely navigate. */
          }
          throw Object.assign(Error("cleanup"), { code: "routeCleanup" });
        }
        closed = true;
        if (!studio) trackEvent("gamelan_to_studio");
        location.assign(instrumentRouteHref(!studio, locale()));
      } catch (error) {
        dialog.close();
        throw error;
      } finally {
        moving = false;
        render();
        if (!closed && !dialog.open) {
          const target = $("[data-go]").disabled
            ? $("[data-fresh]")
            : $("[data-go]");
          target.focus();
        }
      }
    });
  return {
    render,
    close() {
      closed = true;
      dialog.close();
      store.close();
    },
  };
}
