# Perkusi.com

Browser-based rhythm, percussion, and loop tools for musicians. This repository establishes the production foundation: a responsive landing page that clearly identifies future tools as upcoming. It does not implement the Loop Station.

## Development

Requires Node.js 22.12+ (production pins 24.12.0) and npm.

```sh
npm ci
npm run dev
npm run lint
npm run build
npm run preview
```

`npm run check` runs lint and the production build. The application uses semantic HTML, CSS, and vanilla JavaScript with Vite. Fonts are bundled locally. No server or database is required. No TypeScript typecheck applies.

## Deployment architecture

Repository: https://github.com/andiwijaya/perkusi-com

Production: https://perkusi.com

GitHub `main` → Cloudflare Pages Git integration → `perkusi.com`.

Cloudflare Pages project: `perkusi-com`. Production branch: `main`. Build command: `npm run build`. Build output: `dist`. Repository root is the build root. Every push to `main` triggers a production deployment through the Git integration; do not replace this with manual uploads. The existing Cloudflare zone and nameservers are retained. `www.perkusi.com` redirects to the canonical apex through a Cloudflare redirect rule.

`vite.config.js` writes `version.json` using Cloudflare's `CF_PAGES_COMMIT_SHA` and `CF_PAGES_BRANCH`. Compare `https://perkusi.com/version.json` with `git rev-parse HEAD` when verifying a deployment. Local builds report `local`.

## Analytics

The public GA4 Measurement ID is `G-G9ETDLX4XP` and lives in `src/analytics.js` (stream: Perkusi.com Web, ID `16043040251`). Reporting uses Asia/Jakarta and IDR. Analytics loads only for a production build served on `perkusi.com` or `www.perkusi.com`, keeping local and preview visits out of production data. Google signals and advertising personalization are disabled. The privacy page describes collection and opt-out options. Analytics blocking must not affect navigation or rendering.

## Files and maintenance

- `index.html`: homepage content and production SEO metadata.
- `src/style.css`: responsive styles; breakpoints at 1100px and 700px.
- `src/main.js`: accessible mobile navigation and footer year.
- `public/`: favicon, social image, sitemap, robots, privacy page, and Cloudflare security headers.
- `404.html`: genuine missing-page response on Cloudflare Pages.
- `scripts/social-card.py`: optional Pillow script to regenerate the social image; not required by the build.

Keep upcoming tools visibly labeled until they exist. Test widths 360, 390, 430, 1280, 1440, and 1920px; menu click, Escape, and section navigation; no horizontal overflow; console errors; and production analytics requests. Deployments must have the canonical `https://perkusi.com/` metadata.
