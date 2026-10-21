// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import { renderSiteShell } from "../src/app/site-shell.js";

test("shared brand keeps explicit Indonesian home and English home while Gamelan locale links retain workspace", () => {
  const id = renderSiteShell("studio", "id", {
    languageHref: (lang) => "/studio/?workspace=gamelan&lang=" + lang,
  });
  const en = renderSiteShell("studio", "en");
  assert.match(id.brand, /href="\/\?lang=id"/);
  assert.match(en.brand, /href="\/en\/"/);
  assert.match(
    id.header,
    /data-locale="en" href="\/studio\/\?workspace=gamelan&lang=en"/,
  );
  assert.match(id.header, /<a class="brand"[^>]*aria-label=/);
  assert.match(id.header, /aria-controls="navigation"/);
});
