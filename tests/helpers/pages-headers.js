// Bounded test model for this repository's exact paths and global /* rule.
// Cloudflare applies matched rules in order: detach, then attach/append.
// The release QA additionally executes the pinned upstream parser/runtime.
export function pagesHeaderRules(text) {
  const rules = [];
  let rule;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("/")) {
      if (line !== "/*" && !/^\/[a-z/-]+(?:index\.html)?$/.test(line))
        throw Error("Unsupported test route");
      rules.push((rule = { path: line, set: {}, unset: [] }));
    } else if (line.startsWith("! ")) {
      rule.unset.push(line.slice(2).toLowerCase());
    } else {
      const colon = line.indexOf(":");
      if (!rule || colon < 1) throw Error("Invalid test header");
      rule.set[line.slice(0, colon).toLowerCase()] = line
        .slice(colon + 1)
        .trim();
    }
  }
  return rules;
}
export function effectivePagesHeaders(text, url) {
  const path = new URL(url).pathname,
    headers = new Headers(),
    set = new Set();
  for (const rule of pagesHeaderRules(text)) {
    if (rule.path !== "/*" && rule.path !== path) continue;
    for (const name of rule.unset) headers.delete(name);
    for (const [name, value] of Object.entries(rule.set)) {
      if (set.has(name)) headers.append(name, value);
      else {
        headers.set(name, value);
        set.add(name);
      }
    }
  }
  return Object.fromEntries(headers);
}
