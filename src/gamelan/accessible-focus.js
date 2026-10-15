// Preserve keyboard position when the composition UI rebuilds after an edit.
// Native Tab keeps its intended next control rather than returning to the body.
export function focusKeeper(host) {
  const doc = host.ownerDocument;
  let pendingTab = null;
  const eligible = (node) =>
    node && !node.disabled && node.isConnected && node.getClientRects().length;
  function describe(node) {
    if (!host.contains(node)) return { outside: node };
    const path = [];
    let current = node;
    while (current !== host) {
      const parent = current.parentElement;
      path.unshift([...parent.children].indexOf(current));
      current = parent;
    }
    return {
      path,
      tag: node.tagName,
      type: node.type,
      step: node.dataset.step,
    };
  }
  function resolve(saved) {
    if (saved.outside) return saved.outside;
    if (saved.step)
      return [...host.querySelectorAll("[data-step]")].find(
        (node) => node.dataset.step === saved.step,
      );
    let node = host;
    for (const index of saved.path) node = node?.children[index];
    return node?.tagName === saved.tag && node.type === saved.type
      ? node
      : null;
  }
  host.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey)
      return;
    const controls = [
      ...doc.querySelectorAll(
        "a[href],button,input,select,textarea,summary,[tabindex='0']",
      ),
    ].filter(eligible);
    const index = controls.indexOf(event.target),
      next = controls[index + (event.shiftKey ? -1 : 1)];
    if (index < 0 || !next) return;
    const intent = { from: event.target, target: describe(next) };
    pendingTab = intent;
    setTimeout(() => {
      if (pendingTab === intent) pendingTab = null;
    }, 0);
  });
  return {
    capture() {
      const from = pendingTab?.from ?? doc.activeElement;
      const scrolls = [...host.querySelectorAll("*")]
        .filter((node) => node.scrollLeft || node.scrollTop)
        .map((node) => ({
          node: describe(node),
          left: node.scrollLeft,
          top: node.scrollTop,
        }));
      return {
        from: host.contains(from) ? from : null,
        target: host.contains(from)
          ? (pendingTab?.target ?? describe(from))
          : null,
        scrolls,
      };
    },
    restore(saved) {
      if (!saved) return;
      for (const scroll of saved.scrolls) {
        const node = resolve(scroll.node);
        if (node) {
          node.scrollLeft = scroll.left;
          node.scrollTop = scroll.top;
        }
      }
      if (!saved.from || saved.from.isConnected) return;
      queueMicrotask(() => {
        if (doc.activeElement !== doc.body && doc.activeElement.isConnected)
          return;
        const target = resolve(saved.target);
        if (eligible(target)) target.focus({ preventScroll: true });
        else {
          const fallback =
            host
              .closest(".instrument-studio")
              ?.querySelector("#is-pause:enabled") ?? host.querySelector("h3");
          if (fallback) {
            if (fallback.tagName === "H3") fallback.tabIndex = -1;
            fallback.focus({ preventScroll: true });
          }
        }
      });
    },
  };
}
