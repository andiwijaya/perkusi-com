import "./saved-list-recovery.css";

export function createSavedListRecovery(select, readList, listen, projectKeys) {
  const notice = document.createElement("div");
  notice.className = "saved-list-recovery";
  notice.hidden = true;
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-controls", select.id);
  notice.append(message, button);
  (select.closest("label") || select).after(notice);

  let copy;
  let statusKey = "savedListUnavailable";
  function renderStatus() {
    message.textContent = copy[statusKey];
  }
  function retry(manual = false) {
    if (manual && notice.hidden) return;
    const restoreFocus = document.activeElement === button;
    readList();
    if (notice.hidden && restoreFocus) select.focus({ preventScroll: true });
    if (manual && !notice.hidden) {
      statusKey = "reloadSavedListFailed";
      renderStatus();
    }
  }
  listen(button, "click", () => retry(true));
  listen(window, "focus", () => retry());
  listen(document, "visibilitychange", () => {
    if (!document.hidden) retry();
  });
  listen(window, "storage", ({ key, storageArea }) => {
    if (key !== null && !projectKeys.includes(key)) return;
    try {
      if (storageArea !== window.localStorage) return;
    } catch {
      // Let the list read handle unavailable local storage.
    }
    retry();
  });

  return {
    localize(messages) {
      copy = messages;
      button.textContent = copy.reloadSavedList;
      renderStatus();
    },
    setUnavailable(unavailable) {
      if (notice.hidden === !unavailable) return;
      notice.hidden = !unavailable;
      statusKey = "savedListUnavailable";
      renderStatus();
    },
  };
}
