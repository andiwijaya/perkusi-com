import { reserveCanonicalVoiceOwners } from "./canonical-voice-budget.js";
import { fail, integer } from "../project/instrument-contract.js";

// Independent capability/ledger core. It is NOT attached to an existing engine
// or preview. Future hooks must offer pending ownership BEFORE native creation.
export function createCanonicalLegacyBridge({ memory, context } = {}) {
  if (
    typeof memory?.reserve !== "function" ||
    !context ||
    ![44100, 48000].includes(context.sampleRate) ||
    typeof context.close !== "function"
  )
    fail("invalidCanonicalOwner");
  const rows = new Set(),
    allocations = new Set();
  let closing = false,
    closed = false,
    closingPromise = null;
  function allowed() {
    if (closing || closed || context.state === "closed")
      fail("canonicalBridgeClosed");
  }
  return Object.freeze({
    reserveMemory(bytes, label, { until = "release" } = {}) {
      allowed();
      if (
        !integer(bytes, 1, 67108864) ||
        typeof label !== "string" ||
        !label ||
        !["release", "context-close"].includes(until)
      )
        fail("invalidCanonicalOwner");
      const lease = memory.reserve(bytes, "legacy/" + label),
        row = { lease, until };
      try {
        allowed();
      } catch (error) {
        lease.release();
        throw error;
      }
      allocations.add(row);
      let released = false;
      return Object.freeze({
        release() {
          if (released) return;
          released = true;
          allocations.delete(row);
          lease.release();
        },
      });
    },
    pending({ peak, label = "voice" } = {}) {
      allowed();
      const ticket = reserveCanonicalVoiceOwners(memory, {
          count: 1,
          peak,
          label: "legacy/" + label,
        }),
        row = {
          ticket,
          state: "pending",
          voice: null,
          ended: false,
          disconnected: false,
        };
      try {
        allowed();
      } catch (error) {
        ticket.release();
        throw error;
      }
      rows.add(row);
      function release() {
        if (row.state === "released") return;
        row.state = "released";
        row.voice = null;
        rows.delete(row);
        ticket.release();
      }
      return Object.freeze({
        id: ticket.id,
        started(voice) {
          allowed();
          if (
            row.state !== "pending" ||
            !voice ||
            voice.context !== context ||
            typeof voice.addEventListener !== "function"
          )
            fail("invalidCanonicalOwner");
          row.voice = voice;
          row.state = "active";
          voice.addEventListener(
            "ended",
            () => {
              if (row.state === "released") return;
              row.ended = true;
              if (row.disconnected) release();
              else row.state = "ended-awaiting-disconnect";
            },
            { once: true },
          );
        },
        failedBeforeStart() {
          if (row.state === "released") return;
          if (row.state !== "pending") fail("canonicalVoiceStillOwned");
          release();
        },
        releasing() {
          if (row.state !== "active" && row.state !== "releasing")
            fail("invalidCanonicalOwner");
          row.state = "releasing";
        },
        disconnected() {
          if (row.state === "released") return;
          if (row.state === "pending") fail("invalidCanonicalOwner");
          row.disconnected = true;
          if (row.ended) release();
        },
        get state() {
          return row.state;
        },
      });
    },
    snapshot() {
      return Object.freeze({
        closing,
        closed,
        voices: Object.freeze(
          [...rows].map((r) =>
            Object.freeze({ id: r.ticket.id, state: r.state }),
          ),
        ),
        allocations: allocations.size,
      });
    },
    close() {
      if (closingPromise) return closingPromise;
      closing = true;
      // An actual close acknowledgement owns final release, even after a stop,
      // elapsed endTime, failed close or a legacy collection deleting its row.
      closingPromise = (async () => {
        if (context.state !== "closed") await context.close();
        if (context.state !== "closed") fail("canonicalContextStillOwned");
        closed = true;
        for (const row of rows) {
          row.state = "released";
          row.voice = null;
          row.ticket.release();
        }
        rows.clear();
        for (const row of allocations)
          if (row.until === "context-close") {
            row.lease.release();
            allocations.delete(row);
          }
      })();
      closingPromise.catch(() => {
        closingPromise = null;
      });
      return closingPromise;
    },
  });
}
