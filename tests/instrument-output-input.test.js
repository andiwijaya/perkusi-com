import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { OwnedOutput } from "../src/audio/owned-output.js";
import { HeldPadInputs } from "../src/gamelan/held-pad-inputs.js";

test("S3 output Blob/URL share admission until revocation, are bounded and cannot reopen after release", () => {
  const memory = new AudioMemory({ maxBytes: 128 });
  const urls = new Map();
  let id = 0,
    revoked = 0;
  const make = () =>
    new OwnedOutput(
      new Blob([new Uint8Array(32)]),
      memory.reserve(64, "output"),
      {
        createURL: (blob) => {
          const url = "url-" + ++id;
          urls.set(url, blob.size);
          return url;
        },
        revokeURL: (url) => {
          assert.equal(memory.snapshot().bytes, 64);
          assert.ok(urls.delete(url));
          revoked++;
        },
      },
    );
  let old;
  for (let n = 0; n < 16; n++) {
    old?.release();
    const current = make();
    assert.equal(current.downloadURL(), current.downloadURL());
    assert.equal(urls.size, 1);
    assert.equal(memory.snapshot().bytes, 64);
    if (old) {
      assert.throws(
        () => old.downloadURL(),
        (e) => e.code === "exportReleased",
      );
      assert.throws(
        () => old.blob,
        (e) => e.code === "exportReleased",
      );
    }
    old = current;
  }
  old.release();
  old.release();
  assert.equal(revoked, 16);
  assert.equal(urls.size, 0);
  assert.equal(memory.snapshot().bytes, 0);
});

test("S3 output failed revocation retains admission and can be retried without orphaning URL", () => {
  const memory = new AudioMemory({ maxBytes: 128 });
  let blocked = true;
  const output = new OwnedOutput(
    new Blob(["owned"]),
    memory.reserve(64, "output"),
    {
      createURL: () => "owned-url",
      revokeURL: () => {
        if (blocked) throw Error("QA failed revoke");
      },
    },
  );
  output.downloadURL();
  assert.throws(() => output.release());
  assert.equal(memory.snapshot().bytes, 64);
  assert.equal(output.downloadURL(), "owned-url");
  blocked = false;
  output.release();
  assert.equal(memory.snapshot().bytes, 0);
});

test("S3 captured Enter/Space/letter release owns original pad through focus changes and repeated input", () => {
  const first = {},
    second = {},
    calls = [];
  const held = new HeldPadInputs({
    activate: (pad) => calls.push(["strike", pad]),
    deactivate: (pad, damp) => calls.push(["release", pad, damp]),
  });
  for (const token of ["key:Enter", "key:Space", "key:KeyA"]) {
    held.press(token, first);
    assert.equal(held.press(token, second), false);
    assert.equal(held.owns(token), true);
    held.release(token);
    assert.equal(held.release(token), false);
  }
  assert.equal(calls.length, 6);
  assert.ok(calls.every((c) => c[1] === first));
  assert.ok(calls.filter((c) => c[0] === "release").every((c) => c[2]));
});

test("S3 simultaneous keyboard/pointer owners damp only on final release; blur/focus teardown clears exactly once", () => {
  const pad = {},
    calls = [];
  const held = new HeldPadInputs({
    activate: () => calls.push("strike"),
    deactivate: (_, damp) => calls.push(damp ? "damp" : "cancel"),
  });
  held.press("key:Enter", pad);
  held.press("key:KeyA", pad);
  held.press("pointer:1", pad);
  held.release("key:Enter");
  held.release("pointer:1");
  assert.deepEqual(calls, ["strike"]);
  held.release("key:KeyA");
  assert.deepEqual(calls, ["strike", "damp"]);
  held.press("key:Space", pad);
  held.clear({ damp: false });
  held.clear();
  held.release("key:Space");
  assert.deepEqual(calls, ["strike", "damp", "strike", "cancel"]);
  held.press("pointer:2", pad);
  held.clear();
  assert.deepEqual(calls.slice(-2), ["strike", "damp"]);
});
