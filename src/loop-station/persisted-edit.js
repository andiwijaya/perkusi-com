import { LoopHistory } from "./model.js";

// Durable save acknowledgement precedes history publication. A live mixer is
// an audible preview while storage is pending and must roll back on refusal.
export async function commitLoopEdit({
  history,
  candidate,
  save,
  preview = null,
  onRollbackFailure,
  allowUnsaved = () => false,
  onUnsaved = () => {},
}) {
  const previous = history.project,
    next = new LoopHistory(candidate, history.registry).project;
  let previewed = false;
  if (preview) {
    preview(next);
    previewed = true;
  }
  try {
    await save(next);
  } catch (error) {
    if (allowUnsaved(error, next)) onUnsaved(error);
    else {
      if (previewed) {
        try {
          preview(previous);
        } catch (rollbackError) {
          await onRollbackFailure(rollbackError);
        }
      }
      throw error;
    }
  }
  return history.commit(() => next);
}
