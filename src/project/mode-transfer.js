import {
  migrateProject,
  serializeProject,
  parseProject,
  ProjectError,
  MAX_PROJECT_BYTES,
} from "./schema.js";
import { fromBeatbox, toBeatbox, reverseReasons } from "./composition-model.js";
import { compositionRegistry } from "./studio-registry.js";
import { originalRegistry } from "./original-registry.js";
import { safeFilename } from "./files.js";
import { trackEvent } from "../analytics.js";
const KEY = "perkusi.mode-transfer.v3",
  MARKER = "perkusi.mode-transfer.pending.v3";
const copy = {
  id: {
    forward: "Lanjutkan di Studio",
    reverse: "Buka di Beatbox",
    title: "Lanjutkan ide musik",
    compatible:
      "Layer, variasi dan volume dipertahankan. Groove dimulai dalam keadaan jeda pada 96 BPM; ketuk Mainkan di halaman berikutnya.",
    incompatible:
      "Salinan Beatbox mempertahankan loop Beatbox yang aktif saja. Bagian di bawah ini tidak ikut. Tempo salinan menjadi 96 BPM; proyek Studio lengkap tetap tersimpan sebagai file asal.",
    kit: "Pilihan kit Studio",
    tempo: "Tempo atau swing",
    arrangement: "Susunan pola / durasi",
    drums: "Step drum kustom",
    notes: "Nada Bilah",
    kendhang: "Pukulan Kendhang Ciblon",
    mix: "Mix atau layer berbeda",
    patternLoops:
      "Pilihan loop berbeda antar pola; salinan hanya memakai pola terpilih",
    continue: "Lanjutkan",
    derived: "Buat salinan turunan",
    cancel: "Batal",
    backup: "Unduh proyek asal",
    preview: "Salinan: {layers} loop aktif, {bars} bar, 96 BPM.",
    destination:
      "Draft tujuan yang ada akan disimpan sebagai cadangan. Proyek asal dan draft cadangan dapat diunduh setelah pindah.",
    failure:
      "Tidak bisa menyimpan salinan dan cadangan di browser ini. Proyek saat ini tetap di sini; unduh file proyek untuk memindahkannya.",
    saved:
      "Proyek asal tersimpan. Unduh sebelum menutup atau membersihkan data browser.",
    empty: "Salinan ini tidak memiliki loop Beatbox aktif.",
    oldDraft: "Unduh draft cadangan terpilih",
    draftList: "Pilih draft cadangan",
    retention:
      "Cadangan tetap ada sampai kamu mengonfirmasi penghapusan. Maksimal 30 proyek asal dan draft gabungan, 256 KiB; perpindahan ditolak jika penuh.",
    clear: "Hapus cadangan perpindahan",
    clearConfirm:
      "Hapus semua cadangan perpindahan? Unduh proyek asal dan draft cadangan lebih dulu. Proyek saat ini dan simpanan biasa tetap ada.",
    recoveryFailure:
      "Perpindahan belum selesai. Draft saat ini dipertahankan; salinan tertunda tidak akan menimpa edit baru saat refresh. Unduh salinan perpindahan untuk mengimpornya jika kamu memilih mengganti draft, atau mulai perpindahan baru. Proyek asal dan cadangan tetap tersimpan.",
    copy: "Unduh salinan perpindahan",
  },
  en: {
    forward: "Continue in Studio",
    reverse: "Open in Beatbox",
    title: "Continue your musical idea",
    compatible:
      "Layers, variations and volume are preserved. The groove opens paused at 96 BPM; press Play on the next page.",
    incompatible:
      "The Beatbox copy keeps active Beatbox loops only. The parts below are left out. The copy uses 96 BPM; your complete Studio project is kept as the original file.",
    kit: "Studio kit selection",
    tempo: "Tempo or swing",
    arrangement: "Pattern arrangement / duration",
    drums: "Custom drum steps",
    notes: "Bilah notes",
    kendhang: "Kendhang Ciblon hits",
    mix: "Different mix or layers",
    patternLoops:
      "Different loops across patterns; the copy uses the selected pattern only",
    continue: "Continue",
    derived: "Create derived copy",
    cancel: "Cancel",
    backup: "Download original project",
    preview: "Copy: {layers} active loops, {bars} bars, 96 BPM.",
    destination:
      "An existing destination draft will be kept as a backup. You can download the original project and draft backup after switching.",
    failure:
      "This browser could not save the copy and its backup. Your current project stays here; download its project file to move it.",
    saved:
      "Your original project is kept. Download it before closing or clearing browser data.",
    empty: "This copy has no active Beatbox loops.",
    oldDraft: "Download selected draft backup",
    draftList: "Choose a draft backup",
    retention:
      "Backups remain until you confirm clearing them. Up to 30 originals and drafts combined, 256 KiB; switching is refused when full.",
    clear: "Clear transfer backups",
    clearConfirm:
      "Delete all transfer backups? Download originals and the draft backup first. Your current project and regular saved projects remain.",
    recoveryFailure:
      "The transfer did not finish. Your current draft is kept; the pending copy will not overwrite newer edits on reload. Download the transfer copy to import it if you choose to replace the draft, or start a new transfer. Originals and backups are kept.",
    copy: "Download transfer copy",
  },
};
const language = () => (document.documentElement.lang === "en" ? "en" : "id");
function read(storage) {
  const raw = storage.getItem(KEY);
  if (!raw) return null;
  try {
    if (new TextEncoder().encode(raw).length > 256 * 1024) throw Error();
    const d = JSON.parse(raw);
    if (
      ![3, 4].includes(d.version) ||
      Object.keys(d).sort().join() !==
        (d.version === 3
          ? "candidate,destinationDraft,id,original,originals,pending,target,version"
          : "candidate,destinationDraft,drafts,id,original,originals,pending,target,version") ||
      !["studio", "beatbox"].includes(d.target) ||
      typeof d.pending !== "boolean" ||
      typeof d.id !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(d.id) ||
      typeof d.destinationDraft !== "string"
    )
      throw Error();
    if (
      !Array.isArray(d.originals) ||
      !d.originals.length ||
      d.originals.length > 30
    )
      throw Error();
    if (d.version === 4) {
      if (!Array.isArray(d.drafts) || d.originals.length + d.drafts.length > 30)
        throw Error();
      const seen = new Set();
      for (const draft of d.drafts) {
        if (
          !draft ||
          Object.keys(draft).sort().join() !== "key,raw,target" ||
          !["studio", "beatbox"].includes(draft.target) ||
          !draftKeys(draft.target).includes(draft.key) ||
          typeof draft.raw !== "string" ||
          !draft.raw
        )
          throw Error();
        const identity = JSON.stringify([draft.key, draft.raw]);
        if (seen.has(identity)) throw Error();
        seen.add(identity);
      }
      if (
        d.destinationDraft &&
        !d.drafts.some(
          (x) => x.target === d.target && x.raw === d.destinationDraft,
        )
      )
        throw Error();
    }
    for (const p of d.originals)
      migrateProject(
        p,
        p.schemaVersion === 1 ? originalRegistry : compositionRegistry,
      );
    migrateProject(
      d.original,
      d.original.schemaVersion === 1 ? originalRegistry : compositionRegistry,
    );
    migrateProject(
      d.candidate,
      d.target === "studio" ? compositionRegistry : originalRegistry,
    );
    return d;
  } catch {
    throw new ProjectError("storageUnavailable");
  }
}
function draftKeys(target) {
  return target === "studio"
    ? ["perkusi.draft.studio.v3", "perkusi.draft.studio.v2"]
    : ["perkusi.draft.v1"];
}
function retainedDrafts(record) {
  if (!record) return [];
  if (record.version === 4) return record.drafts;
  return record.destinationDraft
    ? [
        {
          target: record.target,
          key: draftKeys(record.target)[0],
          raw: record.destinationDraft,
        },
      ]
    : [];
}
export function prepareTransfer(
  original,
  target,
  {
    storage = globalThis.localStorage,
    session = globalThis.sessionStorage,
    makeId = () => crypto.randomUUID(),
  } = {},
) {
  if (!["studio", "beatbox"].includes(target))
    throw new ProjectError("invalidProject");
  const previous = read(storage);
  const old = storage.getItem(KEY),
    oldMarker = session.getItem(MARKER);
  const valid = migrateProject(
    original,
    original.schemaVersion === 1 ? originalRegistry : compositionRegistry,
  );
  const candidate =
    target === "studio"
      ? fromBeatbox(valid)
      : valid.schemaVersion === 1
        ? structuredClone(valid)
        : toBeatbox(valid, true);
  const drafts = [...retainedDrafts(previous)];
  const destinationKey =
    draftKeys(target).find((key) => storage.getItem(key)) ||
    draftKeys(target)[0];
  const destinationDraft = storage.getItem(destinationKey) || "";
  if (
    destinationDraft &&
    !drafts.some((d) => d.key === destinationKey && d.raw === destinationDraft)
  )
    drafts.push({ target, key: destinationKey, raw: destinationDraft });
  const originals = [...(previous?.originals || [])];
  if (!originals.some((p) => JSON.stringify(p) === JSON.stringify(valid)))
    originals.push(valid);
  if (originals.length + drafts.length > 30)
    throw new ProjectError("storageFull");
  const record = {
    version: 4,
    originals,
    drafts,
    id: makeId(),
    target,
    pending: true,
    original: valid,
    candidate,
    destinationDraft,
  };
  if (!/^[a-z0-9-]{1,64}$/.test(record.id))
    throw new ProjectError("storageUnavailable");
  const raw = JSON.stringify(record);
  if (new TextEncoder().encode(raw).length + 1 > 256 * 1024)
    throw new ProjectError("storageFull");
  try {
    session.setItem(MARKER, record.id);
    storage.setItem(KEY, raw);
  } catch {
    try {
      old === null ? storage.removeItem(KEY) : storage.setItem(KEY, old);
    } catch {
      /* A failed local rollback must not prevent restoring the session marker. */
    }
    try {
      oldMarker === null
        ? session.removeItem(MARKER)
        : session.setItem(MARKER, oldMarker);
    } catch {
      /* Preserve the complete original in the still-open source UI. */
    }
    throw new ProjectError("storageUnavailable");
  }
  return record;
}
export const MAX_TRANSFER_RECEIPT_BYTES = MAX_PROJECT_BYTES + 1024;
export const transferReceiptKey = (target) =>
  `perkusi.mode-transfer.receipt.${target}.v1`;
