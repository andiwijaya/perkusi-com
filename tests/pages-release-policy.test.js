import test from "node:test";
import assert from "node:assert/strict";
import { loadConfigFromFile } from "vite";
import { pagesReleaseMode } from "../scripts/pages-release-policy.mjs";

test("Pages main build selects optional Preview with ordinary Studio default; local and branches keep requested modes", () => {
  const mode = "gamelan-v5-public-candidate";
  assert.equal(pagesReleaseMode(mode, {}), mode);
  assert.equal(
    pagesReleaseMode(mode, { CF_PAGES: "1", CF_PAGES_BRANCH: "review" }),
    mode,
  );
  assert.equal(
    pagesReleaseMode(mode, { CF_PAGES: "0", CF_PAGES_BRANCH: "main" }),
    mode,
  );
  const env = {
    CF_PAGES: "1",
    CF_PAGES_BRANCH: "main",
    CF_PAGES_COMMIT_SHA: "a".repeat(40),
  };
  assert.equal(pagesReleaseMode(mode, env), "gamelan-v5-canonical-release");
  assert.throws(
    () => pagesReleaseMode("gamelan-v5-final", env),
    /unreviewedPagesProductionMode/,
  );
  assert.throws(
    () => pagesReleaseMode(mode, { ...env, CF_PAGES_COMMIT_SHA: "local" }),
    /missingPagesCommitIdentity/,
  );
  assert.throws(
    () => pagesReleaseMode("audio-prototype", env),
    /unreviewedPagesProductionMode/,
  );
});

test("all current public build modes retain the schema6 recovery reader, including canonical-off fallback", async () => {
  for (const mode of [
    "gamelan-public-candidate",
    "gamelan-v5-public-candidate",
    "gamelan-v5-canonical-release",
    "gamelan-v5-final",
  ]) {
    const result = await loadConfigFromFile(
      { command: "build", mode },
      "vite.config.js",
    );
    const input = result.config.build.rollupOptions.input;
    assert.equal(input.recoveryId, "studio/recovery/index.html");
    assert.equal(input.recoveryEn, "en/studio/recovery/index.html");
    assert.equal(
      result.config.define["import.meta.env.CANONICAL_PUBLIC_PREVIEW"],
      JSON.stringify(mode === "gamelan-v5-canonical-release"),
    );
    assert(!Object.keys(input).some((k) => /^qa/i.test(k)));
  }
});
