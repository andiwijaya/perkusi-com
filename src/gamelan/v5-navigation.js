// The active tab owns its audio and draft. Do not leave until both settle.
export async function instrumentHandoffText(session) {
  if (session.snapshot?.().replaying) session.pause();
  await session.prepareStudio();
  return session.toJSON();
}
export async function leaveInstrumentWorkspace(
  { session, flushDraft, blocked, releaseOutputs, navigate },
  href,
) {
  if (blocked()) throw Object.assign(Error("busy"), { code: "recordBusy" });
  // Playback may leave through home; capture/export still require explicit finish.
  if (session.snapshot?.().replaying) session.pause();
  await session.prepareStudio();
  if (!flushDraft())
    throw Object.assign(Error("draft conflict"), { code: "routeConflict" });
  try {
    await session.dispose();
  } catch {
    throw Object.assign(Error("cleanup"), { code: "routeCleanup" });
  }
  releaseOutputs();
  navigate(href);
}
