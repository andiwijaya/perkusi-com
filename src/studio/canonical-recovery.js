import "./canonical-recovery.css";
import { AudioMemory } from "../audio/audio-memory.js";
import { retainCanonicalInputBlob } from "../project/canonical-blob-owner.js";
import { canonicalRegisteredAssets } from "../audio/canonical-registered-assets.js";
import { CanonicalRecoveryStorage } from "../project/canonical-recovery-storage.js";
import { exportLegacyLoopProject } from "../project/legacy-loop-recovery.js";
import {
  exportCanonicalPackage,
  importCanonicalFile,
} from "../project/canonical-package.js";
import {
  canonicalStudioHref,
  canonicalLegacyHref,
  canonicalRecoveryHref,
} from "./canonical-route.js";

const en = document.documentElement.lang === "en",
  $ = (id) => document.getElementById(id),
  memory = new AudioMemory(),
  registry = canonicalRegisteredAssets(48000, (d) => "/" + d.path).registry,
  store = new CanonicalRecoveryStorage({ registry, memory });
let bundle = null,
  busy = false,
  after = null,
  closed = false;
const copy = en
  ? {
      title: "Recover saved projects",
      intro:
        "This recovery page reads saved unified Studio projects and exports complete files, including original sources and recordings. It does not play audio, save edits, or rewrite older projects. Editing a recovered Preview project requires a compatible Preview version. After a version rollback, Return to Studio may open the previous editor; export the complete file to keep your work.",
      legacy: "Previous Studio",
      preview: "Return to Studio",
      check: "Read saved project",
      download: "Download complete .perkusi",
      original: "Download original source",
      file: "Open a backup file",
      list: "Saved projects / previous-project backups",
      next: "More saved projects",
      ready:
        "Ready to export. Keep the downloaded file before changing versions.",
      none: "No saved Preview project found. Open a backup file or return to the previous tool. Nothing was created or changed.",
      error:
        "Cannot read this project. Keep your browser data and original files; select another saved project or open a backup.",
      latest: "Current project",
      language: "Bahasa Indonesia",
    }
  : {
      title: "Pulihkan proyek tersimpan",
      intro:
        "Halaman pemulihan ini membaca proyek Studio terpadu tersimpan dan mengekspor berkas lengkap, termasuk sumber asli dan rekaman. Halaman ini tidak memutar audio, menyimpan edit, atau menulis ulang proyek sebelumnya. Untuk mengedit proyek Preview yang dipulihkan, gunakan versi Preview yang kompatibel. Setelah kembali ke versi sebelumnya, Kembali ke Studio dapat membuka editor lama; unduh berkas lengkap agar pekerjaan tetap tersimpan.",
      legacy: "Studio sebelumnya",
      preview: "Kembali ke Studio",
      check: "Baca proyek tersimpan",
      download: "Unduh .perkusi lengkap",
      original: "Unduh sumber asli",
      file: "Buka berkas cadangan",
      list: "Proyek tersimpan / cadangan proyek sebelumnya",
      next: "Proyek tersimpan berikutnya",
      ready: "Siap diekspor. Simpan berkas unduhan sebelum berganti versi.",
      none: "Tidak ada proyek Preview tersimpan. Buka berkas cadangan atau kembali ke alat sebelumnya. Tidak ada data dibuat atau diubah.",
      error:
        "Proyek ini belum dapat dibaca. Pertahankan data browser dan berkas asli; pilih proyek tersimpan lain atau buka cadangan.",
      latest: "Proyek saat ini",
      language: "English",
    };
document.title = copy.title + " · Perkusi.com";
if (import.meta.env.CANONICAL_FINAL_STUDIO) {
  copy.intro = en
    ? "Read saved Studio projects or export older Loop recordings as complete files, including original sources and audio. Import the downloaded file into Studio to edit a copy. Recovery does not play audio or change saved data."
    : "Baca proyek Studio tersimpan atau ekspor rekaman Loop lama sebagai berkas lengkap, termasuk sumber asli dan audio. Impor unduhannya ke Studio untuk mengedit salinan. Pemulihan tidak memutar audio atau mengubah data tersimpan.";
  copy.none = en
    ? "No saved project found. Open a backup file or return to Studio. Nothing was created or changed."
    : "Tidak ada proyek tersimpan. Buka berkas cadangan atau kembali ke Studio. Tidak ada data dibuat atau diubah.";
  $("recovery-legacy").hidden = true;
  for (const node of document.querySelector("footer").childNodes)
    if (node.nodeType === Node.TEXT_NODE) node.textContent = " · Perkusi.com";
}
$("recovery-title").textContent = copy.title;
$("recovery-intro").textContent = copy.intro;
for (const [key, id] of [
  ["legacy", "recovery-legacy"],
  ["preview", "recovery-preview"],
  ["check", "recovery-read"],
  ["download", "recovery-download"],
  ["original", "recovery-original"],
  ["file", "recovery-file-label"],
  ["list", "recovery-list-label"],
  ["next", "recovery-next"],
])
  $(id).textContent = copy[key];
