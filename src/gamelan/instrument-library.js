import { InstrumentProjectStore } from "../project/instrument-store.js";
import { readinessCopy } from "./readiness-copy.js";

export function initInstrumentLibrary({
  host,
  session,
  locale,
  act,
  reportError,
  draftStore = null,
  immediateDraft = false,
}) {
  const store = new InstrumentProjectStore(session.registry);
  const drafts = draftStore ?? store;
  let sharedDraftAvailable = false;
  let pending = null,
    lastProject = session.project,
    closed = false,
    selected = "",
    info = "",
    timer = null,
    savedRows = [],
    renderedRows = null,
    renderedLocale = null;
  host.innerHTML =
    '<h2></h2><p></p><div class="toolbar"><button data-save></button><select aria-label=""></select><button data-load></button><button data-remove></button></div><output role="status"></output>';
  const $ = (selector) => host.querySelector(selector);
  function refreshRows() {
    try {
      savedRows = store.list();
      if (draftStore) sharedDraftAvailable = !!store.readDraft();
    } catch (error) {
      savedRows = [];
      reportError(error.code);
    }
  }
  try {
    const draft = drafts.readDraft();
    if (draft) session.importJSON(JSON.stringify(draft));
  } catch (error) {
    reportError(error.code);
  }
  refreshRows();
  lastProject = session.project;
  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return true;
    const project = pending;
    try {
      drafts.saveDraft(project);
      pending = null;
      info = "autosaved";
    } catch (error) {
      info = "draftError";
      reportError(error.code);
      return false;
    }
    return true;
  }
  function render() {
    const t = readinessCopy[locale()],
      snapshot = session.snapshot();
    $("h2").textContent = t.library;
    $("p").textContent = t.storageHelp;
    $("[data-save]").textContent = t.save;
    $("[data-load]").textContent = t.load;
    $("[data-remove]").textContent = t.remove;
    const select = $("select");
    select.setAttribute("aria-label", t.library);
    if (renderedRows !== savedRows || renderedLocale !== locale()) {
      renderedRows = savedRows;
      renderedLocale = locale();
      select.replaceChildren();
      for (const item of savedRows) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.project.composition.title;
        select.append(option);
      }
      if (savedRows.some((i) => i.id === selected)) select.value = selected;
      else selected = select.value;
    }
    const busy =
      snapshot.disposed ||
      snapshot.disposing ||
      snapshot.recording ||
      snapshot.armingRecord ||
      snapshot.exporting ||
      snapshot.status === "loading";
    $("[data-save]").disabled = busy;
    select.disabled = busy || !savedRows.length;
    $("[data-load]").disabled = busy || snapshot.replaying || !savedRows.length;
    $("[data-remove]").disabled = busy || !savedRows.length;
    $("output").textContent = info ? t[info] : "";
  }
  $("select").onchange = () => {
    selected = $("select").value;
  };
  $("[data-save]").onclick = () =>
    act(() => {
      flush();
      selected = store.save(session.project);
      refreshRows();
      info = "saved";
      render();
    });
  $("[data-load]").onclick = () =>
    act(() => {
      const value = store.load(selected);
      session.importJSON(JSON.stringify(value));
      info = "";
      render();
    });
  $("[data-remove]").onclick = () =>
    act(() => {
      if (!confirm(readinessCopy[locale()].deleteSaved)) return;
      store.remove(selected);
      refreshRows();
      render();
    });
  const unsubscribe = session.subscribe(() => {
    if (closed) return;
    if (session.project !== lastProject) {
      lastProject = session.project;
      pending = session.project;
      if (timer) clearTimeout(timer);
      if (immediateDraft) flush();
      else
        timer = setTimeout(() => {
          timer = null;
          flush();
          render();
        }, 350);
    }
    render();
  });
  return {
    render,
    flush,
    get hasPending() {
      return pending !== null;
    },
    get sharedDraftAvailable() {
      return sharedDraftAvailable;
    },
    readSharedDraft() {
      return store.readDraft();
    },
    close() {
      if (closed) return;
      flush();
      closed = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
