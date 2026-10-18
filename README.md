# Perkusi.com

Browser-based Beatbox Playground, Rhythm Studio, Gamelan Preview and Loop Station Preview. Indonesian is the default; English has UI and metadata parity. V5 adds eight-track arranging, local recording, audio-bearing projects, mixer/FX and bounded WAV exports. Audio stays in the browser; no account or database is required. See the [V5 Preview release notes](docs/v5-preview-release.md) for the accepted scope and remaining device, latency and cultural limitations.

## Development

Requires Node.js 22.12+ (production pins 24.12.0) and npm.

```sh
npm ci
npm run dev
npm run lint
npm run build
npm run preview
npm run format
```

`npm run check` runs lint and the production build. The application uses semantic HTML, CSS, and vanilla JavaScript with Vite. Fonts are bundled locally. No server or database is required. No TypeScript typecheck applies.

`npm test` runs the Node unit suite. After `npm run build`, `npm run test:e2e` starts and closes a local Vite preview on port 4174 and checks routes, language precedence, session/DOM continuity, metadata, genuine 404s, keyboard navigation, and eight viewport widths in both languages. Browser QA requires Playwright and installed Chrome. On this Windows Codex host the runner uses the bundled package from `NODE_REPL_NODE_MODULE_DIRS`; elsewhere install Playwright locally. Set `PERKUSI_BROWSER_CHANNEL=msedge` to use installed Edge and `PERKUSI_QA_DIR` to choose a separate evidence directory. These tests do not use GitHub Actions or deploy.

Static entry shells are transformed at build/dev time by `src/app/document.js` and the Vite plugin. Copy, metadata, and ARIA labels share `src/i18n/messages.js`. Locale selection is explicit URL (`/en/` or `?lang=id|en`), then a saved preference, then `id`. Same-page language links use History API and update text/metadata without rebuilding the DOM or in-memory workspace session. Back/forward restores that page's selected locale. Storage failure does not block switching. `appType: mpa` and local 404 middleware prevent unknown paths from becoming homepage responses. Cloudflare uses the built static entries and existing `404.html`; live verification remains a later release gate.

## Internal audio prototype (S2)

S2 adds a shared audio domain and three original technical DSP fixtures. They are not accepted V1 vocal Beatbox sounds. The public Beatbox uses the separate twelve-asset Original Groove candidate. Normal production builds exclude `/internal/audio/` and all audio fixtures; the separate `audio-prototype` mode writes to ignored local QA output.

Run `npm run fixtures:audio` to recreate the source WAVs, `npm run build:audio-prototype` to build the internal route, and `npm run test:audio` for actual Chrome audio/lifecycle tests and a two-minute graph capture. `PERKUSI_AUDIO_FULL=0` runs the shorter browser smoke; `PERKUSI_AUDIO_CHANNEL=msedge` selects installed Edge; `PERKUSI_AUDIO_QA_DIR` selects separate evidence. Playwright comes from the same supported runtime as foundation tests. Human listening and physical devices require their own evidence.

See [audio architecture](docs/audio-architecture.md) and [asset provenance / sound acceptance](docs/asset-licenses.md). Local development can open `/internal/audio/?lang=id` after `npm run dev`; no microphone permission is requested.

## Deployment architecture

Repository: https://github.com/andiwijaya/perkusi-com

Production: https://perkusi.com

GitHub `main` → Cloudflare Pages Git integration → `perkusi.com`.

Cloudflare Pages project: `perkusi-com`. Production branch: `main`. Build command: `npm run build`. Build output: `dist`. Repository root is the build root. Every push to `main` triggers a production deployment through the Git integration; do not replace this with manual uploads. The existing Cloudflare zone and nameservers are retained. Both apex and www have proxied CNAME records pointing to `perkusi-com.pages.dev`. The zone rule `Canonical www to perkusi.com` redirects `http*://www.perkusi.com/*` to `https://perkusi.com/${2}` with HTTP 301 and preserves the query string. HTTP and HTTPS www redirects were verified with a nested path and query.

The existing Cloudflare Workers and Pages GitHub app uses **Only select repositories**. `perkusi-com` is included. New repositories must be explicitly added to this selection before their automatic deploys can work; listing a public repository in the Pages import screen alone does not grant webhook access.

`vite.config.js` writes `version.json` using Cloudflare's `CF_PAGES_COMMIT_SHA` and `CF_PAGES_BRANCH`. Compare `https://perkusi.com/version.json` with `git rev-parse HEAD` when verifying a deployment. Local builds report `local`.

## Analytics

The public GA4 Measurement ID is `G-G9ETDLX4XP` and lives in `src/analytics.js` (property: Perkusi.com, ID `557373402`; stream: Perkusi.com Web, ID `16043040251`). Reporting uses Asia/Jakarta and IDR. Analytics loads only for a production build served on `perkusi.com` or `www.perkusi.com`, keeping local and preview visits out of production data. Google signals and advertising personalization are disabled. The privacy page describes collection and opt-out options. Analytics blocking must not affect navigation or rendering.

## Files and maintenance

- `index.html`, `en/`, `beatbox/`, `studio/`, `privacy.html`, `404.html`: static entry shells; page content and metadata come from `src/app/document.js`.
- `src/style.css`: responsive styles; breakpoints at 1100px and 700px.
- `src/main.js`, `src/app/`: accessible navigation, locale updates, workspace session ownership, and footer year.
- `src/i18n/`, `src/styles/tokens.css`: complete ID/EN foundation copy and shared design tokens.
- `public/`: preserved favicon/social image, sitemap, robots, legacy privacy CSS, and unchanged Cloudflare security headers.
- `404.html`: genuine missing-page response on Cloudflare Pages.
- `scripts/social-card.py`: optional Pillow script to regenerate the social image; not required by the build.

Keep Studio and other upcoming tools visibly labeled until they exist. Test widths 360, 390, 430, 1280, 1440, and 1920px; menu click, Escape, and section navigation; no horizontal overflow; console errors; and production analytics requests. Deployments must have the canonical `https://perkusi.com/` metadata.

Foundation QA on October 5, 2026: clean `npm ci`, lint, and production build passed; npm audit reported zero vulnerabilities. Local and production layouts passed the six widths above without horizontal overflow. The production mobile menu, Escape key, and section navigation worked. GA4 Realtime received the correct homepage title and `page_view`, `first_visit`, `session_start`, and `user_engagement` events. Ignored `qa-artifacts/` holds local screenshots and verification evidence; it is not deployed or committed.

## V1 release candidate

The homepage links directly to the playable bilingual Beatbox. The production-only GA tag sends six narrowly scoped milestones without role IDs, variation choices, patterns or files. See `docs/v1-release.md` for acceptance qualifications, existing Git integration deployment and rollback. `public/THIRD-PARTY-NOTICES.txt` retains font and Vite notices. No Actions workflow is present or needed for the existing Pages Git integration.
