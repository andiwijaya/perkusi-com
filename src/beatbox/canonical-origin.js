import { readHandoffOriginal } from "../project/handoff-recovery.js";
import { originalRecoveryHref } from "../app/legacy-recovery-link.js";

// The old transfer envelope stays small. The complete, hash-checked Studio
// archive lives in the existing handoff inbox and is addressed by this UUID.
export function attachCanonicalBeatboxOrigin({ root, id }) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return { dispose() {} };
  const life = new AbortController(),
    box = document.createElement("section"),
    note = document.createElement("p"),
    button = document.createElement("button"),
    back = document.createElement("a"),
    status = document.createElement("p"),
    urls = new Map();
  let closed = false,
    busy = false;
  box.className = "project-panel";
  box.dataset.canonicalOrigin = id;
  button.type = "button";
  button.dataset.canonicalOriginDownload = "";
  back.dataset.canonicalOriginRestore = "";
  status.setAttribute("role", "status");
  box.append(note, button, document.createTextNode(" "), back, status);
  root.append(box);
  const localize = () => {
    const en = document.documentElement.lang === "en";
    note.textContent = en
      ? "Your complete Studio source is preserved in this browser, including recordings. It is separate from this editable Beatbox copy and remains in Studio's transfer recovery list."
      : "Sumber Studio lengkap beserta rekaman tersimpan di browser ini. Sumber itu terpisah dari salinan Beatbox yang dapat diedit dan tetap ada di daftar pemulihan transfer Studio.";
    button.textContent = en
      ? "Download complete Studio source"
      : "Unduh sumber Studio lengkap";
    back.textContent = en
      ? "Recover original source (export only)"
      : "Pulihkan sumber asli (ekspor saja)";
    back.href = originalRecoveryHref(en ? "en" : "id", id);
  };
  document.addEventListener("perkusi:locale", localize, {
    signal: life.signal,
  });
  button.addEventListener(
    "click",
    () => {
      if (closed || busy) return;
      busy = true;
      button.disabled = true;
      void (async () => {
        let url;
        try {
          const reader = await readHandoffOriginal(id, { signal: life.signal });
          if (closed) return;
          url = URL.createObjectURL(reader.blob);
          const a = document.createElement("a");
          a.href = url;
          a.download =
            "studio-original-" +
            id +
            (reader.verified ? ".perkusi" : ".unverified.bin");
          document.body.append(a);
          a.click();
          a.remove();
          const verified = reader.verified;
          const release = () => {
            const row = urls.get(url);
            if (!row) return;
            clearTimeout(row.timer);
            urls.delete(url);
            URL.revokeObjectURL(url);
          };
          urls.set(url, { release, timer: setTimeout(release, 1200) });
          status.textContent = verified
            ? ""
            : document.documentElement.lang === "en"
              ? "Raw original downloaded; stored version/digest is unverified. Keep its metadata from recovery."
              : "Sumber mentah diunduh; versi/digest tersimpan belum terverifikasi. Pertahankan metadata dari pemulihan.";
        } catch {
          if (url && !urls.has(url)) URL.revokeObjectURL(url);
          status.textContent =
            document.documentElement.lang === "en"
              ? "The complete source could not be read. Keep your backups and retry from Studio's saved transfers. This Beatbox draft is unchanged."
              : "Sumber lengkap belum dapat dibaca. Simpan cadangan dan coba lagi dari transfer tersimpan di Studio. Draft Beatbox ini tetap utuh.";
        } finally {
          busy = false;
          button.disabled = closed;
        }
      })();
    },
    { signal: life.signal },
  );
  localize();
  return {
    dispose() {
      closed = true;
      life.abort();
      for (const row of urls.values()) row.release();
    },
  };
}
