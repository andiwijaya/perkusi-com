export const DEVICE_PROFILE_KEY = "perkusi.loop-station.device-profiles.v1";
export const MAX_DEVICE_PROFILES = 8;
const failure = (code) => {
  throw Object.assign(new Error(code), { code });
};
const keys = (value, names) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === names;
function validProfile(p) {
  return (
    keys(p, "advanceMs,id,label,sampleRate,verification") &&
    /^profile-[1-8]$/.test(p.id) &&
    typeof p.label === "string" &&
    p.label === p.label.trim() &&
    p.label.length > 0 &&
    p.label.length <= 48 &&
    ![...p.label].some(
      (c) => c.codePointAt(0) < 32 || c.codePointAt(0) === 127,
    ) &&
    [44100, 48000].includes(p.sampleRate) &&
    Number.isFinite(p.advanceMs) &&
    Math.abs(p.advanceMs) <= 250 &&
    p.verification === "manual-unverified"
  );
}
function decode(raw) {
  if (raw === null)
    return {
      format: "perkusi-local-offset-profiles",
      version: 1,
      profiles: [],
    };
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 8192)
    failure("profileStoreInvalid");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    failure("profileStoreInvalid");
  }
  if (
    !keys(value, "format,profiles,version") ||
    value.format !== "perkusi-local-offset-profiles" ||
    value.version !== 1 ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > MAX_DEVICE_PROFILES ||
    !value.profiles.every(validProfile) ||
    new Set(value.profiles.map((p) => p.id)).size !== value.profiles.length
  )
    failure("profileStoreInvalid");
  return value;
}
function selectedProfile(profile, expected) {
  if (
    expected !== undefined &&
    (!validProfile(expected) ||
      Object.keys(profile).some((key) => profile[key] !== expected[key]))
  )
    failure("profileSelectionStale");
}

// User-named manual preferences only. No device enumeration, IDs, labels,
// fingerprint, calibration measurement or project/export schema is consulted.
export class DeviceProfileStore {
  constructor(storage = () => globalThis.localStorage) {
    this.storage = storage;
  }
  access(fn) {
    try {
      return fn(this.storage());
    } catch (e) {
      if (e.code?.startsWith("profile")) throw e;
      failure("profileStorageUnavailable");
    }
  }
  read() {
    return this.access((s) => decode(s.getItem(DEVICE_PROFILE_KEY)).profiles);
  }
  change(fn) {
    return this.access((s) => {
      const old = s.getItem(DEVICE_PROFILE_KEY),
        value = decode(old),
        result = fn(value.profiles),
        next = JSON.stringify(value);
      decode(next);
      if (s.getItem(DEVICE_PROFILE_KEY) !== old)
        failure("profileStorageConflict");
      s.setItem(DEVICE_PROFILE_KEY, next);
      if (s.getItem(DEVICE_PROFILE_KEY) !== next)
        failure("profileStorageConflict");
      return result;
    });
  }
  save({ label, advanceMs, sampleRate }) {
    return this.change((profiles) => {
      if (profiles.length >= MAX_DEVICE_PROFILES) failure("profileLimit");
      let n = 1;
      while (profiles.some((p) => p.id === "profile-" + n)) n++;
      const profile = {
        id: "profile-" + n,
        label: typeof label === "string" ? label.trim() : label,
        advanceMs,
        sampleRate,
        verification: "manual-unverified",
      };
      if (!validProfile(profile)) failure("profileValueInvalid");
      profiles.push(profile);
      return structuredClone(profile);
    });
  }
  load(id, sampleRate, expected) {
    const profile = this.read().find((p) => p.id === id);
    if (!profile) failure("profileMissing");
    selectedProfile(profile, expected);
    if (profile.sampleRate !== sampleRate) failure("profileRateMismatch");
    return profile;
  }
  remove(id, expected) {
    this.change((profiles) => {
      const index = profiles.findIndex((p) => p.id === id);
      if (index < 0) failure("profileMissing");
      selectedProfile(profiles[index], expected);
      profiles.splice(index, 1);
    });
  }
  clear() {
    this.access((s) => {
      s.removeItem(DEVICE_PROFILE_KEY);
      if (s.getItem(DEVICE_PROFILE_KEY) !== null)
        failure("profileStorageConflict");
    });
  }
}
