import test from "node:test";
import assert from "node:assert/strict";
import {
  DeviceProfileStore,
  DEVICE_PROFILE_KEY,
} from "../src/loop-station/device-profiles.js";
import { deviceProfileCopy } from "../src/loop-station/device-profile-copy.js";
import { alignRecordedClip } from "../src/loop-station/phase-alignment.js";
import { PPQ } from "../src/project/instrument-project.js";

function fixture() {
  const data = new Map([["unrelated-project", "original"]]),
    storage = {
      writes: 0,
      getItem: (key) => data.get(key) ?? null,
      setItem(key, value) {
        this.writes++;
        data.set(key, value);
      },
      removeItem: (key) => data.delete(key),
    },
    store = new DeviceProfileStore(() => storage);
  return { data, storage, store };
}
const simulated = {
  label: "Simulated wired setup",
  advanceMs: 6,
  sampleRate: 48000,
};

test("absent profiles are backward compatible and opt-in; constructor/read never writes", () => {
  const f = fixture();
  assert.equal(f.storage.writes, 0);
  assert.deepEqual(f.store.read(), []);
  assert.equal(f.storage.writes, 0);
  assert.equal(f.data.has(DEVICE_PROFILE_KEY), false);
  const saved = f.store.save(simulated);
  assert.equal(saved.verification, "manual-unverified");
  assert.equal(saved.id, "profile-1");
  assert.deepEqual(new DeviceProfileStore(() => f.storage).read(), [saved]);
  assert.deepEqual(Object.keys(saved).sort(), [
    "advanceMs",
    "id",
    "label",
    "sampleRate",
    "verification",
  ]);
  assert.equal(f.data.get("unrelated-project"), "original");
});

test("load is explicit, preserves signed manual values and refuses a different recording sample rate", () => {
  const f = fixture(),
    p = f.store.save({ ...simulated, advanceMs: -12.5 });
  assert.throws(() => f.store.load("", 48000), { code: "profileMissing" });
  assert.throws(() => f.store.load(p.id, 44100), {
    code: "profileRateMismatch",
  });
  const loaded = f.store.load(p.id, 48000);
  assert.equal(loaded.advanceMs, -12.5);
  loaded.advanceMs = 200;
  assert.equal(f.store.load(p.id, 48000).advanceMs, -12.5);
});

test("manual entry validates label, offset and rate without overwriting existing profiles", () => {
  const f = fixture();
  f.store.save(simulated);
  const original = f.data.get(DEVICE_PROFILE_KEY);
  for (const entry of [
    { label: "" },
    { label: "x".repeat(49) },
    { label: "bad\nname" },
    { advanceMs: NaN },
    { advanceMs: Infinity },
    { advanceMs: 250.001 },
    { advanceMs: -250.001 },
    { advanceMs: "6" },
    { sampleRate: 96000 },
  ]) {
    assert.throws(() => f.store.save({ ...simulated, ...entry }), {
      code: "profileValueInvalid",
    });
    assert.equal(f.data.get(DEVICE_PROFILE_KEY), original);
  }
  assert.equal(f.store.save({ ...simulated, advanceMs: -250 }).advanceMs, -250);
  assert.equal(f.store.save({ ...simulated, advanceMs: 250 }).advanceMs, 250);
});

test("bounded store has at most eight profiles; explicit deletion only affects its own key", () => {
  const f = fixture();
  for (let i = 0; i < 8; i++)
    f.store.save({ ...simulated, label: "setup " + i });
  assert.throws(() => f.store.save(simulated), { code: "profileLimit" });
  f.store.remove("profile-3");
  assert.equal(f.store.save(simulated).id, "profile-3");
  assert.throws(() => f.store.remove("not-here"), { code: "profileMissing" });
  f.store.clear();
  assert.equal(f.data.has(DEVICE_PROFILE_KEY), false);
  assert.equal(f.data.get("unrelated-project"), "original");
});

