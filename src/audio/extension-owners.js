import { fail, frozenCopy } from "../project/instrument-contract.js";

const channels = ["instrument", "capture", "monitor", "export"];
// Stable release-function identity denotes one offered physical resource.
// Weak leases also deduplicate accidental delivery across adapter instances.
const leases = new WeakMap();
export class ExtensionOwners {
  #owners = new Map(
    channels.map((c) => [c, { token: null, resources: new Set() }]),
  );
  #tokens = new WeakMap();
  #generation = 0;
  #disposed = false;
  #cleanup = 0;
  #playback;
  #onError;
  constructor({ playbackRequested = () => false, onError = () => {} } = {}) {
    if (
      typeof playbackRequested !== "function" ||
      typeof onError !== "function"
    )
      fail("invalidOwnerAdapter");
    this.#playback = playbackRequested;
    this.#onError = onError;
  }
  #error(error) {
    try {
      this.#onError(error);
    } catch {
      /* Cleanup must continue. */
    }
  }
  #release(resource, expectedToken = null) {
    const lease = leases.get(resource);
    if (lease?.state === "released") return;
    // Refused offers may release only an unclaimed resource. Cleanup may
    // release only the exact lease captured by this owner before invalidation.
    if (expectedToken === null) {
      if (lease?.state === "owned") return;
    } else if (
      lease?.state !== "owned" ||
      lease.adapter !== this ||
      lease.token !== expectedToken
    )
      return;
    leases.set(resource, { state: "released" });
    this.#cleanup++;
    try {
      resource();
    } catch (error) {
      this.#error(error);
    } finally {
      this.#cleanup--;
    }
  }
  #invalidate(names) {
    const resources = [];
    // All affected tokens are invalidated before the first external callback.
    for (const name of names) {
      const owner = this.#owners.get(name);
      for (const resource of owner.resources)
        resources.push([resource, owner.token]);
      owner.token = null;
      owner.resources.clear();
    }
    this.#cleanup++;
    try {
      resources.forEach(([r, token]) => this.#release(r, token));
    } finally {
      this.#cleanup--;
    }
  }
  #current(token) {
    const info = token && this.#tokens.get(token);
    return (
      info &&
      !this.#disposed &&
      !this.#cleanup &&
      this.#owners.get(info.channel).token === token
    );
  }
  begin(channel, { monitorEnabled = false } = {}) {
    if (this.#disposed) fail("ownerDisposed");
    if (this.#cleanup) fail("ownerCleanup");
    if (
      !channels.includes(channel) ||
      typeof monitorEnabled !== "boolean" ||
      (channel === "monitor" && !monitorEnabled)
    )
      fail("invalidOwnerChannel");
    this.#invalidate([channel]);
    if (this.#disposed) fail("ownerDisposed");
    if (this.#generation >= Number.MAX_SAFE_INTEGER)
      fail("ownerGenerationLimit");
    const token = Object.freeze({ channel, generation: ++this.#generation });
    this.#tokens.set(token, { channel });
    this.#owners.get(channel).token = token;
    return token;
  }
  adopt(token, release) {
    if (typeof release !== "function") fail("invalidOwnedResource");
    const lease = leases.get(release);
    if (lease?.state === "released") return false;
    if (
      lease?.state === "owned" &&
      (lease.adapter !== this || lease.token !== token)
    )
      return false;
    let allowed = !!this.#current(token);
    const info = token && this.#tokens.get(token);
    if (allowed && info.channel === "instrument") {
      try {
        allowed = this.#playback() === true;
      } catch (error) {
        this.#error(error);
        allowed = false;
      }
      allowed = allowed && !!this.#current(token); // Guard callback may itself Pause/dispose.
    }
    if (!allowed) {
      if (
        info?.channel === "instrument" &&
        this.#owners.get("instrument").token === token
      )
        this.#invalidate(["instrument"]);
      this.#release(release);
      return false;
    }
    // The guard, onError, and invalidation callbacks may change global leases.
    // There are no external calls between this fresh read and the commit.
    const currentLease = leases.get(release);
    if (currentLease?.state === "released") return false;
    if (currentLease?.state === "owned")
      return (
        currentLease.adapter === this &&
        currentLease.token === token &&
        !!this.#current(token)
      );
    leases.set(release, { state: "owned", adapter: this, token });
    this.#owners.get(info.channel).resources.add(release);
    return true;
  }
  cancel(channel) {
    if (!channels.includes(channel)) fail("invalidOwnerChannel");
    this.#invalidate([channel]);
  }
  stop() {
    this.#invalidate(["instrument", "capture", "monitor"]);
  }
  dispose() {
    this.#disposed = true;
    this.#invalidate(channels);
  }
  snapshot() {
    return frozenCopy({
      disposed: this.#disposed,
      active: [...this.#owners.values()].filter((o) => o.resources.size > 0)
        .length,
      channels: Object.fromEntries(
        [...this.#owners].map(([name, o]) => [
          name,
          {
            generation: o.token?.generation ?? null,
            resources: o.resources.size,
          },
        ]),
      ),
    });
  }
}
