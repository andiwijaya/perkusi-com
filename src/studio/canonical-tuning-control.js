const copy = {
  id: {
    title: "Persetujuan kombinasi laras · seluruh lagu",
    label: "Izinkan kombinasi sumber berbeda laras pada proyek ini",
    explanation:
      "Rekaman tetap memakai nada dan laras aslinya. Persetujuan ini berlaku untuk gabungan seluruh lagu; persetujuan sebuah sumber tidak otomatis berlaku untuk sumber lain.",
    question: "Izinkan kombinasi laras untuk lagu ini?",
    detail:
      "Suara tidak disetel ulang. Pilihan ini disimpan dalam proyek dan dapat dicabut atau diundur. Ini bukan penilaian budaya, kualitas musikal, atau izin penggunaan aset.",
    confirm: "Saya mengerti, izinkan pada proyek ini",
    cancel: "Batal",
    stale: "Proyek berubah. Tinjau kembali pilihan untuk proyek yang aktif.",
  },
  en: {
    title: "Tuning combination consent · whole song",
    label: "Allow sources with different tunings in this project",
    explanation:
      "Recordings keep their original notes and tuning. This choice covers the combined song; one source's consent does not automatically cover other sources.",
    question: "Allow the tuning combination for this song?",
    detail:
      "Sounds are not retuned. This choice is saved in the project and can be withdrawn or undone. It is not a cultural, musical-quality or asset-rights assessment.",
    confirm: "I understand, allow in this project",
    cancel: "Cancel",
    stale:
      "The project changed. Review the choice for the active project again.",
  },
};

// A project flag, not an account permission. Opening/cancelling the modal does
// not edit or invalidate playback. Only an explicit, current-revision confirm
// enters the ordinary validated editor/cleanup-ACK/history transaction.
export function initCanonicalTuningControl({
  root,
  editor,
  mutate,
  locale,
  signal,
}) {
  const t = copy[locale] ?? copy.id,
    make = (tag, text = "", attrs = {}) => {
      const e = document.createElement(tag);
      e.textContent = text;
      for (const [key, value] of Object.entries(attrs))
        e.setAttribute(key, value);
      return e;
    };
  const box = make("details", "", {
      class: "st-panel",
      "data-canonical-tuning": "",
    }),
    check = make("input", "", {
      type: "checkbox",
      "data-can-tuning": "",
      "aria-describedby": "can-tuning-explanation",
    }),
    label = make("label", t.label),
    explanation = make("p", t.explanation, { id: "can-tuning-explanation" }),
    dialog = make("dialog", "", {
      "data-can-tuning-dialog": "",
      "aria-labelledby": "can-tuning-question",
      "aria-describedby": "can-tuning-detail",
    }),
    cancel = make("button", t.cancel, {
      type: "button",
      "data-can-tuning-cancel": "",
      autofocus: "",
    }),
    confirm = make("button", t.confirm, {
      type: "button",
      "data-can-tuning-confirm": "",
    }),
    notice = make("p", "", { role: "status", "data-can-tuning-notice": "" });
  label.prepend(check);
  dialog.append(
    make("h2", t.question, { id: "can-tuning-question" }),
    make("p", t.detail, { id: "can-tuning-detail" }),
    cancel,
    confirm,
  );
  box.append(make("summary", t.title), explanation, label, notice, dialog);
  root.querySelector(".canonical-material").after(box);
  let revision = null,
    locked = false,
    closed = false;
  const reset = () => {
    revision = null;
    if (dialog.open) dialog.close();
    check.checked = editor.snapshot().project.tuningConsent;
  };
  check.addEventListener(
    "change",
    () => {
      notice.textContent = "";
      const current = editor.snapshot();
      if (locked || closed) return reset();
      if (!check.checked) {
        check.checked = current.project.tuningConsent;
        void mutate(() =>
          editor.edit((p) => {
            p.tuningConsent = false;
          }),
        );
        return;
      }
      // DOM always reflects the accepted flag even while the question is open.
      check.checked = current.project.tuningConsent;
      revision = current.revision;
      dialog.showModal();
      cancel.focus();
    },
    { signal },
  );
  cancel.addEventListener("click", reset, { signal });
  dialog.addEventListener(
    "cancel",
    (e) => {
      e.preventDefault();
      reset();
    },
    { signal },
  );
  confirm.addEventListener(
    "click",
    () => {
      const expected = revision;
      if (
        closed ||
        locked ||
        expected === null ||
        editor.snapshot().revision !== expected
      ) {
        reset();
        notice.textContent = t.stale;
        return;
      }
      reset();
      void mutate(() => {
        if (editor.snapshot().revision !== expected)
          throw Object.assign(Error("draftConflict"), {
            code: "draftConflict",
          });
        return editor.edit((p) => {
          p.tuningConsent = true;
        });
      });
    },
    { signal },
  );
  signal.addEventListener(
    "abort",
    () => {
      closed = true;
      reset();
    },
    { once: true },
  );
  return {
    sync(state) {
      locked = state.locked;
      check.checked = editor.snapshot().project.tuningConsent;
      check.disabled = locked || closed;
      confirm.disabled = locked || closed;
      if (state.error === "tuningConsentRequired") box.open = true;
      if (revision !== null && editor.snapshot().revision !== revision) {
        reset();
        notice.textContent = t.stale;
      }
    },
  };
}
