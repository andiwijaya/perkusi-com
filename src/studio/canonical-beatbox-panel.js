import {
  canonicalBeatboxCopy,
  stageCanonicalBeatboxCopy,
} from "../project/canonical-beatbox-copy.js";
import { CanonicalHandoffStore } from "../project/canonical-handoff.js";
import { fail } from "../project/instrument-contract.js";

export function attachCanonicalBeatboxPanel({
  app,
  root,
  registry,
  memory,
  locale,
}) {
  const en = locale === "en",
    life = new AbortController(),
    store = new CanonicalHandoffStore({ memory }),
    el = (tag, text = "") => {
      const e = document.createElement(tag);
      e.textContent = text;
      return e;
    },
    box = el("section"),
    button = el("button", en ? "Open in Beatbox" : "Buka di Beatbox"),
    status = el("p"),
    dialog = el("dialog"),
    title = el("h2", en ? "Continue in Beatbox" : "Lanjutkan di Beatbox"),
    body = el("p"),
    omissions = el("p"),
    backup = el(
      "p",
      en
        ? "The complete Studio project, including recordings, will be preserved locally. An existing Beatbox draft is backed up before the copy opens paused. You can download both after switching."
        : "Proyek Studio lengkap beserta rekamannya akan dicadangkan lokal. Draft Beatbox yang ada dicadangkan sebelum salinan dibuka dalam keadaan jeda. Keduanya bisa diunduh setelah berpindah.",
    ),
    go = el("button"),
    cancel = el("button", en ? "Cancel" : "Batal"),
    next = el("a", en ? "Continue to Beatbox" : "Lanjutkan ke Beatbox");
  box.className = "st-panel";
  box.dataset.canonicalBeatbox = "";
  button.type = go.type = cancel.type = "button";
  button.dataset.canEdit = "";
  button.dataset.canGlobal = "";
  button.dataset.canonicalBeatboxReview = "";
  go.dataset.canonicalBeatboxConfirm = "";
  cancel.dataset.canonicalBeatboxCancel = "";
  status.setAttribute("role", "status");
  title.id = "canonical-beatbox-title";
  dialog.setAttribute("aria-labelledby", title.id);
  dialog.className = "mode-dialog";
  next.hidden = true;
  next.dataset.route = "beatbox";
  dialog.append(title, body, omissions, backup, go, cancel);
  box.append(button, status, next, dialog);
  root.querySelector(".st-project").after(box);
  let review = null,
    closed = false,
    busy = false,
    archiveId = null;
  const listen = (node, event, fn) =>
    node.addEventListener(event, fn, { signal: life.signal });
  const error = (e) => {
    status.textContent =
      e.code === "beatboxSourceRequired"
        ? en
          ? "Choose a rhythm source before creating a Beatbox copy."
          : "Pilih sumber irama sebelum membuat salinan Beatbox."
        : en
          ? "The transfer did not finish. Your current Studio and Beatbox drafts remain available. Download the complete project or retry; saved transfers are in the recovery list."
          : "Transfer belum selesai. Draft Studio dan Beatbox tetap tersedia. Unduh proyek lengkap atau coba lagi; transfer tersimpan ada di daftar pemulihan.";
  };
  const valid = () => {
    if (
      closed ||
      !review ||
      app.editor.snapshot().revision !== review.revision ||
      app.readSource() !== review.sourceId
    )
      fail("draftConflict");
  };
  listen(button, "click", () => {
    if (closed || busy || app.snapshot().pendingTasks) return;
    busy = true;
    void app
      .transaction(async () => {
        const s = app.editor.snapshot(),
          sourceId = app.readSource(),
          result = await canonicalBeatboxCopy(s.project, {
            registry,
            sourceId,
          });
        if (closed || app.editor.snapshot().revision !== s.revision)
          fail("draftConflict");
        review = { ...result, sourceId, revision: s.revision };
        archiveId = crypto.randomUUID();
        next.hidden = true;
        body.textContent = result.compatible
          ? en
            ? "Layers, variations and master volume are preserved at 96 BPM."
            : "Layer, variasi, dan volume master dipertahankan pada 96 BPM."
          : en
            ? `Derived copy from ${result.sourceTitle}, pattern ${result.patternName}: ${result.candidate.tracks.filter((t) => t.enabled).length} active loops, 4 bars, 96 BPM.`
            : `Salinan turunan dari ${result.sourceTitle}, pola ${result.patternName}: ${result.candidate.tracks.filter((t) => t.enabled).length} loop aktif, 4 bar, 96 BPM.`;
        omissions.hidden = result.compatible;
        omissions.textContent = en
          ? "Only the selected pattern's audible Beatbox loops are copied. Drum steps, Bilah/native instruments, recordings, other sources/patterns, arrangement, tempo/swing, phase and effects are left out. Per-layer levels and pan reset; the copy uses Studio's master volume up to Beatbox's existing 75% maximum. Muted or excluded layers stay off."
          : "Hanya loop Beatbox terdengar dari pola terpilih yang disalin. Step drum, Bilah/instrumen, rekaman, sumber/pola lain, susunan lagu, tempo/swing, fase, dan efek tidak ikut. Level per layer dan pan direset; salinan memakai volume master Studio hingga batas Beatbox yang sudah ada, 75%. Layer yang dibisukan atau tidak terpilih tetap nonaktif.";
        go.textContent = result.compatible
          ? en
            ? "Continue"
            : "Lanjutkan"
          : en
            ? "Create derived copy"
            : "Buat salinan turunan";
        dialog.showModal();
        cancel.focus();
      })
      .catch(error)
      .finally(() => {
        busy = false;
      });
  });
  listen(cancel, "click", () => dialog.close());
  listen(dialog, "close", () => button.focus());
  listen(go, "click", () => {
    if (closed || busy || app.snapshot().pendingTasks) return;
    busy = true;
    go.disabled = cancel.disabled = true;
    void app
      .transaction(async () => {
        valid();
        const result = await stageCanonicalBeatboxCopy(
          app.editor.snapshot().bundle,
          {
            registry,
            memory,
            store,
            sourceId: review.sourceId,
            archiveId,
            check: valid,
          },
        );
        valid();
        next.href =
          (en ? "/en" : "") + "/beatbox/?canonicalOrigin=" + result.archive.id;
        next.hidden = false;
        dialog.close();
        status.textContent = en
          ? "Complete source preserved. Continue to the paused copy."
          : "Sumber lengkap dicadangkan. Lanjutkan ke salinan dalam keadaan jeda.";
      })
      .then(() => {
        if (!closed) next.click();
      })
      .catch((e) => {
        dialog.close();
        error(e);
      })
      .finally(() => {
        busy = false;
        go.disabled = cancel.disabled = false;
      });
  });
  return {
    dispose() {
      closed = true;
      life.abort();
      store.close();
      dialog.close();
    },
  };
}
