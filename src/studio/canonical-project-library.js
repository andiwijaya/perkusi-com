const copy = {
  id: {
    fresh: "Proyek baru",
    save: "Simpan proyek",
    saveCopy: "Simpan salinan",
    choose: "Proyek tersimpan",
    open: "Buka proyek",
    remove: "Hapus dari daftar",
    refresh: "Perbarui daftar",
    previous: "Sebelumnya",
    next: "Berikutnya",
    empty: "Belum ada proyek tersimpan.",
    backup: "Cadangan",
    current: "Terbuka",
    unsaved: "Sesi ini berubah. Simpan sebelum melanjutkan?",
    saveContinue: "Simpan lalu lanjutkan",
    discard: "Lanjutkan tanpa menyimpan",
    cancel: "Batal",
    removeTitle: "Hapus proyek dari daftar?",
    removeHint:
      "Sesi yang sedang terbuka tetap tersedia dan dapat disimpan kembali.",
    confirmRemove: "Hapus dari daftar",
    failed:
      "Belum berhasil. Proyek tetap tersedia; coba lagi atau unduh cadangan.",
    conflict:
      "Proyek berubah di tab lain. Sesi ini tetap utuh; batalkan, lalu pilih Simpan salinan agar perubahan kedua tab tetap tersimpan.",
    full: "Penyimpanan browser penuh; proyek ini belum tersimpan. Sesi dan simpanan sebelumnya tetap utuh. Unduh proyek lengkap sebagai cadangan, kosongkan ruang perangkat, lalu coba simpan lagi. Hapus dari daftar tidak membebaskan ruang audio.",
  },
  en: {
    fresh: "New project",
    save: "Save project",
    saveCopy: "Save a copy",
    choose: "Saved projects",
    open: "Open project",
    remove: "Remove from list",
    refresh: "Refresh list",
    previous: "Previous",
    next: "Next",
    empty: "No saved projects yet.",
    backup: "Backup",
    current: "Open",
    unsaved: "This session changed. Save before continuing?",
    saveContinue: "Save and continue",
    discard: "Continue without saving",
    cancel: "Cancel",
    removeTitle: "Remove project from the list?",
    removeHint: "The open session remains available and can be saved again.",
    confirmRemove: "Remove from list",
    failed:
      "Not completed. Your project remains available; retry or download a backup.",
    conflict:
      "This project changed in another tab. Your draft is intact; cancel, then Save a copy to preserve both tabs' changes.",
    full: "Browser storage is full; this project has not been saved. Your draft and previous saves are intact. Download the complete project as a backup, free device space, then retry saving. Remove from list does not free audio storage.",
  },
};

