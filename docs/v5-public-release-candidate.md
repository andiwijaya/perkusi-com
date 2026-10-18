# V5 public release promotion candidate

Historical promotion checkpoint. The final independently reviewed source and owner's 18 October 2026 deployment authorization are described in [V5 Preview release](v5-preview-release.md). The older build identities and pending statuses below document the earlier preparation, not the current release acceptance.

This prepares publication; it is not deployment approval. The accepted local build `bdbcfb4e-81c5-479f-92bf-a9f33ff71b26` remains intact at `qa-artifacts/v5-current-build` for the arranged user/device session. Its source is `2173878a6134c8d17096ba0435fdc6637503ebcdae4bea89da4db5d284ead050`. No preview server or microphone is started by this preparation.

The new explicit `gamelan-v5-public-candidate` mode combines the existing V5 UI/assets with the existing production hostname allowance. `npm run build` selects it for the existing Pages `dist` convention. `npm run build:v5` still selects the private local mode; the V4 public builder still selects its original public mode. Output/lease/seal guards remain. Build payload planning includes V5 derivatives and their original source forms.

The candidate is built separately with:

```powershell
npm run build -- --outDir qa-artifacts/v5-release-promotion-2026-10-17/build --retain-previous
```

Loop Station is available only on loopback hosts or, in the explicit public build, `perkusi.com`/`www.perkusi.com`. Arbitrary Pages preview hosts remain denied. Cold ID/EN HTML and runtime locale changes carry canonical/hreflang/description/OG title/URL for `/loop-station/` and `/en/loop-station/`. Loop Station stays noindex; ordinary public Studio keeps its existing indexability, and query-selected Gamelan Studio retains its runtime Preview metadata. No sitemap promotion is included. Gamelan remains **Preview**, with no new cultural or authentic-set claim.

## Microphone policy: approved scoped local integration

User approval “boleh bud”, `Sentinel_1bd8b3e838a88191a193b770725364b9`, 17 October 2026 12:03:14 UTC, authorizes same-origin mic policy only on Loop Station. `public/_headers` and the candidate now keep the original global denial and detach/replace Permissions-Policy only on six exact document paths. Camera/geolocation denial, CSP and every other security header are unchanged. This approval does not authorize real mic capture or deployment. The accepted private build retains its original header bytes.

Only the Loop Station document routes need mic permission:

- `/loop-station/`, `/loop-station`, `/loop-station/index.html`.
- `/en/loop-station/`, `/en/loop-station`, `/en/loop-station/index.html`.
- Query variants such as `?lang=id|en` and `?view=studio` use the same document policy. Bare/index aliases have explicit rules so redirects or direct document serving cannot create an inconsistent mic route. Unknown descendants are excluded and remain denied; no directory wildcard allowance is used.

Ordinary `/studio/`, `/en/studio/`, Gamelan/credits, Beatbox, homepage, assets and source downloads do not need mic permission. The Loop Station Studio view remains on the Loop Station path. No camera, geolocation, cross-origin iframe delegation, new CSP domain, account or DNS change is proposed.

The [applied local header delta](../qa-artifacts/v5-release-promotion-2026-10-17/APPLIED-MIC-HEADERS.patch) uses `! Permissions-Policy` then `camera=(), microphone=(self), geolocation=()` on each exact path. Cloudflare documents that overlapping rules combine duplicate headers, and supports detaching a pervasive header; simply appending another microphone directive is insufficient. The pinned official parser/matcher/header-application functions pass 40 cases with no invalid rules. Native Chrome policy checks on locally fulfilled compiled HTTPS responses confirm same-origin mic allowance only on these documents, denial elsewhere, and camera/geolocation/foreign-mic denial, with zero acquisition calls. These checks are not live Pages edge receipts. Effective production responses still need post-deploy verification. [Cloudflare Pages header documentation](https://developers.cloudflare.com/pages/configuration/headers/).

The earlier wildcard proposal remains retained as `PROPOSED-MIC-HEADERS.patch` for history; it was never applied and is superseded by the narrower exact-path delta. Bilingual public intro/home copy now describes available recording/FX without saying they are local-only; privacy copy describes optional explicit mic activation, local audio processing and opt-in local profiles. No analytics settings, event payload or capture behavior is changed.

## Existing acceptance and release sequence

The seven unchanged Gamelan observations already have **OWNER-REPORTED ACCEPT**, quote “memudar alami bud, semua saya sudah cek, ok”, 15 October 2026 05:17:14 UTC, `Sentinel_71edcf044c7c8191815c9c2f677917e5`. The natural tail of fs-261953 is explicitly accepted. This collective sample acceptance does not identify all 21 WAV/device combinations, accept new mix/demos or establish Central-Javanese/set qualification. Do not ask for a formal repeat of those seven samples without a new issue. Musical mix/instrument, cultural and real device/latency gates retain their actual remaining scope. Suling is deferred from V5 by explicit user decision, without a promised later version.

After the arranged physical session, review of the final release delta and explicit publication authorization: use the existing repository/main and Pages Git integration, no Actions. Preserve the approved artifact and source mapping, stage only reviewed inputs, exclude QA/cache/build output, and push normally once authorized. Verify the new exact commit/branch in production `version.json`, ID/EN Loop Station and legacy routes, effective headers, lazy gesture behavior, sample/source availability, true 404 and existing analytics behavior. Do not substitute a local `version.json` reporting `local` for production revision proof.

The V5 rollback baseline is the currently live V4 commit `9a7f4a38e720639b8a6a70276bada0f127156f25`, deployment `79854fd8-5065-4932-a3a1-9c12ff9eb657`. An authorized rollback can restore that existing successful Pages deployment or apply a reviewed normal revert on main, then verify the old production SHA, V4 behavior and denial policy. Do not force-push or clear site data. Download `.perkusi` with audio and WAV backups first; retain IndexedDB `perkusi.loop-audio.v1`, V5 draft/profile keys and V4 keys. V4 cannot edit a V5 audio project, but rollback must not erase it. No rollback is performed here.
