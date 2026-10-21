import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "qa-artifacts/**",
      ".local-candidates/**",
      "internal/media-library/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js", "internal/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      "*.config.js",
      "tests/**/*.js",
      "scripts/**/*.mjs",
      "deliverables/**/*.mjs",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      "scripts/test-browser.mjs",
      "scripts/test-audio.mjs",
      "scripts/test-audio-repair.mjs",
      "scripts/test-sound-assets.mjs",
      "scripts/test-beatbox.mjs",
      "scripts/test-beatbox-repair.mjs",
      "scripts/test-v1-release.mjs",
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
