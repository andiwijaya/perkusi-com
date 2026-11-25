import { initTutorialScreenshots } from "./screenshots.js";

// Tutorial navigation moves focus and reveals instructions without starting audio.
export function initTutorialNavigation() {
  const guide = document.querySelector("[data-tutorial-tool]");
  if (!guide) return;
  if (guide.tagName !== "DETAILS") {
    initTutorialScreenshots(guide);
    return;
  }
  const root = guide.closest("main"),
    life = new AbortController();
  initTutorialScreenshots(guide, life.signal);
  root.classList.add("tutorial-enhanced");
  guide.addEventListener(
    "toggle",
    () => {
      if (guide.open) root.classList.add("tutorial-in-use");
    },
    { signal: life.signal },
  );
  const sticky = root.querySelector(
    ".ps-controls, .st-transport, .bb-transport",
  );
  const targets = new Set([
    "tutorial",
    ...[...guide.querySelectorAll("[data-tutorial-topic]")].map(
      (step) => step.id,
    ),
    ...[...root.querySelectorAll("[data-tutorial-jump]")].map((link) =>
      link.hash.slice(1),
    ),
  ]);
  function updateGap() {
    const style = sticky && getComputedStyle(sticky);
    const top = parseFloat(style?.top);
    const gap =
      style?.position === "sticky" && Number.isFinite(top)
        ? sticky.getBoundingClientRect().height + top + 14
        : 16;
    root.style.setProperty("--tutorial-scroll-gap", `${gap}px`);
  }
  function reveal(id) {
    if (!targets.has(id)) return;
    const target = document.getElementById(id);
    if (!target || !root.contains(target)) return;
    root.classList.add("tutorial-in-use");
    guide.open = guide.contains(target);
    for (
      let parent = target;
      parent && parent !== root;
      parent = parent.parentElement
    ) {
      if (parent.tagName === "DETAILS") parent.open = true;
    }
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    requestAnimationFrame(() => {
      updateGap();
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }
  root.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest("a[data-tutorial-jump]");
      if (
        !link ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const id = link.hash.slice(1);
      if (!targets.has(id) || !document.getElementById(id)) return;
      event.preventDefault();
      const step = link.closest(".tutorial-steps > li");
      if (step) {
        for (const back of root.querySelectorAll(".tutorial-return"))
          back.href = `#${step.id}`;
      }
      const source = link.closest(
        ".tutorial-steps > li, .tutorial-practice, .tutorial-destination",
      );
      if (
        source?.id &&
        targets.has(source.id) &&
        location.hash !== `#${source.id}`
      ) {
        history.replaceState(history.state, "", `#${source.id}`);
      }
      if (location.hash !== link.hash)
        history.pushState(history.state, "", link.hash);
      reveal(id);
    },
    { signal: life.signal },
  );
  const restore = () => reveal(location.hash.slice(1));
  window.addEventListener("popstate", restore, { signal: life.signal });
  window.addEventListener("hashchange", restore, { signal: life.signal });
  window.addEventListener("resize", updateGap, { signal: life.signal });
  const observer = new ResizeObserver(updateGap);
  if (sticky) observer.observe(sticky);
  updateGap();
  if (location.hash) restore();
  window.addEventListener(
    "pagehide",
    () => {
      life.abort();
      observer.disconnect();
    },
    { once: true },
  );
}