const targetCatalog = (target) =>
  target === "studio" ? compositionRegistry : originalRegistry;
function fingerprint(project) {
  const sorted = (v) =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((key) => [key, sorted(v[key])]),
          )
        : v;
  return JSON.stringify(sorted(project));
}
function sameProject(raw, project, target) {
  try {
    return (
      fingerprint(parseProject(raw, targetCatalog(target))) ===
      fingerprint(project)
    );
  } catch {
    return false;
  }
}
function sameDraft(raw, baseline, target) {
  if (raw === baseline) return true;
  try {
    return sameProject(
      raw,
      parseProject(baseline, targetCatalog(target)),
      target,
    );
  } catch {
    return false;
  }
}
function readReceipt(storage, target) {
  const raw = storage.getItem(transferReceiptKey(target));
  if (!raw) return null;
  try {
    if (new TextEncoder().encode(raw).length > MAX_TRANSFER_RECEIPT_BYTES)
      throw Error();
    const r = JSON.parse(raw);
    if (
      Object.keys(r).sort().join() !== "candidate,id,state,target,version" ||
      r.version !== 1 ||
      r.target !== target ||
      typeof r.id !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(r.id) ||
      !["reserved", "applied", "blocked"].includes(r.state)
    )
      throw Error();
    return {
      ...r,
      candidate: migrateProject(r.candidate, targetCatalog(target)),
    };
  } catch {
    throw new ProjectError("storageUnavailable");
  }
}
function writeReceipt(storage, target, id, candidate, state) {
  const raw = JSON.stringify({ version: 1, id, target, state, candidate });
  if (new TextEncoder().encode(raw).length > MAX_TRANSFER_RECEIPT_BYTES)
    throw new ProjectError("storageFull");
  storage.setItem(transferReceiptKey(target), raw);
}
function acknowledgmentRaw(record) {
  const raw = JSON.stringify({ ...record, pending: false });
  if (new TextEncoder().encode(raw).length > 256 * 1024)
    throw new ProjectError("storageFull");
  return raw;
}
export function incomingTransfer(
  target,
  storage = globalThis.localStorage,
  session = globalThis.sessionStorage,
) {
  const marker = session.getItem(MARKER);
  if (!marker) return null;
  const record = read(storage);
  if (!record || record.id !== marker || record.target !== target)
    throw new ProjectError("storageUnavailable");
  const project = migrateProject(record.candidate, targetCatalog(target));
  const signature = fingerprint(project);
  function latest() {
    const r = read(storage);
    if (
      !r ||
      r.id !== record.id ||
      r.target !== target ||
      fingerprint(migrateProject(r.candidate, targetCatalog(target))) !==
        signature
    )
      throw new ProjectError("storageUnavailable");
    const currentMarker = session.getItem(MARKER);
    if (currentMarker !== record.id && !(currentMarker === null && !r.pending))
      throw new ProjectError("storageUnavailable");
    return r;
  }
  function acknowledge() {
    const r = latest(),
      wasPending = r.pending;
    if (wasPending) storage.setItem(KEY, acknowledgmentRaw(r));
    const currentMarker = session.getItem(MARKER);
    if (currentMarker === record.id) session.removeItem(MARKER);
    if (wasPending && target === "studio") trackEvent("beatbox_to_studio");
  }
  async function performDelivery(apply) {
    const r = latest();
    // Already acknowledged + stale marker: cleanup only; never reapply a candidate.
    if (!r.pending) {
      acknowledge();
      return { applied: false };
    }
    // Completion that cannot fit is refused BEFORE exposing or persisting a copy.
    acknowledgmentRaw(r);
    const receipt = readReceipt(storage, target);
    const keys = draftKeys(target),
      currentRaw =
        keys.map((key) => storage.getItem(key)).find(Boolean) || null;
    if (receipt?.id === record.id) {
      if (fingerprint(receipt.candidate) !== signature)
        throw new ProjectError("storageUnavailable");
      // A reserved write may have persisted its project before interruption.
      // The ordinary owner already restored that project, so metadata can finish without apply.
      if (currentRaw && sameProject(currentRaw, project, target)) {
        if (receipt.state !== "applied")
          writeReceipt(storage, target, record.id, project, "applied");
        acknowledge();
        return { applied: false };
      }
      if (receipt.state === "applied" && currentRaw) {
        parseProject(currentRaw, targetCatalog(target));
        acknowledge();
        return { applied: false }; // keep all newer edits byte-for-byte
      }
      throw new ProjectError("storageUnavailable"); // reserved/blocked: explicit recovery, no replay
    }
    if (currentRaw && sameProject(currentRaw, project, target)) {
      writeReceipt(storage, target, record.id, project, "applied");
      acknowledge();
      return { applied: false }; // legacy copy already delivered
    }
    if (currentRaw && !sameDraft(currentRaw, r.destinationDraft, target)) {
      writeReceipt(storage, target, record.id, project, "blocked");
      throw new ProjectError("storageUnavailable"); // newer destination work is authoritative
    }
    // One bounded receipt per mode precedes every possible editable application.
    // It survives ack/write/refresh failures and is never evicted to replay the copy.
    writeReceipt(storage, target, record.id, project, "reserved");
    storage.setItem(keys[0], JSON.stringify(project));
    await apply(structuredClone(project));
    latest();
    writeReceipt(storage, target, record.id, project, "applied");
    acknowledge();
    return { applied: true };
  }
  let deliveryPromise;
  const deliver = (apply) => (deliveryPromise ||= performDelivery(apply));
  return {
    id: record.id,
    pending: record.pending,
    project: structuredClone(project),
    check: latest,
    acknowledge,
    deliver,
  };
}
export function initModeTransfer({
  root,
  mode,
  current,
  apply,
  delivery,
  locked = () => false,
  beforeNavigate = () => {},
  beforeReceive = () => {},
  onReceiving = () => {},
}) {
  const panel = document.createElement("section");
  panel.className = "mode-transfer project-panel";
  const button = document.createElement("button"),
    status = document.createElement("p"),
    backup = document.createElement("button"),
    oldDraft = document.createElement("button"),
    candidateCopy = document.createElement("button"),
    originalList = document.createElement("select");
  const draftList = document.createElement("select");
  draftList.id = "mode-draft-list";
  originalList.id = "mode-original-list";
  button.type = backup.type = oldDraft.type = candidateCopy.type = "button";
  button.id = "mode-transfer";
  backup.id = "mode-original";
  oldDraft.id = "mode-draft-backup";
  candidateCopy.id = "mode-candidate-copy";
  status.setAttribute("role", "status");
  panel.append(
    button,
    status,
    originalList,
    backup,
    draftList,
    oldDraft,
    candidateCopy,
  );
  root.append(panel);
  const clear = document.createElement("button");
  clear.type = "button";
  clear.id = "mode-clear-backups";
  panel.append(clear);
  const dialog = document.createElement("dialog");
  dialog.className = "mode-dialog";
  dialog.setAttribute("aria-labelledby", "mode-title");
  const title = document.createElement("h2");
  title.id = "mode-title";
  const body = document.createElement("p"),
    reasons = document.createElement("ul"),
    destination = document.createElement("p"),
    go = document.createElement("button"),
    cancel = document.createElement("button");
  go.type = cancel.type = "button";
  go.id = "mode-confirm";
  cancel.id = "mode-cancel";
  dialog.append(title, body, reasons, destination, go, cancel);
  panel.append(dialog);
  let original,
    why = [],
    failed = false;
  const life = new AbortController();
  const listen = (el, event, fn) =>
    el.addEventListener(event, fn, { signal: life.signal });
  function localize() {
    const c = copy[language()];
    button.textContent = c[mode === "beatbox" ? "forward" : "reverse"];
    title.textContent = c.title;
    body.textContent = c[why.length ? "incompatible" : "compatible"];
    if (why.length && original) {
      const p = toBeatbox(original, true);
      body.textContent +=
        " " +
        c.preview
          .replace("{layers}", String(p.tracks.filter((t) => t.enabled).length))
          .replace("{bars}", String(p.export.bars));
    }
    reasons.replaceChildren(
      ...why.map((k) => {
        const li = document.createElement("li");
        li.textContent = c[k];
        return li;
      }),
    );
    if (
      why.length &&
      original &&
      !toBeatbox(original, true).tracks.some((t) => t.enabled)
    ) {
      const li = document.createElement("li");
      li.textContent = c.empty;
      reasons.append(li);
    }
    destination.textContent = c.destination + " " + c.retention;
    draftList.setAttribute("aria-label", c.draftList);
    go.textContent = c[why.length ? "derived" : "continue"];
    cancel.textContent = c.cancel;
    backup.textContent = c.backup;
    oldDraft.textContent = c.oldDraft;
    candidateCopy.textContent = c.copy;
    for (const option of draftList.options)
      option.textContent = `${Number(option.value) + 1} · ${option.dataset.target === "studio" ? "Studio" : "Beatbox"}`;
    clear.textContent = c.clear;
    originalList.setAttribute("aria-label", c.backup);
    status.textContent =
      failed === "incoming"
        ? c.recoveryFailure
        : failed
          ? c.failure
          : backup.hidden
            ? ""
            : c.saved;
  }
  function recovery() {
    try {
      const r = read(localStorage);
      clear.hidden =
        backup.hidden =
        originalList.hidden =
        candidateCopy.hidden =
          !r;
      const drafts = retainedDrafts(r);
      oldDraft.hidden = draftList.hidden = !drafts.length;
      draftList.replaceChildren(
        ...drafts.map((d, i) => {
          const option = new Option(
            `${i + 1} · ${d.target === "studio" ? "Studio" : "Beatbox"}`,
            String(i),
          );
          option.dataset.target = d.target;
          return option;
        }),
      );
      const latest = drafts.findLastIndex(
        (d) => d.target === r?.target && d.raw === r?.destinationDraft,
      );
      if (drafts.length)
        draftList.value = String(latest >= 0 ? latest : drafts.length - 1);
      originalList.replaceChildren(
        ...(r?.originals || []).map(
          (p, i) => new Option(`${i + 1} · ${p.title}`, String(i)),
        ),
      );
      if (r) originalList.value = String(r.originals.length - 1);
    } catch {
      failed = true;
      clear.hidden =
        backup.hidden =
        originalList.hidden =
        oldDraft.hidden =
        draftList.hidden =
        candidateCopy.hidden =
          true;
    }
    localize();
  }
  listen(button, "click", () => {
    if (locked()) return;
    try {
      original = current();
      why = mode === "studio" ? reverseReasons(original) : [];
      localize();
      dialog.showModal();
      cancel.focus();
    } catch {
      failed = true;
      localize();
    }
  });
  listen(cancel, "click", () => dialog.close());
  listen(dialog, "close", () => button.focus());
  listen(go, "click", async () => {
    if (locked()) return;
    try {
      prepareTransfer(original, mode === "beatbox" ? "studio" : "beatbox");
      go.disabled = cancel.disabled = true;
      await beforeNavigate();
      location.assign(
        (language() === "en" ? "/en" : "") +
          (mode === "beatbox" ? "/studio/" : "/beatbox/"),
      );
    } catch {
      go.disabled = cancel.disabled = false;
      failed = true;
      dialog.close();
      localize();
    }
  });
  listen(backup, "click", () => {
    try {
      const r = read(localStorage),
        p = r.originals[Number(originalList.value)],
        catalog =
          p.schemaVersion === 1 ? originalRegistry : compositionRegistry;
      delivery.download(
        new Blob([serializeProject(p, catalog)], { type: "application/json" }),
        safeFilename(p.title + "-original", "perkusi.json"),
      );
    } catch {
      failed = true;
      localize();
    }
  });
  listen(oldDraft, "click", () => {
    try {
      const r = read(localStorage);
      delivery.download(
        new Blob([retainedDrafts(r)[Number(draftList.value)].raw], {
          type: "application/json",
        }),
        `destination-draft-${Number(draftList.value) + 1}.perkusi.json`,
      );
    } catch {
      failed = true;
      localize();
    }
  });
  listen(candidateCopy, "click", () => {
    try {
      const r = read(localStorage),
        p = migrateProject(r.candidate, targetCatalog(r.target));
      delivery.download(
        new Blob([serializeProject(p, targetCatalog(r.target))], {
          type: "application/json",
        }),
        safeFilename(p.title + "-" + r.target + "-copy", "perkusi.json"),
      );
    } catch {
      failed = true;
      localize();
    }
  });
  listen(clear, "click", () => {
    try {
      const r = read(localStorage);
      if (r?.pending) throw new ProjectError("storageUnavailable");
      if (window.confirm(copy[language()].clearConfirm)) {
        localStorage.removeItem(KEY);
        sessionStorage.removeItem(MARKER);
        for (const target of ["studio", "beatbox"])
          localStorage.removeItem(transferReceiptKey(target));
        failed = false;
        recovery();
      }
    } catch {
      failed = true;
      localize();
    }
  });
  listen(document, "perkusi:locale", localize);
  recovery();
  const ready = (async () => {
    onReceiving(true);
    try {
      await beforeReceive();
      if (life.signal.aborted) throw new ProjectError("storageUnavailable");
      const incoming = incomingTransfer(mode);
      if (incoming) {
        await incoming.deliver(async (p) => {
          if (life.signal.aborted) throw new ProjectError("storageUnavailable");
          await apply(p);
          if (life.signal.aborted) throw new ProjectError("storageUnavailable");
        });
        recovery();
      }
    } catch {
      failed = "incoming";
      localize();
    } finally {
      onReceiving(false);
    }
  })();
  return {
    ready,
    dispose() {
      life.abort();
      dialog.close();
      panel.remove();
    },
  };
}
