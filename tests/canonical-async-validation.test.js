import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  migrateLegacyMetadata,
  validateCanonicalMetadata,
} from "../src/project/canonical-metadata.js";
import { canonicalFixtureRegistry as registry } from "./helpers/canonical-fixtures.js";

// A real embedded-text digest supplies the await boundary. No sleeps, digest
// monkeypatches or caller freezing are used to manufacture or avoid the race.
const { project: baseline } = await migrateLegacyMetadata(
  await readFile(
    new URL(
      "./fixtures/v5-canonical/schema4-multibar.perkusi.json",
      import.meta.url,
    ),
  ),
  { registry },
);
const score = (p) => p.sourceDefs.find((d) => d.kind === "instrument-events");
const composition = (p) => p.sourceDefs.find((d) => d.kind === "composition");
const cases = [
  [
    "review late-schema",
    (p) => {
      p.schemaVersion = 7;
    },
  ],
  [
    "review late-master",
    (p) => {
      p.master.volume = 2;
    },
  ],
  [
    "review late-extra-key",
    (p) => {
      p.unexpected = "unvalidated";
    },
  ],
  [
    "review late-getter",
    (p, getter) => {
      Object.defineProperty(p, "unexpected", {
        enumerable: true,
        configurable: true,
        get: getter,
      });
    },
  ],
  [
    "nested master replacement",
    (p) => {
      p.master = { volume: 2, limiter: null };
    },
  ],
  [
    "nested event mutation",
    (p) => {
      score(p).programme.events[0].velocity = 2;
    },
  ],
  [
    "nested control mutation",
    (p) => {
      composition(p).programme.patterns[0].beatbox[0].variant = 99;
    },
  ],
  [
    "nested reference replacement",
    (p) => {
      score(p).programme = { malicious: true };
    },
  ],
  [
    "nested source getter",
    (p, getter) => {
      Object.defineProperty(score(p).programme.events[0], "velocity", {
        enumerable: true,
        configurable: true,
        get: getter,
      });
    },
  ],
  [
    "nested origin getter",
    (p, getter) => {
      Object.defineProperty(
        p.origins.find((o) => o.kind === "embedded-text"),
        "text",
        { enumerable: true, configurable: true, get: getter },
      );
    },
  ],
  [
    "nested hash text mutation",
    (p) => {
      p.origins.find((o) => o.kind === "embedded-text").text =
        "changed after digest started";
    },
  ],
  [
    "late oversized value",
    (p) => {
      p.title = "x".repeat(8 * 1024 * 1024 + 1);
    },
  ],
  [
    "late nested cycle",
    (p) => {
      score(p).programme.events = p;
    },
  ],
];
for (const [name, mutate] of cases)
  test(`Q1b async snapshot: ${name}`, async () => {
    const caller = structuredClone(baseline);
    let touched = 0;
    const getter = () => {
      touched++;
      throw Error("caller getter must never run");
    };
    const pending = validateCanonicalMetadata(caller, registry);
    mutate(caller, getter);
    const result = await pending;
    assert.deepEqual(
      result,
      baseline,
      "only the initial guarded snapshot may be published",
    );
    assert.equal(touched, 0);
    assert.equal(Object.isFrozen(caller), false);
    assert.equal(Object.isFrozen(caller.sourceDefs), false);
    assert.equal(Object.isFrozen(result), true);
    assert.notEqual(result, caller);
    assert.notEqual(result.sourceDefs, caller.sourceDefs);
    if (name === "review late-getter")
      assert.equal(
        Object.getOwnPropertyDescriptor(caller, "unexpected").get,
        getter,
        "validator does not delete caller properties",
      );
    if (name === "review late-master") assert.equal(caller.master.volume, 2);
  });

test("Q1b async snapshots: concurrent calls capture independent initial versions", async () => {
  const caller = structuredClone(baseline),
    first = validateCanonicalMetadata(caller, registry);
  caller.master.volume = 0.3;
  const second = validateCanonicalMetadata(caller, registry);
  caller.master.volume = 2;
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.master.volume, 0.17);
  assert.equal(b.master.volume, 0.3);
  assert.equal(caller.master.volume, 2);
  assert.notEqual(a.sourceDefs, b.sourceDefs);
});

test("Q1b async rejection: an initially invalid object cannot be repaired after the call", async () => {
  const caller = structuredClone(baseline);
  caller.master.volume = 2;
  const pending = validateCanonicalMetadata(caller, registry);
  caller.master.volume = 0.17;
  await assert.rejects(pending);
  assert.equal(caller.master.volume, 0.17);
  assert.equal(Object.isFrozen(caller.master), false);
});

test("Q1b async rejection: repairing a hash while its digest awaits cannot rescue invalid initial state", async () => {
  const caller = structuredClone(baseline),
    o = caller.origins.find((o) => o.kind === "embedded-text"),
    good = o.sha256;
  o.sha256 = "0".repeat(64);
  const pending = validateCanonicalMetadata(caller, registry);
  o.sha256 = good;
  await assert.rejects(pending, { code: "invalidCanonicalProject" });
  assert.equal(o.sha256, good);
  assert.equal(Object.isFrozen(o), false);
});

test("Q1b snapshot creation obeys the existing byte guard before copying oversized input", async () => {
  const caller = structuredClone(baseline);
  caller.title = "x".repeat(8 * 1024 * 1024 + 1);
  await assert.rejects(validateCanonicalMetadata(caller, registry), {
    code: "projectTooLarge",
  });
  assert.equal(caller.title.length, 8 * 1024 * 1024 + 1);
  assert.equal(Object.isFrozen(caller), false);
});

test("Q1b static rejection: root and nested getters never execute during snapshot creation", async () => {
  for (const target of ["root", "nested"]) {
    const caller = structuredClone(baseline);
    let touched = 0;
    const getter = () => {
      touched++;
      throw Error("not called");
    };
    const owner =
        target === "root" ? caller : score(caller).programme.events[0],
      key = target === "root" ? "unexpected" : "velocity";
    Object.defineProperty(owner, key, {
      enumerable: true,
      configurable: true,
      get: getter,
    });
    await assert.rejects(validateCanonicalMetadata(caller, registry));
    assert.equal(touched, 0);
    assert.equal(Object.getOwnPropertyDescriptor(owner, key).get, getter);
    assert.equal(Object.isFrozen(owner), false);
  }
});

test("Q1b async snapshot: per-pattern ownership remains separate in editable copies", async () => {
  const caller = structuredClone(baseline),
    patterns = composition(caller).programme.patterns;
  patterns[1].beatbox = patterns[0].beatbox;
  const pending = validateCanonicalMetadata(caller, registry);
  patterns[0].beatbox[0].volume = 2;
  const result = await pending,
    rows = composition(result).programme.patterns;
  assert.notEqual(rows[0].beatbox, rows[1].beatbox);
  const editable = structuredClone(result);
  composition(editable).programme.patterns[1].beatbox[0].volume = 0.1;
  assert.equal(
    composition(editable).programme.patterns[0].beatbox[0].volume,
    0.7,
  );
  assert.equal(patterns[0].beatbox[0].volume, 2);
});