// Presentation over the accepted editor/workflow/storage. Never opens a legacy
// store, reads PCM, or owns an audio engine. All replacements use one workspace.
export function initCanonicalProjectLibrary({
  root,
  workflow,
  makeFresh,
  transaction,
  isDirty,
  locale = "id",
  signal,
}) {
  const c = copy[locale] ?? copy.id,
    $ = (id) => root.querySelector("#st-" + id);
  const el = (tag, text = "", data) => {
    const n = document.createElement(tag);
    n.textContent = text;
    if (tag === "button") n.type = "button";
    if (data) n.setAttribute(data, "");
    return n;
  };
  const newButton = el("button", c.fresh, "data-can-new-project"),
    saveCopy = el("button", c.saveCopy, "data-can-save-copy"),
    refreshButton = el("button", c.refresh, "data-can-library-refresh"),
    previous = el("button", c.previous, "data-can-library-previous"),
    next = el("button", c.next, "data-can-library-next"),
    status = el("p", "", "data-can-library-status"),
    dialog = el("dialog", "", "data-can-project-dialog"),
    heading = el("h2"),
    message = el("p"),
    name = el("p"),
    saveContinue = el("button", c.saveContinue, "data-can-project-save"),
    discard = el("button", c.discard, "data-can-project-discard"),
    remove = el("button", c.confirmRemove, "data-can-project-remove"),
    cancel = el("button", c.cancel, "data-can-project-cancel"),
    error = el("p");
  heading.id = "st-project-dialog-title";
  dialog.setAttribute("aria-labelledby", heading.id);
  error.setAttribute("role", "alert");
  dialog.append(
    heading,
    name,
    message,
    error,
    saveContinue,
    discard,
    remove,
    cancel,
  );
  root.append(dialog);
  status.setAttribute("role", "status");
  $("save").textContent = c.save;
  $("load").textContent = c.open;
  $("saved-delete").textContent = c.remove;
  $("save").before(newButton);
  $("save").after(saveCopy);
  $("saved").closest("label").hidden = false;
  $("saved-delete").hidden = false;
  root.querySelector('[data-st-copy="choose"]').textContent = c.choose;
  $("load").after(refreshButton, previous, next, status);
  let rows = [],
    after = null,
    history = [],
    nextCursor = null,
    closed = false,
    locked = false,
    prompt = null,
    generation = 0;
  const selected = () => rows.find((r) => r.documentId === $("saved").value);
  const locks = (value = locked) => {
    locked = value;
    for (const b of [newButton, saveCopy, refreshButton, $("saved")])
      b.disabled = value;
    $("load").disabled = $("saved-delete").disabled = value || !selected();
    previous.disabled = value || !history.length;
    next.disabled = value || !nextCursor;
    for (const b of [saveContinue, discard, remove, cancel]) b.disabled = value;
  };
  async function refresh({ reset = false } = {}) {
    if (reset) {
      after = null;
      history = [];
    }
    const ticket = ++generation,
      prior = $("saved").value,
      page = await workflow.listProjects({ after });
    if (closed || ticket !== generation) return;
    rows = page.rows;
    nextCursor = page.nextCursor;
    const active = workflow.snapshot().documentId;
    $("saved").replaceChildren(
      ...rows.map(
        (row) =>
          new Option(
            row.title +
              (row.backup ? " · " + c.backup : "") +
              (row.documentId === active ? " · " + c.current : ""),
            row.documentId,
          ),
      ),
    );
    if (rows.some((r) => r.documentId === active)) $("saved").value = active;
    else if (rows.some((r) => r.documentId === prior)) $("saved").value = prior;
    status.textContent = rows.length
      ? String(rows.length) + " " + c.choose.toLowerCase()
      : c.empty;
    locks();
  }
  const run = (fn) =>
    transaction(fn).catch((e) => {
      if (!closed) {
        status.textContent = error.textContent =
          e.code === "draftConflict"
            ? c.conflict
            : e.code === "canonicalStorageFull"
              ? c.full
              : c.failed;
        locks(false);
      }
    });
  const close = () => {
    prompt = null;
    dialog.close();
    error.textContent = "";
  };
  function guarded(action) {
    if (closed || prompt) return;
    if (!isDirty()) return run(action);
    prompt = { kind: "unsaved", action };
    heading.textContent = c.unsaved;
    name.textContent = "";
    message.textContent = "";
    error.textContent = "";
    saveContinue.hidden = discard.hidden = false;
    remove.hidden = true;
    dialog.showModal();
    cancel.focus();
  }
  const listen = (target, event, fn) =>
    target.addEventListener(event, fn, { signal });
  listen(cancel, "click", close);
  listen(dialog, "cancel", (event) => {
    if (locked) event.preventDefault();
    else prompt = null;
  });
  listen(saveContinue, "click", () =>
    run(async () => {
      const action = prompt?.action;
      if (!action) return;
      await workflow.save();
      await refresh({ reset: true });
      close();
      await action();
    }),
  );
  listen(discard, "click", () => {
    const action = prompt?.action;
    close();
    if (action) void run(action);
  });
  listen(newButton, "click", () =>
    guarded(async () => {
      const fresh = await makeFresh();
      try {
        await workflow.replaceProject(fresh);
      } finally {
        fresh.dispose();
      }
      await refresh({ reset: true });
    }),
  );
  listen($("save"), "click", () =>
    run(async () => {
      await workflow.save();
      await refresh({ reset: true });
    }),
  );
  listen(saveCopy, "click", () =>
    run(async () => {
      await workflow.saveCopy();
      await refresh({ reset: true });
    }),
  );
  listen($("saved"), "change", () => locks());
  listen($("load"), "click", () => {
    const row = selected();
    if (!row) return;
    guarded(async () => {
      await workflow.load({ documentId: row.documentId });
      // Same acknowledged save/checkpoint path as accepted handoff receiver.
      // A failed save leaves the opened draft dirty and exportable for retry.
      await workflow.save();
      await refresh({ reset: true });
    });
  });
  listen($("saved-delete"), "click", () => {
    const row = selected();
    if (!row || prompt) return;
    prompt = { kind: "remove", row };
    heading.textContent = c.removeTitle;
    name.textContent = row.title;
    message.textContent = c.removeHint;
    error.textContent = "";
    saveContinue.hidden = discard.hidden = true;
    remove.hidden = false;
    dialog.showModal();
    cancel.focus();
  });
  listen(remove, "click", () =>
    run(async () => {
      const row = prompt?.row;
      if (!row) return;
      await workflow.removeProject({
        documentId: row.documentId,
        expected: row.revision,
      });
      close();
      await refresh({ reset: true });
    }),
  );
  listen(refreshButton, "click", () => run(() => refresh({ reset: true })));
  listen(previous, "click", () =>
    run(() => {
      after = history.pop() ?? null;
      return refresh();
    }),
  );
  listen(next, "click", () =>
    run(() => {
      history.push(after);
      after = nextCursor;
      return refresh();
    }),
  );
  locks();
  return Object.freeze({
    refresh,
    locks,
    guarded,
    dispose() {
      closed = true;
      generation++;
      dialog.close();
      dialog.remove();
    },
  });
}
