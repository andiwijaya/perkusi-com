import {
  discoverLegacyProjects,
  legacyCopyBlob,
} from "../project/legacy-discovery.js";
import { importCanonicalFile } from "../project/canonical-package.js";
import { CanonicalHandoffStore } from "../project/canonical-handoff.js";
import {
  canonicalStudioHref,
  canonicalLegacyHref,
  canonicalRecoveryHref,
} from "./canonical-route.js";

export function attachCanonicalLegacyPanel({
  root,
  app,
  registry,
  memory,
  locale = "id",
}) {
  const en = locale === "en",
    finalStudio = import.meta.env?.CANONICAL_FINAL_STUDIO === true,
    life = new AbortController(),
    store = new CanonicalHandoffStore({ memory }),
    staged = new Map();
  let busy = false,
    closed = false;
  const el = (tag, text = "") => {
      const e = document.createElement(tag);
      e.textContent = text;
      return e;
    },
    box = el("details"),
    summary = el(
      "summary",
      en ? "Existing projects and recovery" : "Proyek sebelumnya dan pemulihan",
    ),
    status = el("p"),
    list = el("ul"),
    refresh = el(
      "button",
      en ? "Check existing projects" : "Periksa proyek sebelumnya",
    );
  box.className = "st-panel";
  box.dataset.legacyDiscovery = "";
  box.open = !finalStudio;
  refresh.type = "button";
  refresh.dataset.legacyRefresh = "";
  status.setAttribute("role", "status");
  const links = el("p");
  for (const [href, label, id] of [
    ...(finalStudio
      ? []
      : [
          [
            canonicalLegacyHref(locale),
            en
              ? "Previous Studio / live-pad workflow"
              : "Studio sebelumnya / permainan pad",
            "st-legacy-entry",
          ],
        ]),
    [
      canonicalRecoveryHref(locale),
      finalStudio
        ? en
          ? "Recover saved projects and older Loop recordings"
          : "Pulihkan proyek tersimpan dan rekaman Loop lama"
        : en
          ? "Recover or export saved Preview projects"
          : "Pulihkan atau ekspor proyek Preview tersimpan",
      "st-recovery-entry",
    ],
    ...(finalStudio
      ? []
      : [
          [
            (en ? "/en" : "") + "/loop-station/?lang=" + locale,
            en
              ? "Loop recordings and 44.1kHz continuation"
              : "Rekaman Loop dan kelanjutan 44,1kHz",
            "st-legacy-loop",
          ],
        ]),
  ]) {
    const a = el("a", label);
    a.href = href;
    a.id = id;
    a.dataset.route = id;
    links.append(a, document.createTextNode(" · "));
  }
  box.append(
    summary,
    el(
      "p",
      finalStudio
        ? en
          ? "Read a copy of an older project or export its complete recording file on the recovery page. Open that file in this Studio; the original saved data stays intact."
          : "Baca salinan proyek lama atau ekspor berkas rekaman lengkap di halaman pemulihan. Buka berkas itu di Studio ini; data tersimpan asli tetap utuh."
        : en
          ? "Nothing is moved automatically. Review a copy, then choose Open as a copy. Original stores stay intact. Recorded Loop projects remain in Loop Station; export their complete .perkusi file to copy audio."
          : "Tidak ada pemindahan otomatis. Tinjau salinan, lalu pilih Buka sebagai salinan. Penyimpanan asli tetap utuh. Proyek rekaman Loop tetap di Loop Station; ekspor berkas .perkusi lengkap untuk menyalin audio.",
    ),
    links,
    refresh,
    status,
    list,
  );
  root.querySelector(".st-transport").before(box);
  function read() {
    if (closed || busy) return;
    list.replaceChildren();
    let found;
    try {
      found = discoverLegacyProjects(globalThis.localStorage);
    } catch {
      found = { rows: [], issues: ["storage"] };
    }
    box.dataset.legacyCount = String(found.rows.length);
    status.textContent = found.issues.length
      ? en
        ? "Some local project lists cannot be read. Use the previous tool or import a backup; your files have not changed."
        : "Sebagian daftar proyek lokal belum dapat dibaca. Gunakan alat sebelumnya atau impor cadangan; berkas Anda tidak berubah."
      : found.rows.length
        ? en
          ? "Choose a project to review a copy."
          : "Pilih proyek untuk meninjau salinan."
        : en
          ? "No Studio/Gamelan metadata found in these local lists. Loop recordings and file backups are opened separately."
          : "Tidak ada metadata Studio/Gamelan dalam daftar lokal ini. Rekaman Loop dan cadangan berkas dibuka secara terpisah.";
    for (const row of found.rows) {
      const li = el("li"),
        button = el(
          "button",
          (en ? "Review copy: " : "Tinjau salinan: ") + row.title,
        ),
        next = el(
          "a",
          en ? "Continue to copy choices" : "Lanjutkan ke pilihan salinan",
        );
      button.type = "button";
      button.dataset.legacyId = row.id;
      next.hidden = true;
      next.dataset.route = "studio";
      next.dataset.legacyContinue = "";
      li.append(button, next);
      list.append(li);
      button.addEventListener(
        "click",
        () => {
          // Staging a readonly source can overlap a project download. The
          // existing navigation/receiver still waits before changing a document.
          if (busy || closed) return;
          busy = true;
          refresh.disabled = button.disabled = true;
          void app
            .transaction(async () => {
              let candidate;
              try {
                const blob = legacyCopyBlob(row, globalThis.localStorage);
                candidate = await importCanonicalFile(blob, {
                  registry,
                  memory,
                });
                candidate.dispose();
                candidate = null;
                if (closed) return;
                const key = row.key + ":" + row.id,
                  prior = staged.get(key);
                const info =
                  prior?.raw === row.raw
                    ? prior.info
                    : await store.stage(blob, {
                        kind: "legacy",
                        title: row.title,
                      });
                staged.set(key, { raw: row.raw, info });
                if (closed) return;
                next.href =
                  canonicalStudioHref(locale) +
                  "&handoff=" +
                  encodeURIComponent(info.id);
                next.hidden = false;
                next.focus();
                status.textContent = en
                  ? "Copy staged. The active project is unchanged. Continue, then explicitly choose Open as a copy or Later."
                  : "Salinan disiapkan. Proyek aktif belum berubah. Lanjutkan, lalu pilih Buka sebagai salinan atau Tunda secara eksplisit.";
                delete box.dataset.legacyError;
              } catch (error) {
                if (!closed) {
                  box.dataset.legacyError = error.code ?? error.message;
                  status.textContent = en
                    ? "Copy unavailable; current and original projects remain available. Refresh the list or use a backup."
                    : "Salinan belum tersedia; proyek aktif dan asli tetap tersedia. Periksa daftar lagi atau gunakan cadangan.";
                }
              } finally {
                candidate?.dispose();
                busy = false;
                if (!closed) refresh.disabled = button.disabled = false;
              }
            })
            .catch(() => {});
        },
        { signal: life.signal },
      );
    }
  }
  refresh.addEventListener("click", read, { signal: life.signal });
  read();
  return {
    dispose() {
      closed = true;
      life.abort();
      store.close();
      box.remove();
    },
  };
}
