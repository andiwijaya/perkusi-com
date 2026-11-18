import "./draft-notice.css";
import { projectMessages } from "./messages.js";

export function createDraftNotice(root, saveId) {
  const notice = document.createElement("aside");
  notice.className = "draft-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  const message = document.createElement("p");
  const save = document.createElement("a");
  save.href = `#${saveId}`;
  save.addEventListener("click", (event) => {
    const button = document.getElementById(saveId);
    if (!button) return;
    event.preventDefault();
    button.scrollIntoView({ block: "center" });
    button.focus({ preventScroll: true });
  });
  notice.append(message, save);
  root.append(notice);
  let issue;
  function localize() {
    if (!issue) return;
    const copy =
      projectMessages[document.documentElement.lang] || projectMessages.id;
    message.textContent = copy[issue];
    save.textContent = copy.save;
  }
  return {
    localize,
    show(code) {
      issue = code;
      notice.hidden = false;
      localize();
    },
  };
}
