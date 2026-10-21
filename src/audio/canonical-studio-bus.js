import {
  createProgrammeOutputStage,
  PROGRAMME_OUTPUT_BYTES,
} from "./programme-output.js";
import { fail } from "../project/instrument-contract.js";
import { BYPASS_LIMITER, validateLimiter } from "../loop-station/fx-model.js";

// One fixed calibration and one existing safety curve AFTER the sum of every
// song/pad job. Per-source admission still happens in the native session.
export function createCanonicalStudioBus(
  context,
  memory,
  destination,
  { limiter = BYPASS_LIMITER, createMaster = null, onFault = () => {} } = {},
) {
  validateLimiter(limiter);
  const policy = Object.freeze({ ...limiter });
  const held = memory.reserve(
    PROGRAMME_OUTPUT_BYTES + 4096,
    "canonical/shared-studio-output",
  );
  let input,
    stage,
    masterGraph,
    closed = false,
    active = 0;
  try {
    input = context.createGain();
    input.gain.value = 1;
    if (!policy.bypass) {
      if (typeof createMaster !== "function")
        fail("canonicalMasterUnavailable");
      masterGraph = createMaster(memory, onFault);
      input.connect(masterGraph.input);
    }
    stage = createProgrammeOutputStage(context, masterGraph?.output ?? input);
    stage.output.connect(destination);
  } catch (error) {
    stage?.dispose();
    masterGraph?.dispose();
    input?.disconnect();
    held.release();
    throw error;
  }
  return Object.freeze({
    input,
    configure(gain, limiter = policy) {
      if (closed) fail("canonicalOutputClosed");
      validateLimiter(limiter);
      if (
        limiter.bypass !== policy.bypass ||
        limiter.kind !== policy.kind ||
        limiter.version !== policy.version
      )
        fail("canonicalOutputPolicyMismatch");
      if (active && gain !== stage.programmeGain) fail("canonicalOutputBusy");
      if (gain !== stage.programmeGain) stage.setProgrammeGain(gain);
    },
    acquire() {
      if (closed) fail("canonicalOutputClosed");
      const lease = memory.reserve(256, "canonical/shared-output-job");
      active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          active--;
          lease.release();
        }
      };
    },
    snapshot() {
      return Object.freeze({
        activeJobs: active,
        gain: stage.programmeGain,
        outputStages: 1,
        closed,
        masterLimiter: !policy.bypass,
      });
    },
    dispose() {
      if (closed) return;
      if (active) fail("canonicalOutputStillOwned");
      stage.dispose();
      masterGraph?.dispose();
      input.disconnect();
      held.release();
      closed = true;
    },
  });
}
