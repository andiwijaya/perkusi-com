import "./draft-notice.css";
import { projectMessages } from "./messages.js";

export function createDraftNotice(root, saveId, returnToDraft) {
  const notice = document.createElement("aside");
  notice.className = "draft-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  const message = document.createElement("p");
  const save = document.createElement("a");
  const back = document.createElement("button");
  back.type = "button";
  back.addEventListener("click", () => {
    if (window.confirm(copy().returnToDraftConfirm)) returnToDraft();
  });
  save.href = `#${saveId}`;
  save.addEventListener("click", (event) => {
    const button = document.getElementById(saveId);
    if (!button) return;
    event.preventDefault();
    button.scrollIntoView({ block: "center" });
    button.focus({ preventScroll: true });
  });
  notice.append(message, save, back);
  root.append(notice);
  let issue;
  const copy = () =>
    projectMessages[document.documentElement.lang] || projectMessages.id;
  function localize() {
    if (!issue) return;
    const text = copy();
    message.textContent = text[issue];
    save.textContent = text.save;
    back.textContent = text.returnToDraft;
  }
  return {
    localize,
    show(code) {
      issue = code;
      back.hidden = code !== "separateDraft";
      notice.hidden = false;
      localize();
    },
    hide() {
      issue = undefined;
      notice.hidden = true;
    },
  };
}
