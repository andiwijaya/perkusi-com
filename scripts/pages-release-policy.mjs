// Deliberate approved production selection for the existing Pages Git build.
// Local npm run build and non-main preview branches retain their requested mode.
export const PAGES_PREVIEW_RELEASE = Object.freeze({
  branch: "main",
  mode: "gamelan-v5-canonical-release",
  legacyStudioDefault: true,
  recoveryRequired: true,
});

export function pagesReleaseMode(requested, env = process.env) {
  if (
    env.CF_PAGES !== "1" ||
    env.CF_PAGES_BRANCH !== PAGES_PREVIEW_RELEASE.branch
  )
    return requested;
  if (
    !["gamelan-v5-public-candidate", PAGES_PREVIEW_RELEASE.mode].includes(
      requested,
    )
  )
    throw Error("unreviewedPagesProductionMode");
  if (!/^[a-f0-9]{40}$/.test(env.CF_PAGES_COMMIT_SHA ?? ""))
    throw Error("missingPagesCommitIdentity");
  return PAGES_PREVIEW_RELEASE.mode;
}
