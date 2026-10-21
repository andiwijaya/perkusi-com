import test from "node:test";
import assert from "node:assert/strict";
import { loadConfigFromFile } from "vite";
import { pagesReleaseMode } from "../scripts/pages-release-policy.mjs";

test("Pages main legacy command selects two-tool retirement release; local and branches keep requested modes", () => {
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
  assert.equal(pagesReleaseMode(mode, env), "retirement-release");
  assert.equal(
    pagesReleaseMode("retirement-release", env),
    "retirement-release",
  );
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

test("supported release/review/prototype modes retain isolated recovery and cannot define failed activation flags", async () => {
  for (const mode of [
    "production",
    "retirement-release",
    "retirement-review",
    "audio-prototype",
  ]) {
    const result = await loadConfigFromFile(
        { command: "build", mode },
        "vite.config.js",
      ),
      input = result.config.build.rollupOptions.input;
    assert.equal(input.recoveryId, "studio/recovery/index.html");
    assert.equal(input.recoveryEn, "en/studio/recovery/index.html");
    assert.equal(input.originalsId, "studio/recovery/originals/index.html");
    assert.equal(result.config.define, undefined);
    assert.equal(result.config.resolve?.alias, undefined);
    assert(!Object.keys(input).some((k) => /^qa/i.test(k)));
  }
});