$("recovery-legacy").href = canonicalLegacyHref(en ? "en" : "id");
$("recovery-preview").href = canonicalStudioHref(en ? "en" : "id");
$("recovery-language").href = canonicalRecoveryHref(en ? "id" : "en");
$("recovery-language").textContent = copy.language;
function lock() {
  for (const e of document.querySelectorAll("button,input,select"))
    e.disabled = busy;
  $("recovery-download").disabled = busy || !bundle;
  $("recovery-original").disabled =
    busy || !bundle?.project.compatibility.rootOriginId;
}
async function task(fn) {
  if (busy || closed) return;
  busy = true;
  lock();
  try {
    await fn();
    if (!closed) delete document.body.dataset.recoveryError;
  } catch (error) {
    if (!closed) {
      document.body.dataset.recoveryError = error.code ?? error.message;
      $("recovery-status").textContent =
        error.code === "missingProject" ? copy.none : copy.error;
    }
  } finally {
    busy = false;
    if (!closed) lock();
  }
}
function accept(next) {
  bundle?.dispose();
  bundle = next;
  $("recovery-project").textContent = bundle.project.title;
  $("recovery-status").textContent = copy.ready;
  document.body.dataset.recoveryReady = "true";
}
async function list() {
  const page = await store.list({ after });
  if (after === null)
    $("recovery-list").replaceChildren(new Option(copy.latest, "current"));
  for (const row of page.rows)
    if (row.id !== "current")
      $("recovery-list").append(new Option(row.id, row.id));
  after = page.next;
  $("recovery-next").hidden = !after;
}
async function deliver(blob, name) {
  const held = retainCanonicalInputBlob(
    blob,
    memory,
    "canonical/recovery-download",
  );
  let url;
  try {
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, 1000));
  } finally {
    if (url) URL.revokeObjectURL(url);
    held.release();
  }
}
$("recovery-read").addEventListener(
  "click",
  () =>
    void task(async () => {
      const found = await store.load({ documentId: $("recovery-list").value });
      if (!found)
        throw Object.assign(Error("missingProject"), {
          code: "missingProject",
        });
      accept(found.bundle);
    }),
);
$("recovery-next").addEventListener("click", () => void task(list));
const recoverLoop = document.createElement("button");
recoverLoop.type = "button";
recoverLoop.id = "recovery-loop";
recoverLoop.textContent = en
  ? "Export older Loop recordings"
  : "Ekspor rekaman Loop lama";
$("recovery-read").after(recoverLoop);
recoverLoop.addEventListener(
  "click",
  () =>
    void task(async () => {
      let out;
      try {
        out = await exportLegacyLoopProject({ registry, memory });
        await deliver(out.blob, "perkusi-loop-recovered.perkusi");
        $("recovery-status").textContent = copy.ready;
      } finally {
        out?.release();
      }
    }),
);
$("recovery-file").addEventListener(
  "change",
  () =>
    void task(async () => {
      const file = $("recovery-file").files?.[0];
      if (file) accept(await importCanonicalFile(file, { registry, memory }));
    }),
);
$("recovery-download").addEventListener(
  "click",
  () =>
    void task(async () => {
      let out;
      try {
        out = await exportCanonicalPackage(bundle, { memory });
        await deliver(out.blob, "perkusi-recovered.perkusi");
      } finally {
        out?.release();
      }
    }),
);
$("recovery-original").addEventListener(
  "click",
  () =>
    void task(async () => {
      const o = bundle.project.origins.find(
          (o) => o.id === bundle.project.compatibility.rootOriginId,
        ),
        blob = bundle.originals.get(o.sha256);
      if (blob) await deliver(blob, "perkusi-original.perkusi");
    }),
);
window.addEventListener(
  "pagehide",
  () => {
    closed = true;
    bundle?.dispose();
    store.close();
  },
  { once: true },
);
lock();
void task(list);
