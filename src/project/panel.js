import { projectMessages } from "./messages.js";
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function renderProjectPanel(locale) {
  const copy = projectMessages[locale] || projectMessages.id,
    t = (k) => escape(copy[k]),
    text = (k, tag = "span", attrs = "") =>
      `<${tag} data-project-copy="${k}" ${attrs}>${t(k)}</${tag}>`;
  const button = (id, k, attrs = "") =>
    `<button type="button" id="${id}" disabled ${attrs}>${text(k)}</button>`;
  return `<section class="project-panel" aria-labelledby="project-heading"><header>${text("heading", "h2", 'id="project-heading"')}${text("intro", "p")}</header>${text("localNote", "p", 'class="project-note"')}<div class="project-grid"><div class="project-library"><label for="project-title">${text("title")}</label><input id="project-title" type="text" maxlength="80" autocomplete="off" disabled><div class="project-actions">${button("project-save", "save")}${button("project-json", "exportProject")}</div><label for="project-list">${text("savedList")}</label><select id="project-list" disabled><option value="" data-project-copy="choose">${t("choose")}</option></select><div class="project-actions">${button("project-load", "load")}${button("project-delete", "remove")}</div><div class="project-actions">${button("project-import", "importProject", 'aria-describedby="project-file-hint"')}</div><label for="project-file" class="bb-sr-only">${text("fileLabel")}</label><input id="project-file" type="file" hidden accept=".perkusi.json,application/json" aria-describedby="project-file-hint" disabled>${text("fileHint", "p", 'id="project-file-hint" class="project-note"')}<p id="project-storage-warning" role="status" hidden></p></div><div class="project-audio">${text("audioHeading", "h3")}<label for="project-bars">${text("bars")}</label><select id="project-bars" disabled><option value="4" data-project-copy="bars4">${t("bars4")}</option><option value="8" data-project-copy="bars8">${t("bars8")}</option></select>${text("exportHint", "p", 'class="project-note"')}<div class="project-actions">${button("project-render", "render", 'class="bb-primary"')}${button("project-cancel", "cancel", "hidden")}</div><progress id="project-progress" max="1" value="0" hidden></progress><div id="project-result" hidden><p><span data-project-copy="fileSnapshot">${t("fileSnapshot")}</span> <strong id="project-filename"></strong></p><div class="project-actions">${button("project-download", "download")}${button("project-share", "share")}</div></div></div></div><p id="project-status" role="status" aria-live="polite">${t("ready")}</p></section>`;
}
