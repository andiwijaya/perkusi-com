import "./canonical-recovery.css";
import "./original-recovery.css";
import {
  RAW_DOCUMENTS,
  readRawDocument,
  rawDocumentFile,
} from "../project/legacy-raw-recovery.js";
import {
  listHandoffOriginals,
  readHandoffOriginal,
  handoffMetadataFile,
} from "../project/handoff-recovery.js";

const en = document.documentElement.lang === "en",
  $ = (id) => document.getElementById(id),
  urls = new Map();
let operation = null,
  after = null,
  rows = [],
  closed = false;
const copy = en
  ? {
      raw: "Download raw text",
      listing: "Reading existing inbox…",
      empty: "No inbox records found. No database was created.",
      ready: "Original bytes downloaded. Keep the metadata file too.",
      unverified:
        "Raw original downloaded without interpreting it. Stored version or digest is unverified; keep its metadata and browser data.",
      missing: "No value for this key. Nothing was changed.",
      error:
        "Export failed; existing data remains unchanged. Keep the browser data and original files. Code: ",
      cancelled: "Cancelled. Existing data is unchanged.",
      meta: "Stored metadata downloaded without changing its fields.",
    }
  : {
      raw: "Unduh teks mentah",
      listing: "Membaca inbox yang ada…",
      empty: "Tidak ada record inbox. Tidak ada database dibuat.",
      ready: "Byte asli diunduh. Simpan juga berkas metadata.",
      unverified:
        "Sumber mentah diunduh tanpa menafsirkannya. Versi atau digest tersimpan belum terverifikasi; pertahankan metadata dan data browser.",
      missing: "Tidak ada nilai untuk key ini. Tidak ada data berubah.",
      error:
        "Ekspor gagal; data lama tidak berubah. Pertahankan data browser dan berkas asli. Kode: ",
      cancelled: "Dibatalkan. Data lama tidak berubah.",
      meta: "Metadata tersimpan diunduh tanpa mengubah field-nya.",
    };
function deliver(blob, name) {
  if (closed) return;
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  const release = () => {
    clearTimeout(urls.get(url));
    urls.delete(url);
    URL.revokeObjectURL(url);
  };
  urls.set(url, setTimeout(release, 1000));
}
function lock(busy) {
  for (const node of document.querySelectorAll("button,select"))
    node.disabled = busy;
  $("original-cancel").disabled = !busy;
  $("handoff-download").disabled = $("handoff-metadata").disabled =
    busy || $("handoff-items").selectedIndex < 0;
  $("handoff-more").hidden = after === null;
}
async function task(fn) {
  if (operation || closed) return;
  const own = (operation = new AbortController()),
    timer = setTimeout(() => own.abort(), 15000);
  lock(true);
  try {
    await fn(own.signal);
  } catch (error) {
    if (!closed)
      $("original-status").textContent =
        error.code === "cancelled"
          ? copy.cancelled
          : copy.error + (error.code ?? error.name);
  } finally {
    clearTimeout(timer);
    operation = null;
    if (!closed) lock(false);
  }
}
for (const source of RAW_DOCUMENTS) {
  const box = document.createElement("div"),
    label = document.createElement("p"),
    button = document.createElement("button");
  label.textContent = source.area + " / " + source.key;
  button.type = "button";
  button.dataset.rawDocument = source.id;
  button.textContent = copy.raw;
  button.addEventListener(
    "click",
    () =>
      void task(async () => {
        const raw = readRawDocument(source.id);
        if (raw === null) {
          $("original-status").textContent = copy.missing;
          return;
        }
        const file = rawDocumentFile(source.id, raw);
        deliver(file.blob, file.name);
        $("original-status").textContent = copy.ready + " " + file.encoding;
      }),
  );
  box.append(label, button);
  $("raw-documents").append(box);
}
async function list(more, signal) {
  $("original-status").textContent = copy.listing;
  const page = await listHandoffOriginals({
    after: more ? after : null,
    signal,
  });
  if (closed || signal.aborted) return;
  if (!more) {
    rows = [];
    $("handoff-items").replaceChildren();
  }
  for (const row of page.rows) {
    rows.push(row);
    $("handoff-items").append(
      new Option(
        (row.title || String(row.key)) + " — " + (row.bytes ?? "?") + " B",
        String(rows.length - 1),
      ),
    );
  }
  after = page.next;
  $("original-status").textContent = rows.length
    ? String(rows.length) +
      (en
        ? " records listed. Select an original or download its metadata."
        : " record terdaftar. Pilih sumber asli atau unduh metadata.")
    : copy.empty;
}
$("handoff-list").addEventListener(
  "click",
  () => void task((signal) => list(false, signal)),
);
$("handoff-more").addEventListener(
  "click",
  () => void task((signal) => list(true, signal)),
);
$("handoff-items").addEventListener("change", () => lock(false));
for (const metadata of [false, true])
  $(metadata ? "handoff-metadata" : "handoff-download").addEventListener(
    "click",
    () =>
      void task(async (signal) => {
        const row = rows[Number($("handoff-items").value)];
        if (!row) return;
        const original = await readHandoffOriginal(row.key, { signal });
        if (closed || signal.aborted) return;
        if (metadata) {
          deliver(
            handoffMetadataFile(original),
            "handoff-stored-metadata.json",
          );
          $("original-status").textContent = copy.meta;
        } else {
          deliver(
            original.blob,
            original.verified
              ? "handoff-original.perkusi"
              : "handoff-original.unverified.bin",
          );
          $("original-status").textContent =
            (original.verified ? copy.ready : copy.unverified) +
            " SHA256 " +
            original.sha256;
        }
      }),
  );
const known = new URL(location.href).searchParams.get("handoff");
if (/^[a-f0-9-]{36}$/.test(known ?? "")) {
  rows = [{ key: known }];
  $("handoff-items").append(new Option(known, "0"));
}
$("original-cancel").addEventListener("click", () => operation?.abort());
window.addEventListener(
  "pagehide",
  () => {
    closed = true;
    operation?.abort();
    for (const [url, timer] of urls) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    urls.clear();
  },
  { once: true },
);
lock(false);
