// Existing Pages main command also accepts its historical mode spelling.
// Every main release resolves to two-tool retirement, never Preview activation.
export const PAGES_RELEASE = Object.freeze({
  branch: "main",
  mode: "retirement-release",
  legacyStudioDefault: true,
  recoveryRequired: true,
});

export function pagesReleaseMode(requested, env = process.env) {
  if (env.CF_PAGES !== "1" || env.CF_PAGES_BRANCH !== PAGES_RELEASE.branch)
    return requested;
  if (
    ![
      "gamelan-v5-public-candidate",
      "gamelan-v5-canonical-release",
      PAGES_RELEASE.mode,
    ].includes(requested)
  )
    throw Error("unreviewedPagesProductionMode");
  if (!/^[a-f0-9]{40}$/.test(env.CF_PAGES_COMMIT_SHA ?? ""))
    throw Error("missingPagesCommitIdentity");
  return PAGES_RELEASE.mode;
}
