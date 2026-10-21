import { canonicalRegisteredAssets } from "./canonical-registered-assets.js";
import { createCanonicalAssetProvider } from "./canonical-asset-provider.js";
import { createCanonicalLegacyAssets } from "./canonical-legacy-assets.js";
import { fail } from "../project/instrument-contract.js";
import { createCanonicalSourceDispatcher } from "./canonical-source-batch.js";
import { isCanonicalRecordingHandle } from "./canonical-recordings.js";
const active = new WeakSet(),
  pause = () => new Promise((r) => setTimeout(r, 5));

// Explicit opt-in adapter for an owned fresh context. No app initialization,
// context creation/closure, UI publication or storage work happens here.
export function createCanonicalProductionAdapter({
  context,
  memory,
  resolveUrl,
  fetcher = (...a) => fetch(...a),
  recordings = [],
  decodeProfiles = {},
} = {}) {
  if (active.has(context)) fail("canonicalAdapterExists");
  const assets = canonicalRegisteredAssets(
      context.sampleRate,
      resolveUrl,
      decodeProfiles,
    ),
    dispatcher = createCanonicalSourceDispatcher(memory, context),
    legacy = createCanonicalLegacyAssets({
      context,
      memory,
      urlFor: assets.legacyURL,
      fetcher,
      beginReservation: dispatcher.legacyBegin,
    });
  const recordingMap = new Map(),
    recordingCatalog = [];
  for (const handle of recordings) {
    if (
      typeof handle.acquire !== "function" ||
      handle.asset.sampleRate !== context.sampleRate ||
      recordingMap.has(handle.asset.sha256)
    )
      fail("invalidCanonicalProvider");
    recordingMap.set(handle.asset.sha256, handle);
    recordingCatalog.push({
      request: { kind: "recording", asset: handle.asset },
      descriptor: {
        frames: handle.asset.frames,
        channels: handle.asset.channels,
        sampleRate: handle.asset.sampleRate,
        encodedBytes: 0,
        gainTrim: 1,
        contentHash: handle.asset.sha256,
        hashKind: "decoded-pcm",
      },
      rights: handle.rights,
      processing: "none",
    });
  }
  const provider = createCanonicalAssetProvider({
    context,
    memory,
    registry: assets.registry,
    nativeRights: assets.nativeRights,
    catalog: [...assets.catalog, ...recordingCatalog],
    legacyAcquire: (entry, options) =>
      entry.request.kind === "recording"
        ? recordingMap.get(entry.request.asset.sha256).acquire({
            ...options,
            beginReservation: (bytes) =>
              dispatcher.recordingBegin(entry, bytes),
          })
        : legacy.acquire(entry, options),
    recordingHandles: recordings,
    cacheOptions: {
      fetcher: (path, options) => fetcher(assets.nativeURL(path), options),
    },
    nativeMemoryPolicy: dispatcher.nativePolicy,
  });
  const ownsRecording = (request) =>
    request.kind === "recording" &&
    isCanonicalRecordingHandle(recordingMap.get(request.asset.sha256), memory);
  dispatcher.bind(
    provider,
    (request, d) =>
      ownsRecording(request) ? 8192 : d.frames * d.channels * 16 + 8192,
    ownsRecording,
  );
  active.add(context);
  let closing = null,
    disposed = false;
  return Object.freeze({
    provider,
    registry: assets.registry,
    assets,
    retireNativeCachePolicy() {
      if (!disposed) fail("canonicalSourceStillOwned");
      return dispatcher.retireNativePolicy();
    },
    acquireLegacyEntry(stem, { bank, signal } = {}) {
      // Original loop packs intentionally expose assetId/variant, whereas the
      // one-shot packs include sha256. Resolve either through trusted catalogs;
      // a project/stem cannot install a URL or silently fall back on a bad hash.
      const entry =
        typeof stem.sha256 === "string"
          ? assets.catalog.find((e) => e.descriptor.contentHash === stem.sha256)
          : bank?.pack.id === "original-groove" &&
              bank.pack.version === "0.1.0-candidate"
            ? assets.catalog.find(
                (e) =>
                  e.request.kind === "phrase" &&
                  e.request.role === stem.id &&
                  e.request.variant === stem.variant &&
                  e.rights.sourceWorkId ===
                    "perkusi-original-groove-" + stem.assetId,
              )
            : null;
      if (!entry || entry.descriptor.gainTrim !== stem.gainTrim)
        fail("canonicalAssetIdentityMismatch");
      return provider.load(entry.request, { signal });
    },
    snapshot() {
      return Object.freeze({
        provider: provider.snapshot(),
        legacy: legacy.snapshot(),
        sourceBatch: dispatcher.snapshot(),
        uiReady: false,
      });
    },
    dispose() {
      if (!closing)
        closing = (async () => {
          dispatcher.close();
          await provider.dispose();
          await legacy.dispose();
          while (provider.snapshot().cache?.activeJobs > 0) await pause();
          active.delete(context);
          disposed = true;
        })();
      closing.catch(() => {
        closing = null;
      });
      return closing;
    },
  });
}
