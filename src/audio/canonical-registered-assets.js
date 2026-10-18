import kits from "../../internal/studio-kits/manifest.json" with { type: "json" };
import v3 from "../../internal/v3-sounds/manifest.json" with { type: "json" };
import groove from "../../internal/original-groove/manifest.json" with { type: "json" };
import credits from "../../internal/gamelan-delivery/credits.json" with { type: "json" };
// The delivery alias resolver preserves these original PCM receipts for this
// adapter; legacy Gamelan consumers retain their selected delivery registry.
import r44 from "../../internal/instrument-focus/registry-44100.json" with { type: "json" };
import r48 from "../../internal/instrument-focus/registry-48000.json" with { type: "json" };
import plucked44 from "../../internal/loop-instruments/registry-44100.json" with { type: "json" };
import plucked48 from "../../internal/loop-instruments/registry-48000.json" with { type: "json" };
import pluckedCredits from "../../internal/loop-instruments/manifest.json" with { type: "json" };
import { InstrumentRegistry } from "./instrument-registry.js";
import { canonicalFrozenCopy } from "../project/canonical-data.js";
import { fail } from "../project/instrument-contract.js";

// Trusted repository catalogs only. URL mapping is injected by the local/Vite
// consumer; project JSON cannot install URLs, descriptors or license receipts.
export function canonicalRegisteredAssets(
  rate,
  resolveUrl,
  decodeProfiles = {},
) {
  if (![44100, 48000].includes(rate) || typeof resolveUrl !== "function")
    fail("invalidCanonicalProvider");
  const profile = rate === 44100 ? r44 : r48,
    plucked = rate === 44100 ? plucked44 : plucked48,
    registry = new InstrumentRegistry([...profile.banks, ...plucked.banks]),
    nativeRights = [],
    nativeURLs = new Map(),
    catalog = [],
    urls = new Map();
  const source = new Map(credits.rows.map((row) => [row.sampleId, row]));
  for (const bank of profile.banks)
    for (const sample of bank.samples) {
      if (bank.id === "legacy-hat") {
        const asset = groove.assets.find(
          (a) => a.role === "hat" && a.variant === 1,
        );
        if (
          !asset ||
          sample.sha256 !== asset.sha256 ||
          sample.encodedBytes !== asset.bytes ||
          sample.frames !== (asset.frames * rate) / asset.sampleRate ||
          sample.channels !== asset.channels ||
          sample.sourceWorkId !== asset.id ||
          sample.licenseId !== "cc0-1-0"
        )
          fail("canonicalAssetIdentityMismatch");
        nativeRights.push({
          request: {
            kind: "instrument",
            bankId: bank.id,
            version: bank.version,
            sampleId: sample.id,
          },
          rights: {
            licenseId: sample.licenseId,
            sourceWorkId: sample.sourceWorkId,
            commercialUse: asset.commercialUse,
            rawRedistribution: asset.rawRedistribution,
            author: asset.author,
            sourceRecipeSha256: asset.sourceRecipeSha256,
          },
        });
        nativeURLs.set(
          sample.assetPath,
          resolveUrl({
            kind: "instrument",
            path: `internal/original-groove/${asset.assetPath}`,
            assetPath: sample.assetPath,
            sha256: sample.sha256,
          }),
        );
        continue;
      }
      const row = source.get(sample.id),
        delivery = row?.delivered.find((d) => d.rate === rate);
      if (
        !row ||
        row.license !== "CC-BY-3.0" ||
        sample.licenseId !== "cc-by-3-0" ||
        !delivery ||
        delivery.sha256 !== sample.sha256 ||
        delivery.assetPath !== sample.assetPath ||
        delivery.frames !== sample.frames ||
        delivery.channels !== sample.channels ||
        delivery.bytes !== sample.encodedBytes
      )
        fail("canonicalAssetIdentityMismatch");
      nativeRights.push({
        request: {
          kind: "instrument",
          bankId: bank.id,
          version: bank.version,
          sampleId: sample.id,
        },
        rights: {
          licenseId: sample.licenseId,
          sourceWorkId: sample.sourceWorkId,
          commercialUse: true,
          rawRedistribution: true,
          attribution: row.attribution,
          licenseURL: row.licenseURL,
          sourceIdentity: row.sourceIdentity,
        },
      });
      const url = resolveUrl({
        kind: "instrument",
        path: delivery.sourcePath,
        assetPath: sample.assetPath,
        sha256: sample.sha256,
      });
      if (typeof url !== "string" || !url) fail("canonicalAssetUnavailable");
      nativeURLs.set(sample.assetPath, url);
    }
  for (const bank of plucked.banks)
    for (const sample of bank.samples) {
      const row = pluckedCredits.assets.find(
          (r) => r.sampleId === sample.id && r.profileRate === rate,
        ),
        d = row?.derivative;
      if (
        !row ||
        row.license !== "CC0-1.0" ||
        sample.licenseId !== "cc0-1-0" ||
        row.commercialUse !== true ||
        row.rawRedistribution !== true ||
        !d ||
        d.sha256 !== sample.sha256 ||
        d.bytes !== sample.encodedBytes ||
        d.frames !== sample.frames ||
        d.channels !== sample.channels ||
        d.rate !== rate ||
        sample.sampleRate !== rate ||
        sample.assetPath !==
          "/sounds/loop-instruments/" + rate + "/" + sample.id + ".wav" ||
        d.path !== "audio/" + rate + "/" + sample.id + ".wav" ||
        !/^[a-f0-9]{64}$/.test(row.originalSHA256) ||
        !/^[a-f0-9]{64}$/.test(row.licenseEvidenceSHA256)
      )
        fail("canonicalAssetIdentityMismatch");
      nativeRights.push({
        request: {
          kind: "instrument",
          bankId: bank.id,
          version: bank.version,
          sampleId: sample.id,
        },
        rights: {
          licenseId: sample.licenseId,
          sourceWorkId: sample.sourceWorkId,
          commercialUse: true,
          rawRedistribution: true,
          author: row.creator,
          sourceURL: row.sourcePage,
          licenseURL: row.licenseURL,
          publisherVersion: row.publisherVersion,
          originalPath: row.originalPath,
          originalSHA256: row.originalSHA256,
          licenseEvidencePath: row.licenseEvidencePath,
          licenseEvidenceSHA256: row.licenseEvidenceSHA256,
          transformations: row.transformations,
        },
      });
      const url = resolveUrl({
        kind: "instrument",
        path: "internal/loop-instruments/" + d.path,
        assetPath: sample.assetPath,
        sha256: sample.sha256,
      });
      if (typeof url !== "string" || !url) fail("canonicalAssetUnavailable");
      nativeURLs.set(sample.assetPath, url);
    }
  function add(request, asset, family, processing = "none") {
    if (
      asset.commercialUse !== true ||
      asset.rawRedistribution !== true ||
      asset.licenseId !== "CC0-1.0"
    )
      fail("canonicalAssetLicense");
    // Existing legacy durations yield integral frame counts in both supported
    // profiles. A non-integral new asset requires a verified profile, not a guess.
    const frames =
      decodeProfiles[asset.sha256 + "@" + rate] ??
      (asset.frames * rate) / asset.sampleRate;
    if (!Number.isSafeInteger(frames)) fail("unsupportedDecodeProfile");
    const path = `internal/${family}/${asset.assetPath}`,
      url = resolveUrl({ kind: request.kind, path, sha256: asset.sha256 });
    if (typeof url !== "string" || !url) fail("canonicalAssetUnavailable");
    const item = {
      request,
      descriptor: {
        frames,
        channels: asset.channels,
        sampleRate: rate,
        encodedBytes: asset.bytes,
        gainTrim: asset.gainTrim,
        contentHash: asset.sha256,
        hashKind: "encoded-asset",
      },
      rights: {
        licenseId: asset.licenseId,
        sourceWorkId: `perkusi-${family}-${asset.id}`,
        commercialUse: true,
        rawRedistribution: true,
        author: asset.author,
        sourceRecipe: asset.sourceRecipe,
        sourceRecipeSha256: asset.sourceRecipeSha256,
      },
      processing,
    };
    catalog.push(canonicalFrozenCopy(item));
    urls.set(asset.sha256, url);
  }
  for (const [manifest, family] of [
    [kits, "studio-kits"],
    [v3, "v3-sounds"],
  ])
    for (const kit of manifest.kits)
      for (const asset of kit.assets)
        add(
          {
            kind: "percussion",
            pack: { id: kit.id, version: manifest.version },
            role: asset.id,
          },
          asset,
          family,
        );
  for (const asset of v3.instrument.assets)
    add(
      {
        kind: "bilah",
        pack: { id: "bilah", version: "1.0.0" },
        pitch: asset.id,
      },
      asset,
      "v3-sounds",
    );
  for (const asset of groove.assets)
    add(
      {
        kind: "phrase",
        pack: {
          id: groove.packId,
          version: groove.version,
          processing: "bumi-presence-v1",
        },
        role: asset.role,
        variant: asset.variant,
      },
      asset,
      "original-groove",
      "bumi-presence-v1",
    );
  return Object.freeze({
    registry,
    catalog: Object.freeze(catalog),
    nativeRights: canonicalFrozenCopy(nativeRights),
    nativeURL(path) {
      const url = nativeURLs.get(path);
      if (!url) fail("canonicalAssetUnavailable");
      return url;
    },
    legacyURL(hash) {
      const url = urls.get(hash);
      if (!url) fail("canonicalAssetUnavailable");
      return url;
    },
  });
}
