import { fail } from "../project/instrument-contract.js";

// Only undo the transport start owned by this rejected arm attempt. Never
// cross a newer command or stop a capture/playback accepted by another owner.
export async function armSelectedRecording(
  { recorder, owner, start, current },
  options,
) {
  const engine = owner.engine,
    controller = owner.controller,
    started = !engine.transport.running,
    receipt = started ? await start() : null,
    ours = () =>
      owner.engine === engine &&
      owner.controller === controller &&
      current(receipt);
  if (started && (!receipt || !ours())) fail("cancelled");
  try {
    return recorder.arm(options);
  } catch (error) {
    if (started && ours() && !owner.claims.size && !owner.playbacks.size) {
      controller.stop();
      await controller.waitVoices();
    }
    throw error;
  }
}
