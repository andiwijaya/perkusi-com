import { exportFailureCategory, trackEvent } from "../analytics.js";

// Repeated workflow/animation notifications must not duplicate durable events.
// Identity tokens stay in this closure; only the existing narrow events leave it.
export function createCanonicalEventReporter(send = trackEvent) {
  let opened = false,
    saved = null,
    played = null;
  const event = (...args) => {
    try {
      send(...args);
    } catch {
      /* observational */
    }
  };
  return Object.freeze({
    open() {
      if (!opened) {
        opened = true;
        event("studio_open");
      }
    },
    workflow(s) {
      if (s.status !== "saved" || s.savedRevision == null) return;
      const key = s.documentId + "/" + s.savedRevision;
      if (key !== saved) {
        saved = key;
        event("project_saved");
      }
    },
    position(p, state, s) {
      if (state !== "playing" || !(p?.frame > 0) || s.generation === played)
        return;
      played = s.generation;
      event("audio_started");
    },
    exported(error = null) {
      if (!error) event("export_succeeded");
      else if (error.code !== "cancelled")
        event("export_failed", exportFailureCategory(error.code));
    },
  });
}
