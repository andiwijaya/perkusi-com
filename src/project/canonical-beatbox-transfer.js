import { incomingTransfer } from "./mode-transfer.js";
import { hashBytes } from "./canonical-data.js";

// Adapt the existing bounded V3 transfer, keeping its original/backups and ACK.
// A stable inbox identity makes refresh/retry metadata-only after acceptance.
export async function stageBeatboxTransfer({
  store,
  memory,
  storage = globalThis.localStorage,
  session = globalThis.sessionStorage,
} = {}) {
  const incoming = incomingTransfer("studio", storage, session);
  if (!incoming) return null;
  if (!incoming.pending) {
    incoming.acknowledge();
    return null;
  }
  const text = JSON.stringify(incoming.project),
    held = memory.reserve(
      text.length * 6 + 8192,
      "canonical/beatbox-transfer-adapter",
    );
  try {
    const hash = await hashBytes(
        new TextEncoder().encode("beatbox-to-canonical:" + incoming.id),
      ),
      id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    incoming.check();
    const info = await store.stage(
      new Blob([text], { type: "application/json" }),
      { kind: "legacy", title: incoming.project.title, id },
    );
    incoming.check();
    return { id: info.id, acknowledge: () => incoming.acknowledge() };
  } finally {
    held.release();
  }
}
