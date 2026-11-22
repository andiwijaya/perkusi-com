import { navigationHref } from "../app/routes.js";
import { messages } from "../i18n/messages.js";
import { tutorialGuides, tutorialTopics } from "./topics.js";

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

function indexTopics(tools, copy, all) {
  return tools.flatMap((tool) => {
    const name = copy[tutorialGuides[tool].nameKey];
    return tutorialTopics(tool).map((topic) => {
      const heading = copy[topic.titleKey];
      const titleWords = words(heading);
      const captionWords = words(copy[topic.captionKey] || "");
      const contentWords = [
        ...titleWords,
        ...words(copy[topic.bodyKey]),
        ...captionWords,
        ...(all && topic.recipe
          ? words(copy["tutorial.studio.recipeCaption"])
          : []),
        ...(all ? words(name) : []),
      ];
      return {
        ...topic,
        tool,
        name,
        heading,
        titleWords,
        captionWords,
        contentWords,
      };
    });
  });
}

function matchingTopics(query, entries, all) {
  if (!query.length) return [];
  const titles = [];
  const captions = [];
  const steps = [];
  const references = [];
  for (const entry of entries) {
    if (includesEveryWord(query, entry.titleWords)) titles.push(entry);
    else if (all && includesEveryWord(query, entry.captionWords))
      captions.push(entry);
    else if (includesEveryWord(query, entry.contentWords)) {
      (entry.step ? steps : references).push(entry);
    }
  }
  return [...titles, ...captions, ...steps, ...references];
}

export function initTutorialSearch() {
  const form = document.querySelector(".tutorial-search");
  if (!form) return;
  const tool = form.closest("[data-tutorial-tool]")?.dataset.tutorialTool;
  const all = !tool;
  const tools = all ? Object.keys(tutorialGuides) : [tool];
  const input = form.querySelector("input");
  const clear = form.querySelector("[data-tutorial-clear]");
  const status = form.querySelector("[role=status]");
  const results = form.querySelector(".tutorial-search-results");
  let locale, copy, entries;

  function render() {
    const matches = matchingTopics(words(input.value), entries, all);
    results.replaceChildren();
    for (const { id, tool: target, name, step, heading } of matches) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      if (all) {
        link.href = navigationHref(target, locale, id);
        const guide = document.createElement("span");
        guide.className = "tutorial-result-guide";
        guide.textContent = step
          ? name + " · " + copy["tutorial.search.step"].replace("{step}", step)
          : name;
        const title = document.createElement("span");
        title.textContent = heading;
        link.append(guide, title);
      } else {
        link.href = `#${id}`;
        link.dataset.tutorialJump = "";
        link.textContent = heading;
      }
      li.append(link);
      results.append(li);
    }
    results.hidden = matches.length === 0;
    clear.hidden = input.value.length === 0;
    let feedback = "";
    if (input.value.trim()) {
      if (matches.length === 0) feedback = copy["tutorial.search.empty"];
      else if (matches.length === 1) feedback = copy["tutorial.search.one"];
      else
        feedback = copy["tutorial.search.count"].replace(
          "{count}",
          matches.length,
        );
    }
    status.textContent = feedback;
  }

  function localize() {
    locale = document.documentElement.lang;
    copy = messages[locale];
    input.placeholder =
      copy[all ? "tutorial.search.allHint" : `tutorial.${tool}.searchHint`];
    if (all) input.value = history.state?.perkusiTutorialQuery ?? "";
    entries = indexTopics(tools, copy, all);
    render();
  }

  function updateQuery() {
    if (all) {
      try {
        // Keep the query available on Back without adding it to the URL.
        history.replaceState(
          { ...history.state, perkusiTutorialQuery: input.value },
          "",
        );
      } catch {
        // Search remains usable if history writes are unavailable.
      }
    }
    render();
  }

  function reset() {
    input.value = "";
    input.focus();
    updateQuery();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    results.querySelector("a")?.click();
  });
  input.addEventListener("input", updateQuery);
  clear.addEventListener("click", reset);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.value) {
      event.preventDefault();
      reset();
    }
  });
  document.addEventListener("perkusi:locale", localize);
  localize();
  form.hidden = false;
}
