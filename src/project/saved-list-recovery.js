import "./saved-list-recovery.css";

export function createSavedListRecovery(select, readList, listen) {
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

  function retry() {
    if (notice.hidden) return;
    const restoreFocus = document.activeElement === button;
    readList();
    if (notice.hidden && restoreFocus) select.focus({ preventScroll: true });
  }
  listen(button, "click", retry);
  listen(window, "focus", retry);
  listen(document, "visibilitychange", () => {
    if (!document.hidden) retry();
  });

  return {
    localize(copy) {
      message.textContent = copy.savedListUnavailable;
      button.textContent = copy.reloadSavedList;
    },
    setUnavailable(unavailable) {
      notice.hidden = !unavailable;
    },
  };
}
