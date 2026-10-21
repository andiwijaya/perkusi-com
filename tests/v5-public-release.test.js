import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import config from "../vite.config.js";
import { renderDocument } from "../src/app/document.js";
import {
  effectivePagesHeaders,
  pagesHeaderRules,
} from "./helpers/pages-headers.js";
import { publicCandidateHTML } from "../scripts/gamelan-public-pages.mjs";
import {
  gamelanHostAllowed,
  loopPublicMetadata,
  syncLoopPublicMetadata,
} from "../src/gamelan/public-context.js";
import { instrumentRouteContext } from "../src/gamelan/route-context.js";

test("final home retains Rhythm Studio and neutral instrument copy in ID and EN", () => {
  const cfg = config({ mode: "gamelan-v5-final" });
  assert.equal(cfg.define["import.meta.env.CANONICAL_FINAL_STUDIO"], "true");
  assert.equal(cfg.define["import.meta.env.CANONICAL_PUBLIC_PREVIEW"], "false");
  for (const locale of ["id", "en"]) {
    const html = publicCandidateHTML(renderDocument("home", locale), {
      page: "home",
      locale,
      v5UX: true,
      finalStudio: true,
    });
    assert(html.includes('data-i18n="home.card2.title"'));
    assert(!html.includes("data-v5-loop-card"));
    assert(!html.includes('data-i18n="common.gamelanPreview"'));
    assert(html.includes('data-i18n="common.gamelan"'));
  }
});

test("V5 public selection includes both Loop Station entries/assets while private and V4 modes keep their boundaries", () => {
  const publicV5 = config({ mode: "gamelan-v5-public-candidate" }),
    local = config({ mode: "gamelan-v5-ux" }),
    v4 = config({ mode: "gamelan-public-candidate" });
  assert.equal(publicV5.define["import.meta.env.GAMELAN_V5_UX"], "true");
  assert.equal(publicV5.define["import.meta.env.GAMELAN_PUBLIC_BUILD"], "true");
  assert.equal(publicV5.define["import.meta.env.GAMELAN_DELIVERY"], '"flac"');
  assert.equal(local.define["import.meta.env.GAMELAN_PUBLIC_BUILD"], "false");
  assert.equal(v4.define["import.meta.env.GAMELAN_V5_UX"], "false");
  assert.equal(v4.build.rollupOptions.input.loopId, undefined);
  assert.equal(
    publicV5.build.rollupOptions.input.loopId,
    "loop-station/index.html",
  );
  assert.equal(
    publicV5.build.rollupOptions.input.loopEn,
    "en/loop-station/index.html",
  );
  assert.deepEqual(
    instrumentRouteContext(
      "/studio/",
      "?workspace=gamelan",
      "gamelan-v5-public-candidate",
    ),
    { studio: true },
  );
  for (const host of ["perkusi.com", "www.perkusi.com"]) {
    assert(
      gamelanHostAllowed(
        host,
        JSON.parse(publicV5.define["import.meta.env.GAMELAN_PUBLIC_BUILD"]),
      ),
    );
    assert(
      !gamelanHostAllowed(
        host,
        JSON.parse(local.define["import.meta.env.GAMELAN_PUBLIC_BUILD"]),
      ),
    );
  }
  for (const host of ["evil.test", "perkusi.com.evil.test", "foo.pages.dev"])
    assert(!gamelanHostAllowed(host, true));
});

test("cold ID/EN Loop Station pages carry canonical alternates and Preview metadata while ordinary public Studio remains indexable", () => {
  const cfg = config({ mode: "gamelan-v5-public-candidate" }),
    transform = cfg.plugins.find((p) => p.name === "localized-static-pages")
      .transformIndexHtml.handler;
  for (const locale of ["id", "en"]) {
    const path = (locale === "en" ? "/en" : "") + "/loop-station/",
      html = transform(readFileSync("." + path + "index.html", "utf8"), {
        path: path + "index.html",
      }),
      meta = loopPublicMetadata(locale);
    assert(html.includes('name="robots" content="noindex,nofollow"'));
    assert(html.includes('rel="canonical" href="' + meta.canonical + '"'));
    assert(html.includes('hreflang="x-default"'));
    assert(html.includes(meta.title));
    assert(html.includes('name="description"'));
    assert(!meta.canonical.includes("?"));
  }
  const studio = readFileSync("studio/index.html", "utf8");
  assert(
    !transform(studio, { path: "/studio/index.html" }).includes(
      'name="robots" content="noindex,nofollow"',
    ),
  );
  const local = config({ mode: "gamelan-v5-ux" }).plugins.find(
    (p) => p.name === "localized-static-pages",
  ).transformIndexHtml.handler;
  assert(
    local(studio, { path: "/studio/index.html" }).includes(
      'name="robots" content="noindex,nofollow"',
    ),
  );
});

