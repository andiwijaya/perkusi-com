export function initNavigation() {
  const toggle = document.querySelector(".menu-toggle");
  const navigation = document.querySelector("#navigation");
  if (!toggle || !navigation) return;
  const setExpanded = (expanded) => {
    toggle.setAttribute("aria-expanded", String(expanded));
    navigation.classList.toggle("is-open", expanded);
  };
  const close = () => setExpanded(false);
  toggle.addEventListener("click", () =>
    setExpanded(toggle.getAttribute("aria-expanded") !== "true"),
  );
  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) close();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      toggle.getAttribute("aria-expanded") === "true"
    ) {
      close();
      toggle.focus();
    }
  });
}
