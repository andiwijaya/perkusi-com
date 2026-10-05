import { initAnalytics } from "./analytics.js";

const toggle = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#navigation");

function closeMenu() {
  toggle.setAttribute("aria-expanded", "false");
}

toggle.addEventListener("click", () => {
  toggle.setAttribute(
    "aria-expanded",
    String(toggle.getAttribute("aria-expanded") !== "true"),
  );
});
navigation.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    toggle.getAttribute("aria-expanded") === "true"
  ) {
    closeMenu();
    toggle.focus();
  }
});
document.querySelector("#year").textContent = String(new Date().getFullYear());
initAnalytics();