test("runtime locale metadata follows the selected language without creating an audio context", () => {
  const previous = globalThis.document,
    nodes = new Map();
  globalThis.document = {
    head: {
      querySelector: (s) => nodes.get(s),
      append(node) {
        nodes.set(node.selector, node);
      },
    },
    createElement(tag) {
      return {
        setAttribute(k, v) {
          this[k] = v;
          if (
            ["rel", "name", "property", "hreflang"].includes(k) &&
            !this.selector
          )
            this.selector = tag + "[" + k + '="' + v + '"]';
        },
      };
    },
  };
  try {
    for (const locale of ["id", "en", "id"]) {
      const m = syncLoopPublicMetadata(locale);
      assert.equal(globalThis.document.title, m.title);
      assert.equal(nodes.get('link[rel="canonical"]').href, m.canonical);
      assert.equal(
        nodes.get('meta[name="description"]').content,
        m.description,
      );
      assert.equal(
        nodes.get('link[hreflang="en"]').href,
        "https://perkusi.com/en/loop-station/",
      );
    }
  } finally {
    if (previous) globalThis.document = previous;
    else delete globalThis.document;
  }
});

test("default build selects optional Preview while rendering and global mic denial remain bounded", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts.build,
    "node scripts/local-build.mjs --mode gamelan-v5-canonical-release",
  );
  assert.match(
    readFileSync("public/_headers", "utf8"),
    /camera=\(\), microphone=\(\), geolocation=\(\)/,
  );
  const html = publicCandidateHTML(renderDocument("home", "id"), {
    page: "home",
    locale: "id",
    v5UX: true,
  });
  assert.match(html, /Gamelan Preview/);
  assert.match(html, /data-loop-link/);
});

test("approved mic permission is same-origin only on exact bilingual Loop Station and Studio document aliases", () => {
  const text = readFileSync("public/_headers", "utf8"),
    rules = pagesHeaderRules(text),
    paths = [
      "/loop-station",
      "/loop-station/",
      "/loop-station/index.html",
      "/en/loop-station",
      "/en/loop-station/",
      "/en/loop-station/index.html",
      "/studio",
      "/studio/",
      "/studio/index.html",
      "/en/studio",
      "/en/studio/",
      "/en/studio/index.html",
    ];
  assert.deepEqual(
    rules.slice(1).map((r) => r.path),
    paths,
  );
  for (const path of paths)
    for (const query of ["", "?lang=id", "?lang=en&view=studio"]) {
      const h = effectivePagesHeaders(
        text,
        "https://perkusi.com" + path + query,
      );
      assert.equal(
        h["permissions-policy"],
        "camera=(), microphone=(self), geolocation=()",
      );
      assert.equal(h["x-frame-options"], "DENY");
      assert.equal(
        h["content-security-policy"],
        rules[0].set["content-security-policy"],
      );
    }
});

test("other documents, missing descendants and lookalike paths retain the original denial and security headers", () => {
  const text = readFileSync("public/_headers", "utf8");
  for (const path of [
    "/",
    "/en/",
    "/beatbox/",
    "/gamelan/",
    "/gamelan/credits/",
    "/privacy.html",
    "/404.html",
    "/assets/app.js",
    "/loop-station/unknown",
    "/loop-station-evil/",
    "/LOOP-STATION/",
    "/en/loop-station/extra",
    "/studio/unknown",
    "/studio-evil/",
    "/STUDIO/",
    "/en/studio/extra",
  ]) {
    const h = effectivePagesHeaders(text, "https://perkusi.com" + path);
    assert.equal(
      h["permissions-policy"],
      "camera=(), microphone=(), geolocation=()",
      path,
    );
    assert.equal(h["x-frame-options"], "DENY");
  }
});