test("unsupported/corrupt data and forged calibration or device fields remain preserved until explicit clear", () => {
  const f = fixture();
  f.store.save(simulated);
  const good = JSON.parse(f.data.get(DEVICE_PROFILE_KEY));
  for (const value of [
    "{",
    "x".repeat(8193),
    JSON.stringify({ ...good, version: 2 }),
    JSON.stringify({
      ...good,
      profiles: [{ ...good.profiles[0], deviceId: "forbidden" }],
    }),
    JSON.stringify({
      ...good,
      profiles: [{ ...good.profiles[0], verification: "hardware-calibrated" }],
    }),
    JSON.stringify({ ...good, profiles: [good.profiles[0], good.profiles[0]] }),
  ]) {
    f.data.set(DEVICE_PROFILE_KEY, value);
    assert.throws(() => f.store.read(), { code: "profileStoreInvalid" });
    assert.throws(() => f.store.save(simulated), {
      code: "profileStoreInvalid",
    });
    assert.equal(f.data.get(DEVICE_PROFILE_KEY), value);
  }
  f.store.clear();
  assert.deepEqual(f.store.read(), []);
});

test("storage denial/quota never reports a successful save or silently resets original data", () => {
  const f = fixture();
  f.store.save(simulated);
  const original = f.data.get(DEVICE_PROFILE_KEY);
  f.storage.setItem = () => {
    throw Error("quota");
  };
  assert.throws(() => f.store.save(simulated), {
    code: "profileStorageUnavailable",
  });
  assert.equal(f.data.get(DEVICE_PROFILE_KEY), original);
  const denied = new DeviceProfileStore(() => {
    throw Error("denied");
  });
  assert.throws(() => denied.read(), { code: "profileStorageUnavailable" });
  assert.throws(() => denied.clear(), { code: "profileStorageUnavailable" });
});

test("an observed conflicting write is surfaced rather than acknowledged as saved", () => {
  const f = fixture();
  f.storage.setItem = (key) => f.data.set(key, "other-tab");
  assert.throws(() => f.store.save(simulated), {
    code: "profileStorageConflict",
  });
  assert.equal(f.data.get(DEVICE_PROFILE_KEY), "other-tab");
});

test("profile UI key/error parity and uncalibrated state are explicit in ID/EN", () => {
  assert.deepEqual(
    Object.keys(deviceProfileCopy.id).sort(),
    Object.keys(deviceProfileCopy.en).sort(),
  );
  assert.deepEqual(
    Object.keys(deviceProfileCopy.id.errors).sort(),
    Object.keys(deviceProfileCopy.en.errors).sort(),
  );
  assert.match(deviceProfileCopy.id.hint, /BELUM DIKALIBRASI/);
  assert.match(deviceProfileCopy.en.hint, /UNCALIBRATED/);
});

test("reused slots cannot load or delete a replacement under a stale displayed profile", () => {
  const f = fixture(),
    old = f.store.save(simulated);
  f.store.remove(old.id);
  const replacement = f.store.save({
    ...simulated,
    label: "Different setup",
    advanceMs: -12.5,
  });
  assert.equal(replacement.id, old.id);
  assert.throws(() => f.store.load(old.id, 48000, old), {
    code: "profileSelectionStale",
  });
  assert.throws(() => f.store.remove(old.id, old), {
    code: "profileSelectionStale",
  });
  assert.deepEqual(f.store.read(), [replacement]);
  assert.equal(
    f.store.load(replacement.id, 48000, replacement).advanceMs,
    -12.5,
  );
});

test("loading a local profile leaves project metadata untouched; explicit alignment uses only the existing portable policy", () => {
  const f = fixture(),
    project = {
      clock: { kind: "fixed-bar", sampleRate: 48000, framesPerBar: 120000 },
      assetRefs: [
        {
          id: "audio",
          kind: "recording",
          sha256: "a".repeat(64),
          sampleRate: 48000,
          frames: 120000,
        },
      ],
      tracks: [
        {
          id: "track",
          clips: [
            {
              id: "clip",
              sourceId: "audio",
              loop: true,
              offsetFrames: 0,
              lengthTicks: 4 * PPQ,
            },
          ],
        },
      ],
    },
    original = JSON.stringify(project),
    saved = f.store.save(simulated),
    loaded = f.store.load(saved.id, 48000);
  assert.equal(JSON.stringify(project), original);
  const applied = alignRecordedClip(
    project,
    "track",
    "clip",
    Math.round(loaded.advanceMs * 48),
  );
  assert.equal(applied.tracks[0].clips[0].phaseAlignment.advanceFrames, 288);
  assert.equal(JSON.stringify(project), original);
  assert.deepEqual(applied.assetRefs, project.assetRefs);
  assert(!JSON.stringify(applied).includes(simulated.label));
  assert(!JSON.stringify(applied).includes("manual-unverified"));
  assert(!JSON.stringify(applied).includes("profile-1"));
});
