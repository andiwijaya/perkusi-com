import { projectMessages } from "./messages.js";
import { captureBeatboxProject, applyBeatboxProject } from "./beatbox-model.js";
import { ProjectStore } from "./store.js";
import { FileDelivery, safeFilename, readProjectFile } from "./files.js";
import { serializeProject } from "./schema.js";
import { exportFailureCategory } from "../analytics.js";
import { wavSnapshotKey } from "./wav-snapshot.js";

export function initProjectControls({
  engine,
  catalog,
  exporter,
  onChange = () => {},
  trackEvent = () => {},
  audioReady = () => true,
}) {
  const panel = document.querySelector(".project-panel"),
    el = (id) => document.querySelector("#project-" + id),
    store = new ProjectStore(catalog),
    delivery = new FileDelivery();
  let copy,
    disposed = false,
    busy = false,
    sharing = false,
    loading = false,
    receiving = false,
    file = null,
    fileKey = "",
    status = "ready",
    isError = false,
    warning = false,
    draftEnabled = true,
    lastSignature = "",
    progress = null,
    keyboardFocus = false,
    focusReturn = null;
  const listeners = [];
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn);
    listeners.push(() => target.removeEventListener(name, fn));
  };
  const unfocused = (target) =>
    !target || target === document.body || target === document.documentElement;
  listen(document, "keydown", () => (keyboardFocus = true));
  listen(document, "pointerdown", () => {
    keyboardFocus = false;
    focusReturn = null;
  });
  listen(document, "focusin", ({ target }) => {
    if (focusReturn && target !== focusReturn.owner && !unfocused(target))
      focusReturn = null;
  });
  const current = () =>
    captureBeatboxProject(
      engine,
      catalog,
      el("title").value || copy.untitled,
      Number(el("bars").value),
    );
  function notify(code, error = false) {
    if (disposed) return;
    status = Object.hasOwn(copy, code) ? code : "exportFailed";
    isError = error;
    render();
  }
  function render() {
    if (disposed) return;
    // Capture ownership before disabling/hiding a focused job control: browsers
    // can blur it to BODY while native audio work still owns the job.
    const active = document.activeElement;
    if (
      keyboardFocus &&
      ((active === el("cancel") && (!busy || status === "cancelling")) ||
        ([el("render"), el("bars")].includes(active) &&
          (busy || loading || receiving)))
    )
      focusReturn = {
        owner: active,
        target: active === el("bars") ? active : el("render"),
      };
    if (el("status").textContent !== copy[status])
      el("status").textContent = copy[status];
    el("status").setAttribute("role", isError ? "alert" : "status");
    el("storage-warning").hidden = !warning;
    el("storage-warning").textContent = copy.storageUnavailable;
    el("cancel").hidden = !busy;
    el("cancel").disabled = status === "cancelling";
    el("progress").hidden = !busy;
    el("progress").setAttribute(
      "aria-label",
      copy[progress?.phase] || copy.rendering,
    );
    if (progress?.value === null) el("progress").removeAttribute("value");
    else el("progress").value = progress?.value || 0;
    for (const id of [
      "save",
      "json",
      "load",
      "delete",
      "file",
      "import",
      "list",
    ])
      el(id).disabled = loading || receiving;
    for (const id of ["render", "bars"])
      el(id).disabled =
        busy || loading || receiving || (id === "render" && !audioReady());
    el("load").disabled = loading || receiving || !el("list").value;
    el("delete").disabled = loading || receiving || !el("list").value;
    el("result").hidden = !file;
    el("filename").textContent = file?.name || "";
    el("download").disabled = !file;
    el("share").disabled = !file || sharing;
    el("share").textContent =
      copy[file && delivery.canShare(file) ? "share" : "shareDownload"];
    if (focusReturn && !busy && !loading) {
      const { owner, target } = focusReturn;
      focusReturn = null;
      if (
        (document.activeElement === owner ||
          unfocused(document.activeElement)) &&
        !target.disabled &&
        !target.hidden
      )
        target.focus({ focusVisible: true });
    }
  }
  function localize() {
    copy = projectMessages[document.documentElement.lang] || projectMessages.id;
    panel
      .querySelectorAll("[data-project-copy]")
      .forEach((node) => (node.textContent = copy[node.dataset.projectCopy]));
    el("title").placeholder = copy.untitled;
    if (el("list").options[0]) el("list").options[0].textContent = copy.choose;
    render();
  }
  function refreshList(selected = "") {
    const options = store.read();
    el("list").replaceChildren(new Option(copy.choose, ""));
    for (const item of options)
      el("list").append(new Option(item.project.title, item.id));
    el("list").value = selected;
    render();
  }
  function saveDraft(project) {
    try {
      store.saveDraft(project);
      warning = false;
    } catch {
      warning = true;
      draftEnabled = false;
      render();
    }
  }
  function update() {
    if (disposed || loading || receiving) return;
    let project;
    try {
      project = current();
    } catch {
      return;
    }
    const signature = JSON.stringify(project);
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (file && fileKey !== wavSnapshotKey(project)) {
      file = null;
      notify("wavChanged");
    }
    if (draftEnabled) saveDraft(project);
  }
  async function guarded(fn) {
    try {
      await fn();
    } catch (error) {
      notify(error.code || "exportFailed", true);
    }
  }
  async function apply(project, code) {
    loading = true;
    file = null;
    render();
    try {
      const pending = applyBeatboxProject(engine, project, catalog);
      el("title").value = project.title;
      el("bars").value = String(project.export.bars);
      document.querySelector("#bb-volume").value = String(
        project.master.volume,
      );
      const snapshot = current();
      lastSignature = JSON.stringify(snapshot);
      // Incoming transfers already commit the draft before applying it.
      if (!receiving && (code === "imported" || code === "loaded")) {
        draftEnabled = true;
        saveDraft(snapshot);
      }
      onChange();
      await pending;
      if (disposed) return;
      notify(code);
    } finally {
      loading = false;
      render();
    }
  }
  let ready = Promise.resolve();
  localize();
  try {
    lastSignature = JSON.stringify(current());
    refreshList();
    const draft = store.readDraft();
    if (draft) {
      ready = guarded(() => apply(draft, "recovered"));
    }
  } catch {
    warning = true;
    draftEnabled = false;
    render();
  }
  listen(
    el("save"),
    "click",
    () =>
      void guarded(() => {
        const id = store.save(current());
        refreshList(id);
        trackEvent("project_saved");
        notify("saved");
      }),
  );
  listen(
    el("load"),
    "click",
    () =>
      void guarded(async () => {
        const id = el("list").value;
        let selected;
        try {
          selected = store.load(id);
        } catch (error) {
          refreshList();
          throw error;
        }
        if (
          !globalThis.confirm(
            copy.loadConfirm.replace("{title}", () => selected.title),
          )
        ) {
          notify("loadCancelled");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (disposed) return;
        let project;
        try {
          project = store.load(id, selected);
        } catch (error) {
          refreshList();
          throw error;
        }
        await apply(project, "loaded");
      }),
  );
  listen(
    el("delete"),
    "click",
    () =>
      void guarded(async () => {
        const id = el("list").value,
          selected = store.load(id);
        if (
          !globalThis.confirm(
            copy.deleteConfirm.replace("{title}", () => selected.title),
          )
        )
          return;
        // Let queued cross-tab storage changes arrive after the native prompt.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (disposed) return;
        try {
          store.remove(id, selected);
        } catch (error) {
          refreshList();
          throw error;
        }
        refreshList();
        notify("deleted");
      }),
  );
  listen(el("list"), "change", render);
  listen(el("title"), "input", update);
  listen(el("bars"), "change", update);
  listen(
    el("json"),
    "click",
    () =>
      void guarded(() => {
        const project = current();
        delivery.download(
          new Blob([serializeProject(project, catalog)], {
            type: "application/json",
          }),
          safeFilename(project.title, "perkusi.json"),
        );
        notify("projectDownloaded");
      }),
  );
  listen(el("import"), "click", () => el("file").click());
  listen(
    el("file"),
    "change",
    () =>
      void guarded(async () => {
        const input = el("file"),
          picked = input.files[0];
        input.value = "";
        if (!picked) return;
        loading = true;
        render();
        try {
          const project = await readProjectFile(picked, catalog);
          if (!disposed) await apply(project, "imported");
        } finally {
          loading = false;
          render();
        }
      }),
  );
  listen(
    el("render"),
    "click",
    () =>
      void guarded(async () => {
        if (!audioReady() || busy || loading || receiving) return;
        const project = current();
        busy = true;
        const key = wavSnapshotKey(project);
        file = null;
        progress = { phase: "loading", value: 0 };
        notify("loading");
        try {
          const result = await exporter.render(project, (p) => {
            if (disposed) return;
            progress = p;
            if (status !== "cancelling") status = p.phase;
            render();
          });
          if (disposed) return;
          if (wavSnapshotKey(current()) !== key) {
            notify("wavChanged");
            return;
          }
          file = new File(
            [result.blob],
            safeFilename(
              project.title + "-" + project.export.bars + "-bars",
              "wav",
            ),
            { type: "audio/wav" },
          );
          fileKey = key;
          trackEvent("export_succeeded");
          notify("exportReady");
        } catch (error) {
          if (!disposed) {
            if (error.code !== "cancelled")
              trackEvent("export_failed", exportFailureCategory(error.code));
            notify(error.code || "exportFailed", error.code !== "cancelled");
          }
        } finally {
          busy = false;
          progress = null;
          render();
        }
      }),
  );
  listen(el("cancel"), "click", () => {
    exporter.cancel();
    notify("cancelling");
  });
  listen(
    el("download"),
    "click",
    () =>
      void guarded(() => {
        update();
        if (!file) return;
        delivery.download(file, file.name);
        notify("downloaded");
      }),
  );
  listen(
    el("share"),
    "click",
    () =>
      void guarded(async () => {
        update();
        if (!file) return;
        sharing = true;
        render();
        try {
          notify(await delivery.share(file));
        } finally {
          sharing = false;
          render();
        }
      }),
  );
  listen(document, "perkusi:locale", localize);
  function dispose() {
    if (disposed) return;
    disposed = true;
    exporter.dispose();
    delivery.dispose();
    file = null;
    listeners.forEach((remove) => remove());
  }
  return {
    current,
    ready,
    setReceiving(value) {
      receiving = value;
      el("title").disabled = value;
      render();
    },
    applyTransferred(project) {
      draftEnabled = true;
      warning = false;
      return apply(project, "loaded");
    },
    apply: (project) => apply(project, "loaded"),
    update,
    render,
    dispose,
    store,
    exporter,
    delivery,
    snapshot: () => ({
      busy,
      loading: loading || receiving,
      sharing,
      status,
      fileName: file?.name || null,
      objectURLs: delivery.urls.size,
    }),
  };
}
