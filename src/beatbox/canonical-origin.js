import { AudioMemory } from "../audio/audio-memory.js";
import { CanonicalHandoffStore } from "../project/canonical-handoff.js";
import { canonicalStudioHref } from "../studio/canonical-route.js";

// The old transfer envelope stays small. The complete, hash-checked Studio
// archive lives in the existing handoff inbox and is addressed by this UUID.
export function attachCanonicalBeatboxOrigin({ root, id }) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return { dispose() {} };
  const memory = new AudioMemory(),
    store = new CanonicalHandoffStore({ memory }),
    life = new AbortController(),
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
      ? "Review original in Studio"
      : "Tinjau sumber di Studio";
    back.href = canonicalStudioHref(en ? "en" : "id") + "&handoff=" + id;
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
        let reader, url;
        try {
          reader = await store.read(id);
          if (closed) return;
          url = URL.createObjectURL(reader.blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "studio-original-" + id + ".perkusi";
          document.body.append(a);
          a.click();
          a.remove();
          const held = reader;
          reader = null;
          const release = () => {
            const row = urls.get(url);
            if (!row) return;
            clearTimeout(row.timer);
            urls.delete(url);
            URL.revokeObjectURL(url);
            held.release();
          };
          urls.set(url, { release, timer: setTimeout(release, 1200) });
          status.textContent = "";
        } catch {
          if (url && !urls.has(url)) URL.revokeObjectURL(url);
          status.textContent =
            document.documentElement.lang === "en"
              ? "The complete source could not be read. Keep your backups and retry from Studio's saved transfers. This Beatbox draft is unchanged."
              : "Sumber lengkap belum dapat dibaca. Simpan cadangan dan coba lagi dari transfer tersimpan di Studio. Draft Beatbox ini tetap utuh.";
        } finally {
          reader?.release();
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
      store.close();
      for (const row of urls.values()) row.release();
    },
  };
}
