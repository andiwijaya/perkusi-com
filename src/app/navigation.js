export function initNavigation() {
  const toggle = document.querySelector(".menu-toggle");
  const navigation = document.querySelector("#navigation");
  if (!toggle || !navigation) return;
  const setExpanded = (expanded) => {
    toggle.setAttribute("aria-expanded", String(expanded));
    navigation.classList.toggle("is-open", expanded);
  };
  const close = () => setExpanded(false);
  const onToggle = () =>
    setExpanded(toggle.getAttribute("aria-expanded") !== "true");
  const onNavigate = (event) => {
    if (event.target.closest("a")) close();
  };
  const onKey = (event) => {
    if (
      event.key === "Escape" &&
      toggle.getAttribute("aria-expanded") === "true"
    ) {
      close();
      toggle.focus();
    }
  };
  toggle.addEventListener("click", onToggle);
  navigation.addEventListener("click", onNavigate);
  document.addEventListener("keydown", onKey);
  return () => {
    toggle.removeEventListener("click", onToggle);
    navigation.removeEventListener("click", onNavigate);
    document.removeEventListener("keydown", onKey);
  };
}
