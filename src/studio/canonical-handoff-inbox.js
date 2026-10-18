import { CanonicalHandoffStore } from "../project/canonical-handoff.js";
import { canonicalStudioHref } from "./canonical-route.js";
export function attachCanonicalHandoffInbox({ root, memory, locale = "id" }) {
  const t =
    locale === "en"
      ? {
          title: "Transfers and previous project backups",
          refresh: "Check saved transfers",
          next: "Next",
          empty: "No saved transfers on this browser.",
          accepted: "Previously received",
          pending: "Awaiting a choice",
          error: "Saved transfers are unavailable; your project is unchanged.",
        }
      : {
          title: "Transfer dan cadangan proyek sebelumnya",
          refresh: "Periksa transfer tersimpan",
          next: "Berikutnya",
          empty: "Belum ada transfer tersimpan di browser ini.",
          accepted: "Sudah diterima",
          pending: "Menunggu pilihan",
          error:
            "Transfer tersimpan belum dapat dibaca; proyek aktif tetap utuh.",
        };
  const box = document.createElement("details"),
    summary = document.createElement("summary"),
    list = document.createElement("ul"),
    refresh = document.createElement("button"),
    next = document.createElement("button"),
    status = document.createElement("p");
  box.className = "st-panel";
  box.dataset.canonicalInbox = "";
  summary.textContent = t.title;
  refresh.textContent = t.refresh;
  next.textContent = t.next;
  refresh.type = next.type = "button";
  refresh.dataset.handoffInbox = "refresh";
  next.dataset.handoffInbox = "next";
  status.setAttribute("role", "status");
  next.hidden = true;
  box.append(summary, refresh, list, status, next);
  root.querySelector(".st-project").after(box);
  const store = new CanonicalHandoffStore({ memory }),
    life = new AbortController();
  let after = null,
    closed = false,
    busy = false;
  async function read(reset) {
    if (closed || busy) return;
    busy = true;
    refresh.disabled = next.disabled = true;
    try {
      const result = await store.list({ after: reset ? null : after });
      if (closed) return;
      list.replaceChildren();
      after = result.next;
      next.hidden = !after;
      for (const r of result.rows) {
        const item = document.createElement("li"),
          link = document.createElement("a");
        link.href =
          canonicalStudioHref(locale) + "&handoff=" + encodeURIComponent(r.id);
        link.dataset.route = "studio";
        link.dataset.handoffSaved = r.id;
        link.textContent =
          r.title + " — " + (r.accepted ? t.accepted : t.pending);
        item.append(link);
        list.append(item);
      }
      status.textContent = result.rows.length ? "" : t.empty;
    } catch {
      if (!closed) status.textContent = t.error;
    } finally {
      busy = false;
      refresh.disabled = next.disabled = false;
    }
  }
  refresh.addEventListener("click", () => void read(true), {
    signal: life.signal,
  });
  next.addEventListener("click", () => void read(false), {
    signal: life.signal,
  });
  return Object.freeze({
    dispose() {
      closed = true;
      life.abort();
      store.close();
    },
  });
}
