import { retainCanonicalBundle } from "../project/canonical-package.js";
import { hashBytes } from "../project/canonical-data.js";
import { fail } from "../project/instrument-contract.js";
const check = (s) => {
  if (s?.aborted) fail("cancelled");
};

// Imported recordings are local project data, not newly distributed sample
// assets. Preserve their exact credits; do not infer a commercial license from
// arbitrary provenance text. Shipped assets keep their distinct license gate.
export function createCanonicalRecordingHandles(bundle, { memory } = {}) {
  const own = retainCanonicalBundle(bundle),
    jobs = new Set(),
    loans = new Set(),
    byHash = new Map();
  let closed = false,
    released = false;
  for (const a of own.project.assets) {
    const prior = byHash.get(a.sha256);
    if (prior) {
      if (
        ["frames", "channels", "sampleRate", "bytes"].some(
          (k) => prior.asset[k] !== a[k],
        )
      ) {
        own.dispose();
        fail("canonicalAssetIdentityMismatch");
      }
      prior.refs.push(a.creditsRef);
      continue;
    }
    byHash.set(a.sha256, {
      asset: a,
      refs: [a.creditsRef],
      entry: own.entries.get(a.id),
    });
  }
  const recordings = Object.freeze(
    [...byHash.values()].map(({ asset, refs, entry }) =>
      Object.freeze({
        asset,
        rights: Object.freeze({
          licenseId: "user-data-unverified",
          sourceWorkId: "recording-" + asset.sha256,
          scope: "local-project-data",
          commercialUse: null,
          rawRedistribution: null,
          creditsRefs: Object.freeze(refs),
        }),
        acquire({ context, signal } = {}) {
          if (closed) fail("canonicalProviderClosed");
          check(signal);
          if (context.sampleRate !== asset.sampleRate) fail("takeRateMismatch");
          const job = Promise.resolve().then(async () => {
            let held,
              published = false;
            try {
              if (closed) fail("cancelled");
              check(signal);
              const bytes = asset.bytes * 3 + 8192;
              if (bytes > 67108864) fail("combinedMemoryLimit");
              held = memory.reserve(
                bytes,
                "canonical/recording-read-native-views",
              );
              if (closed) fail("cancelled");
              check(signal);
              const raw = await entry.blob.arrayBuffer();
              check(signal);
              if (closed) fail("cancelled");
              if (
                raw.byteLength !== asset.bytes ||
                (await hashBytes(raw)) !== asset.sha256
              )
                fail("recordingHashMismatch");
              check(signal);
              if (closed) fail("cancelled");
              let buffer = context.createBuffer(
                asset.channels,
                asset.frames,
                asset.sampleRate,
              );
              const view = new DataView(raw);
              for (let c = 0; c < asset.channels; c++) {
                const plane = buffer.getChannelData(c);
                for (let i = 0; i < asset.frames; i++)
                  plane[i] = view.getFloat32(
                    (i * asset.channels + c) * 4,
                    true,
                  );
              }
              held.resize(asset.bytes * 2 + 8192);
              const row = { held };
              loans.add(row);
              let done = false;
              published = true;
              return Object.freeze({
                get buffer() {
                  if (done) fail("canonicalLoanReleased");
                  return buffer;
                },
                sourceHash: asset.sha256,
                release() {
                  if (done) return;
                  done = true;
                  buffer = null;
                  loans.delete(row);
                  held.release();
                },
              });
            } finally {
              if (!published) held?.release();
            }
          });
          jobs.add(job);
          job.then(
            () => jobs.delete(job),
            () => jobs.delete(job),
          );
          return job;
        },
      }),
    ),
  );
  return Object.freeze({
    recordings,
    snapshot: () => ({ closed, jobs: jobs.size, loans: loans.size, released }),
    async dispose() {
      closed = true;
      await Promise.allSettled([...jobs]);
      if (loans.size) fail("canonicalRecordingStillOwned");
      if (!released) {
        released = true;
        own.dispose();
      }
    },
  });
}
