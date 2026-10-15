import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionOwners } from "../src/audio/extension-owners.js";
test("S1 owners are inert on construction, monitor opt-in only, and never start transport", () => {
  let playback = false,
    releases = 0;
  const o = new ExtensionOwners({ playbackRequested: () => playback });
  assert.equal(o.snapshot().active, 0);
  assert.throws(() => o.begin("monitor"));
  assert.throws(() => o.begin("unknown"));
  const capture = o.begin("capture");
  assert.equal(
    o.adopt(capture, () => releases++),
    true,
  );
  assert.equal(playback, false);
  const instrument = o.begin("instrument");
  assert.equal(
    o.adopt(instrument, () => releases++),
    false,
  );
  assert.equal(releases, 1);
  playback = true;
  const next = o.begin("instrument");
  assert.equal(
    o.adopt(next, () => releases++),
    true,
  );
  const monitor = o.begin("monitor", { monitorEnabled: true });
  assert.equal(
    o.adopt(monitor, () => releases++),
    true,
  );
  o.stop();
  assert.equal(releases, 4);
  assert.equal(playback, true);
  assert.equal(o.snapshot().active, 0);
});
test("S1 late grants/decode/frame completion cannot revive Pause, stopped or disposed owners", () => {
  let playback = true;
  const counts = new Map(),
    resource = (id) => () => counts.set(id, (counts.get(id) || 0) + 1);
  const o = new ExtensionOwners({ playbackRequested: () => playback });
  const old = o.begin("capture");
  o.stop();
  assert.equal(o.adopt(old, resource("late-grant")), false);
  const first = o.begin("instrument");
  o.begin("instrument");
  assert.equal(o.adopt(first, resource("late-decode")), false);
  const frame = o.begin("capture");
  o.dispose();
  assert.equal(o.adopt(frame, resource("late-frame")), false);
  assert.throws(() => o.begin("capture"));
  assert.deepEqual([...counts.values()], [1, 1, 1]);
  playback = false;
});
test("S1 export is independently cancellable; cleanup failures cannot skip other owners", () => {
  const errors = [],
    released = [];
  const o = new ExtensionOwners({
    playbackRequested: () => true,
    onError: (e) => errors.push(e.message),
  });
  const exp = o.begin("export"),
    capture = o.begin("capture"),
    monitor = o.begin("monitor", { monitorEnabled: true });
  o.adopt(exp, () => released.push("export"));
  o.adopt(capture, () => {
    throw Error("release failed");
  });
  o.adopt(monitor, () => released.push("monitor"));
  o.stop();
  assert.deepEqual(released, ["monitor"]);
  assert.deepEqual(errors, ["release failed"]);
  assert.equal(o.snapshot().active, 1);
  o.cancel("export");
  assert.deepEqual(released, ["monitor", "export"]);
  o.dispose();
  assert.equal(o.snapshot().disposed, true);
});
test("S1 token spoofing/cross-adapter callbacks release once; new explicit Play owner may adopt", () => {
  let play = true,
    n = 0;
  const a = new ExtensionOwners({ playbackRequested: () => play }),
    b = new ExtensionOwners({ playbackRequested: () => play });
  const token = a.begin("instrument");
  assert.equal(
    b.adopt(token, () => n++),
    false,
  );
  assert.equal(
    a.adopt({ ...token }, () => n++),
    false,
  );
  a.stop();
  play = false;
  assert.equal(
    a.adopt(token, () => n++),
    false,
  );
  play = true;
  assert.equal(
    a.adopt(a.begin("instrument"), () => n++),
    true,
  );
  a.dispose();
  assert.equal(n, 4);
  const x = new ExtensionOwners(),
    y = new ExtensionOwners(),
    xt = x.begin("capture"),
    yt = y.begin("capture");
  let physicalStops = 0;
  const physicalRelease = () => physicalStops++;
  assert.equal(x.adopt(xt, physicalRelease), true);
  assert.equal(y.adopt(yt, physicalRelease), false);
  assert.equal(physicalStops, 0);
  x.dispose();
  assert.equal(physicalStops, 1);
  assert.equal(y.adopt(yt, physicalRelease), false);
  y.dispose();
  assert.equal(physicalStops, 1);
});
test("S1 cleanup invalidates all owners first, blocks reentrant revival, and survives onError throwing", () => {
  const seen = [];
  let o;
  let releaseCount = 0;
  o = new ExtensionOwners({
    playbackRequested: () => true,
    onError: () => {
      throw Error("onError failure");
    },
  });
  const a = o.begin("capture"),
    m = o.begin("monitor", { monitorEnabled: true });
  const late = () => releaseCount++;
  o.adopt(a, () => {
    seen.push(o.snapshot());
    assert.throws(() => o.begin("capture"));
    assert.equal(o.adopt(m, late), false);
    throw Error("release failure");
  });
  o.adopt(m, () => releaseCount++);
  o.stop();
  assert.equal(seen[0].active, 0);
  assert.equal(releaseCount, 2);
  assert.equal(o.adopt(m, late), false);
  assert.equal(releaseCount, 2);
  const duplicate = () => releaseCount++,
    token = o.begin("capture");
  assert.equal(o.adopt(token, duplicate), true);
  assert.equal(o.adopt(token, duplicate), true);
  o.dispose();
  assert.equal(releaseCount, 3);
  assert.equal(o.adopt(token, duplicate), false);
  o.dispose();
  assert.equal(releaseCount, 3);
  const terminal = new ExtensionOwners(),
    old = terminal.begin("capture");
  terminal.adopt(old, () => terminal.dispose());
  assert.throws(() => terminal.begin("capture"));
  assert.equal(terminal.snapshot().disposed, true);
  assert.equal(terminal.snapshot().active, 0);
});
test("S1 guard reentrancy cannot adopt a resource after a nested Pause", () => {
  let released = 0,
    o;
  o = new ExtensionOwners({
    playbackRequested: () => {
      o.stop();
      return true;
    },
  });
  assert.equal(
    o.adopt(o.begin("instrument"), () => released++),
    false,
  );
  assert.equal(released, 1);
  assert.equal(o.snapshot().active, 0);
  let play = true,
    count = 0;
  const other = new ExtensionOwners({ playbackRequested: () => play }),
    token = other.begin("instrument"),
    resource = () => count++;
  assert.equal(other.adopt(token, resource), true);
  play = false;
  assert.equal(other.adopt(token, resource), false);
  assert.equal(count, 1);
  play = true;
  assert.equal(
    other.adopt(token, () => count++),
    false,
  );
  assert.equal(count, 2); // New Play needs a new explicit owner.
});
