import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionOwners } from "../src/audio/extension-owners.js";

test("OWNER-01 guard-acquired other lease cannot be stolen or released", () => {
  let releases = 0;
  const resource = () => releases++,
    b = new ExtensionOwners(),
    bt = b.begin("capture");
  const a = new ExtensionOwners({
    playbackRequested: () => {
      assert.equal(b.adopt(bt, resource), true);
      return true;
    },
  });
  assert.equal(a.adopt(a.begin("instrument"), resource), false);
  a.stop();
  assert.equal(releases, 0);
  assert.equal(b.snapshot().active, 1);
  b.stop();
  assert.equal(releases, 1);
});
test("OWNER-01 lease released inside guard remains terminal", () => {
  let releases = 0;
  const resource = () => releases++,
    b = new ExtensionOwners();
  const a = new ExtensionOwners({
    playbackRequested: () => {
      assert.equal(b.adopt({}, resource), false);
      return true;
    },
  });
  assert.equal(a.adopt(a.begin("instrument"), resource), false);
  a.stop();
  b.dispose();
  assert.equal(releases, 1);
});
test("OWNER-01 false guard preserves another owner's new lease", () => {
  let releases = 0;
  const resource = () => releases++,
    b = new ExtensionOwners(),
    bt = b.begin("capture");
  const a = new ExtensionOwners({
    playbackRequested: () => {
      b.adopt(bt, resource);
      return false;
    },
  });
  assert.equal(a.adopt(a.begin("instrument"), resource), false);
  assert.equal(releases, 0);
  a.dispose();
  assert.equal(releases, 0);
  b.stop();
  assert.equal(releases, 1);
});
test("OWNER-01 lease is rechecked after false-guard old-resource cleanup", () => {
  let play = true,
    releases = 0;
  const incoming = () => releases++,
    b = new ExtensionOwners(),
    bt = b.begin("capture");
  const a = new ExtensionOwners({ playbackRequested: () => play }),
    at = a.begin("instrument");
  a.adopt(at, () => b.adopt(bt, incoming));
  play = false;
  assert.equal(a.adopt(at, incoming), false);
  assert.equal(releases, 0);
  a.dispose();
  assert.equal(b.snapshot().active, 1);
  b.stop();
  assert.equal(releases, 1);
});
test("OWNER-01 throwing guard and onError transfers preserve rightful lease", () => {
  for (const viaError of [false, true]) {
    let releases = 0;
    const resource = () => releases++,
      b = new ExtensionOwners(),
      bt = b.begin("export");
    const a = new ExtensionOwners({
      playbackRequested: () => {
        if (!viaError) b.adopt(bt, resource);
        throw Error("guard");
      },
      onError: () => {
        if (viaError) b.adopt(bt, resource);
        throw Error("error sink");
      },
    });
    assert.equal(a.adopt(a.begin("instrument"), resource), false);
    a.dispose();
    assert.equal(releases, 0);
    b.dispose();
    assert.equal(releases, 1);
  }
});
test("OWNER-01 cleanup onError can acquire or terminally release incoming offer", () => {
  for (const acquire of [true, false]) {
    let play = true,
      releases = 0;
    const resource = () => releases++,
      b = new ExtensionOwners(),
      bt = b.begin("capture");
    const a = new ExtensionOwners({
        playbackRequested: () => play,
        onError: () => {
          b.adopt(acquire ? bt : {}, resource);
        },
      }),
      at = a.begin("instrument");
    a.adopt(at, () => {
      throw Error("old release");
    });
    play = false;
    assert.equal(a.adopt(at, resource), false);
    assert.equal(releases, acquire ? 0 : 1);
    a.dispose();
    b.stop();
    assert.equal(releases, 1);
  }
});
test("OWNER-01 nested adoption preserves same-adapter alternate token and current-token duplicate", () => {
  for (const different of [true, false]) {
    let releases = 0,
      nested = false,
      a;
    const resource = () => releases++;
    a = new ExtensionOwners({
      playbackRequested: () => {
        if (!nested) {
          nested = true;
          const token = different ? a.begin("capture") : at;
          assert.equal(a.adopt(token, resource), true);
        }
        return true;
      },
    });
    const at = a.begin("instrument");
    assert.equal(a.adopt(at, resource), !different);
    assert.equal(a.snapshot().active, 1);
    assert.equal(releases, 0);
    a.stop();
    a.dispose();
    assert.equal(releases, 1);
  }
});
