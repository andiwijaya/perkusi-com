import { tutorialPairs } from "./messages.js";

function words(text) {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function includesEveryWord(query, source) {
  return query.every((term) =>
    source.some((word) =>
      term.length === 1 ? word === term : word.startsWith(term),
    ),
  );
}

export function initTutorialSearch(guide, signal) {
  const form = guide.querySelector(".tutorial-search");
  const input = form.querySelector("input");
  const clear = form.querySelector("[data-tutorial-clear]");
  const status = form.querySelector("[role=status]");
  const results = form.querySelector(".tutorial-search-results");
  const topics = [...guide.querySelectorAll("[data-tutorial-topic]")].map(
    (element) => ({
      element,
      heading: element.querySelector("h3"),
      copy: [...element.querySelectorAll(":scope > p, figcaption > span")],
    }),
  );
  const options = { signal };

  function render() {
    const index = document.documentElement.lang === "en" ? 1 : 0;
    const text = (key) => tutorialPairs[key][index];
    input.placeholder = text(
      `tutorial.${guide.dataset.tutorialTool}.searchHint`,
    );
    const query = words(input.value);
    const titleMatches = [];
    const otherMatches = [];
    if (query.length) {
      for (const topic of topics) {
        const title = words(topic.heading.textContent);
        if (includesEveryWord(query, title)) {
          titleMatches.push(topic);
        } else {
          const body = topic.copy.flatMap((el) => words(el.textContent));
          if (includesEveryWord(query, [...title, ...body]))
            otherMatches.push(topic);
        }
      }
    }

    const matches = [...titleMatches, ...otherMatches];
    results.replaceChildren();
    for (const { element, heading } of matches) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${element.id}`;
      link.dataset.tutorialJump = "";
      link.textContent = heading.textContent;
      li.append(link);
      results.append(li);
    }
    results.hidden = matches.length === 0;
    clear.hidden = input.value.length === 0;
    let feedback = "";
    if (input.value.trim()) {
      if (matches.length === 0) feedback = text("tutorial.search.empty");
      else if (matches.length === 1) feedback = text("tutorial.search.one");
      else
        feedback = text("tutorial.search.count").replace(
          "{count}",
          matches.length,
        );
    }
    status.textContent = feedback;
  }

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      results.querySelector("a")?.click();
    },
    options,
  );
  input.addEventListener("input", render, options);
  function reset() {
    input.value = "";
    input.focus();
    render();
  }
  clear.addEventListener("click", reset, options);
  input.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && input.value) {
        event.preventDefault();
        reset();
      }
    },
    options,
  );
  document.addEventListener("perkusi:locale", render, options);
  render();
  form.hidden = false;
}
