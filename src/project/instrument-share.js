import { fail } from "./instrument-contract.js";

// The OS share call owns borrowed bytes until its actual promise settles.
// Conservatively admit a File copy before constructing it; download reuses the
// output's one URL and is always available when file sharing is unsupported.
export async function shareInstrumentOutput(
  output,
  {
    memory,
    download,
    navigator = globalThis.navigator,
    File = globalThis.File,
    name = "perkusi-gamelan.wav",
  } = {},
) {
  if (!output || typeof download !== "function") fail("exportReleased");
  const held = output.retain();
  let allocation = null,
    file;
  try {
    if (
      typeof navigator?.share !== "function" ||
      typeof navigator?.canShare !== "function" ||
      typeof File !== "function"
    ) {
      download(output, name);
      return "download";
    }
    allocation = memory.reserve(
      Math.max(1, held.blob.size),
      "pending Web Share File copy",
    );
    file = new File([held.blob], name, { type: "audio/wav" });
    if (!navigator.canShare({ files: [file] })) {
      file = null;
      allocation.release();
      allocation = null;
      download(output, name);
      return "download";
    }
    try {
      await navigator.share({ files: [file], title: "Perkusi.com" });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      if (!output.active) return "cancelled";
      // Share failure must leave a working local download path and original WAV.
      download(output, name);
      return "download";
    }
  } finally {
    // eslint-disable-next-line no-useless-assignment -- Drop the File reference before releasing its byte admission.
    file = null;
    allocation?.release();
    held.release();
  }
}
