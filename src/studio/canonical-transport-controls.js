// One capability rule for the panel and workspace-wide busy locks.
export function canonicalTransportControls(
  s,
  { locked = false, disposed = false } = {},
) {
  const unavailable =
    locked ||
    disposed ||
    s.closed ||
    ["preparing", "cleanup-pending"].includes(s.status);
  return {
    repeatChecked: s.repeatEnabled,
    repeatDisabled:
      unavailable ||
      s.finishing ||
      (!s.repeatEnabled &&
        ["playing", "paused", "prepared"].includes(s.status)),
    seekDisabled:
      unavailable || !s.capability || !["playing", "paused"].includes(s.status),
  };
}
