import {
  CanonicalHandoffStore,
  canonicalBundleHasInput,
} from "../project/canonical-handoff.js";
import { exportCanonicalPackage } from "../project/canonical-package.js";
import { hashBytes } from "../project/canonical-data.js";
import { fail } from "../project/instrument-contract.js";
const copy = {
  id: {
    title: "Lanjutkan proyek di Rhythm Studio",
    intro:
      "Buka sebagai salinan atau gabungkan ke bagian aktif. Proyek Studio saat ini dicadangkan terlebih dahulu; sumber asli tetap tersedia.",
    open: "Buka sebagai salinan",
    merge: "Gabungkan ke bagian aktif",
    source: "Unduh berkas sumber",
    previous: "Unduh proyek sebelum transfer",
    defer: "Tunda",
    resume: "Periksa lagi",
    finish: "Simpan dan selesaikan",
    done: "Transfer tersimpan. Sumber asli dan cadangan proyek sebelumnya tetap tersedia.",
    waiting: "Berkas belum diterapkan. Proyek aktif tidak berubah.",
    applied:
      "Berkas sumber sudah tersimpan dalam proyek ini. Simpan untuk menandai transfer diterima; Undur dapat mengubah materi yang aktif.",
    error:
      "Transfer belum selesai. Proyek dan berkas sumber tetap tersedia. Periksa perubahan atau coba lagi.",
    window: "Jendela Loop",
    bars: "bar",
    missing:
      "Berkas transfer tidak tersedia. Kembali ke sumber atau impor berkasnya.",
  },
  en: {
    title: "Continue in Rhythm Studio",
    intro:
      "Open as a copy or merge into the active section. The current Studio project is backed up first; original sources remain available.",
    open: "Open as a copy",
    merge: "Merge into active section",
    source: "Download source file",
    previous: "Download project before transfer",
    defer: "Later",
    resume: "Check again",
    finish: "Save and finish",
    done: "Transfer saved. The original source and previous project backup remain available.",
    waiting: "File not applied. Your active project is unchanged.",
    applied:
      "The source file is retained in this project. Save to acknowledge receipt; Undo may change which material is active.",
    error:
      "Transfer is unfinished. Your project and source file remain available. Review changes or retry.",
    window: "Loop window",
    bars: "bars",
    missing:
      "Transfer file is unavailable. Return to its source or import the file.",
  },
};
export async function attachCanonicalHandoff({
  app,
  root,
  memory,
  id,
  locale = "id",
}) {
  const t = copy[locale] ?? copy.id,
    store = new CanonicalHandoffStore({ memory }),
    life = new AbortController(),
    pending = new Set();
  let reader = null,
    info = null,
    closed = false,
    busy = false,
    deferred = false,
    phase = "loading";
  const el = (tag, text = "") => {
      const e = document.createElement(tag);
      e.textContent = text;
      return e;
    },
    box = el("section"),
    status = el("p"),
    actions = el("div"),
    windowLabel = el("label", t.window + " "),
    windowSelect = el("select");
  box.className = "st-panel";
  box.dataset.canonicalHandoff = "";
  status.setAttribute("role", "status");
  box.append(el("h2", t.title), el("p", t.intro), status, windowLabel, actions);
  root.querySelector(".st-transport").before(box);
  for (const n of [4, 8]) {
    const o = el("option", n + " " + t.bars);
    o.value = n;
    windowSelect.append(o);
  }
  windowLabel.append(windowSelect);
  const check = () => {
    if (closed) fail("cancelled");
  };
  const projectHash = async (project) => {
    const text = JSON.stringify(project),
      held = memory.reserve(
        text.length * 6 + 8192,
        "canonical/handoff-document-hash",
      );
    try {
      return await hashBytes(new TextEncoder().encode(text));
    } finally {
      held.release();
    }
  };
  const button = (key, fn) => {
    const b = el("button", t[key]);
    b.type = "button";
    b.dataset.handoffAction = key;
    b.addEventListener("click", () => void run(fn), { signal: life.signal });
    actions.append(b);
    return b;
  };
  const open = button("open", () => apply("replace")),
    merge = button("merge", () => apply("add")),
    finish = button("finish", complete),
    source = button("source", downloadSource),
    previous = button("previous", downloadPrevious),
    defer = button("defer", async () => {
      if (deferred) await receive();
      else {
        reader?.release();
        reader = null;
        deferred = true;
        phase = "deferred";
        render();
      }
    });
  function render(message) {
    if (closed) return;
    const has =
      info &&
      canonicalBundleHasInput(app.editor.snapshot().bundle, info.sha256);
    if (info?.accepted) phase = "accepted";
    else if (deferred) phase = "deferred";
    else if (info) phase = has ? "applied" : reader ? "ready" : "error";
    box.dataset.handoffState = phase;
    if (message !== undefined || status.getAttribute("role") !== "alert")
      status.textContent =
        message ??
        (phase === "accepted"
          ? t.done
          : phase === "applied"
            ? t.applied
            : t.waiting) + (info ? " " + info.title : "");
    open.disabled = merge.disabled =
      busy ||
      deferred ||
      phase === "accepted" ||
      (phase === "applied" && !!info?.prepared) ||
      !reader;
    finish.hidden = phase !== "applied";
    finish.disabled = busy;
    source.disabled = busy || !info;
    previous.disabled = busy || !info?.prepared?.backupId;
    defer.disabled = busy;
    defer.textContent = deferred ? t.resume : t.defer;
    windowLabel.hidden = info?.kind !== "loop";
    windowSelect.disabled = busy || phase === "accepted";
  }
  function run(fn) {
    if (busy || closed) return;
    busy = true;
    delete box.dataset.handoffError;
    status.setAttribute("role", "status");
    render();
    const task = app.transaction(async () => {
      try {
        check();
        await fn();
      } catch (e) {
        if (!closed) {
          box.dataset.handoffError = e.code ?? e.message;
          status.setAttribute("role", "alert");
          render(t.error);
        }
      } finally {
        busy = false;
        render(
          status.getAttribute("role") === "alert"
            ? status.textContent
            : undefined,
        );
      }
    });
    pending.add(task);
    task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  }
  async function receive() {
    const next = await store.read(id);
    if (closed) {
      next.release();
      return;
    }
    reader?.release();
    reader = next;
    info = next.info;
    deferred = false;
    phase = info.accepted ? "accepted" : "ready";
    status.setAttribute("role", "status");
    render();
  }
  async function backupBefore(mode) {
    const before = app.editor.snapshot().bundle,
      baseSHA256 = await projectHash(before.project);
    check();
    info = await store.prepare(id, info.sha256, {
      backupId: "handoff-" + crypto.randomUUID(),
      baseSHA256,
      mode,
    });
    check();
    const found = await app.storage.load({
      documentId: info.prepared.backupId,
    });
    if (found) {
      try {
        check();
        if ((await projectHash(found.bundle.project)) !== baseSHA256)
          fail("handoffTargetChanged");
      } finally {
        found.bundle.dispose();
      }
    } else {
      check();
      await app.storage.save(before, {
        documentId: info.prepared.backupId,
        expected: null,
      });
    }
    check();
  }
  async function apply(mode) {
    status.setAttribute("role", "status");
    check();
    if (!reader || info.accepted) fail("handoffAlreadyAccepted");
    await backupBefore(mode);
    check();
    await app.workflow.importFile(reader.blob, {
      mode,
      bars: Number(windowSelect.value),
    });
    check();
    phase = "applied";
    await completeOwned();
  }
  async function completeOwned() {
    check();
    if (!canonicalBundleHasInput(app.editor.snapshot().bundle, info.sha256))
      fail("handoffNotApplied");
    const revision = app.editor.snapshot().revision;
    await app.workflow.save();
    check();
    if (app.editor.snapshot().revision !== revision) fail("draftConflict");
    const projectSHA256 = await projectHash(app.editor.snapshot().project);
    check();
    info = await store.acknowledge(id, info.sha256, {
      projectSHA256,
      revision: app.workflow.snapshot().savedRevision,
      acceptedAt: Date.now(),
    });
    check();
    phase = "accepted";
    reader?.release();
    reader = null;
    status.setAttribute("role", "status");
  }
  async function complete() {
    await completeOwned();
  }
  async function downloadSource() {
    const held = await store.read(id);
    try {
      check();
      await app.deliver(held.blob, info.kind + "-source.perkusi");
    } finally {
      held.release();
    }
  }
  async function downloadPrevious() {
    if (!info?.prepared?.backupId) fail("handoffMissing");
    const previous = await app.storage.load({
      documentId: info.prepared.backupId,
    });
    let out;
    try {
      check();
      if (!previous) fail("handoffMissing");
      out = await exportCanonicalPackage(previous.bundle, { memory });
      check();
      await app.deliver(out.blob, "rhythm-studio-before-transfer.perkusi");
    } finally {
      out?.release();
      previous?.bundle.dispose();
    }
  }
  try {
    await receive();
  } catch (e) {
    phase = "error";
    box.dataset.handoffError = e.code ?? e.message;
    status.setAttribute("role", "alert");
    render(t.missing);
  }
  const unsubscribe = app.subscribe(() => render());
  let closing;
  const dispose = () => {
    if (closing) return closing;
    closed = true;
    life.abort();
    unsubscribe();
    closing = (async () => {
      await Promise.allSettled([...pending]);
      reader?.release();
      reader = null;
      store.close();
    })();
    return closing;
  };
  window.addEventListener("pagehide", () => void dispose(), {
    once: true,
    signal: life.signal,
  });
  return Object.freeze({ dispose });
}
