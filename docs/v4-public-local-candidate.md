# V4 public Preview — local review candidate

This is an explicit opt-in build, not deployment authorization. Culture/listening/device acceptance remains pending. Keep Gamelan Preview labeling and noindex. Owner authorized deployment on 15 October 2026. Default `npm run build` now selects the reviewed public Gamelan Preview mode; account settings, workflow, headers and lockfile are unchanged. Owner reported acceptance of seven checked samples, including natural Slenthem tail; exact WAV versions/device were unspecified. Culture/practitioner and additional device/mix checks remain pending and will be reported separately.

From the repository root, choose a fresh QA output directory:

```powershell
npm run build:gamelan-public -- qa-artifacts/my-public-preview
```

The command defaults to the accepted FLAC transport. It packages all202selected Gamelan assets, existing legacy assets, full notices/attribution, and102pre-reviewed source archives from `internal/gamelan-source-forms/archives`. Each source archive's name/size/SHA is checked against the manifest and original work coverage; localized source indexes and the current source-publication recipe are included. This does not add or alter musical recordings.

For PCM rollback use a separate fresh output:

```powershell
$env:PERKUSI_GAMELAN_DELIVERY='pcm'
npm run build:gamelan-public -- qa-artifacts/my-public-pcm
Remove-Item Env:PERKUSI_GAMELAN_DELIVERY
```

The public-mode runtime admits only localhost and the existing `perkusi.com`/`www.perkusi.com` hosts. Other hosts remain denied; private `gamelan-preview` mode still admits localhost only. Shared Studio mode remains `/studio/?workspace=gamelan&lang=id` or its EN counterpart. Locale navigation, privacy copy, source links, canonical/hreflang and Gamelan Preview entry are included. Indexing stays held, so Gamelan is deliberately absent from the sitemap until separately reviewed.

The public Vite mode also supports the existing Pages output convention: `vite build --mode gamelan-public-candidate` writes `dist` and defaults to FLAC without new account environment settings. The default build now selects this mode after independent review and explicit owner authorization. Existing Pages Git integration can retain `npm run build`/`dist`. No Cloudflare account change or Actions is required by this integration.

Default V3 rollback preserves browser keys but cannot import V4 projects as V3. Download V4JSON backups; keep `perkusi.workspace.gamelan.v4` and `perkusi.workspace.instrument-route.v4` untouched. Codec rollback keeps musical/project identities and source forms, with exact transport-specific hashes.

Before publication, complete applicable human acceptance, review release selection/noindex status and verify deployed SHA, actual public source downloads and production analytics/header receipts. Do not describe simulated public-host QA as a real deployment. Do not start V5/V6 from this local checkpoint.
