// Reserve space for the actual sticky transport, including the focus outline.
export function focusScrollDelta(target, panel, viewportHeight, padding = 12) {
  const overlapsHorizontally =
    target.left < panel.right && target.right > panel.left;
  const panelVisible = panel.bottom > 0 && panel.top < viewportHeight;
  const overlapsVertically =
    target.top < panel.bottom + padding && target.bottom > panel.top - padding;
  const ceiling =
    overlapsHorizontally && overlapsVertically && panelVisible
      ? Math.min(viewportHeight - padding, panel.top - padding)
      : viewportHeight - padding;
  if (target.bottom > ceiling) return target.bottom - ceiling;
  if (target.top < padding) return target.top - padding;
  return 0;
}

export function initFocusVisibility(root) {
  const panel = root.querySelector(".bb-transport");
  let frame;
  let followUntil = 0;
  function reveal() {
    const target = document.activeElement;
    if (
      !root.contains(target) ||
      !target.matches("button,input,select,a,summary") ||
      !target.matches(":focus-visible") ||
      panel.contains(target)
    )
      return;
    // A second measurement handles movement of the panel near the page bottom.
    for (let pass = 0; pass < 2; pass++) {
      const delta = focusScrollDelta(
        target.getBoundingClientRect(),
        panel.getBoundingClientRect(),
        innerHeight,
      );
      if (Math.abs(delta) < 1) break;
      window.scrollBy({ top: delta, behavior: "instant" });
    }
  }
  function requestReveal() {
    followUntil = performance.now() + 300;
    reveal();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(reveal);
  }
  function afterScroll() {
    // Finish a keyboard focus move even when an earlier wheel scroll is still
    // settling in the compositor. A new pointer/wheel intent ends this window.
    if (performance.now() < followUntil) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    }
  }
  function stopFollowing() {
    followUntil = 0;
    cancelAnimationFrame(frame);
  }
  root.addEventListener("focusin", requestReveal);
  root.addEventListener("keydown", requestReveal);
  window.addEventListener("resize", requestReveal);
  window.addEventListener("scroll", afterScroll, { passive: true });
  window.addEventListener("wheel", stopFollowing, { passive: true });
  window.addEventListener("pointerdown", stopFollowing, { passive: true });
  const observer = new ResizeObserver(requestReveal);
  observer.observe(panel);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    root.removeEventListener("focusin", requestReveal);
    root.removeEventListener("keydown", requestReveal);
    window.removeEventListener("resize", requestReveal);
    window.removeEventListener("scroll", afterScroll);
    window.removeEventListener("wheel", stopFollowing);
    window.removeEventListener("pointerdown", stopFollowing);
  };
}
