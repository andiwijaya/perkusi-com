import test from "node:test";
import assert from "node:assert/strict";
import {
  RAW_DOCUMENTS,
  readRawDocument,
  rawDocumentFile,
} from "../src/project/legacy-raw-recovery.js";
import {
  HANDOFF_DATABASE,
  HANDOFF_PAGE_SIZE,
  HANDOFF_MAX_BYTES,
  listHandoffOriginals,
  readHandoffOriginal,
  handoffMetadataFile,
} from "../src/project/handoff-recovery.js";
import { MAX_CANONICAL_PACKAGE } from "../src/project/canonical-package.js";
import {
  originalRecoveryHref,
  handoffRecoveryRedirect,
} from "../src/app/legacy-recovery-link.js";

function inbox(entries, version = 1) {
  const state = { opens: 0, closes: 0, modes: [], writes: 0 },
    keyRange = { lowerBound: (key) => ({ after: key }) };
  const indexedDB = {
    databases: async () => [{ name: HANDOFF_DATABASE, version }],
    open(...args) {
      assert.equal(args.length, 1);
      state.opens++;
      const request = {};
      request.result = {
        version,
        objectStoreNames: { contains: (s) => s === "transfers" },
        close() {
          state.closes++;
        },
        transaction(stores, mode) {
          assert.deepEqual(stores, ["transfers"]);
          state.modes.push(mode);
          assert.equal(mode, "readonly");
          let aborted = false;
          const tx = {
            abort() {
              aborted = true;
              queueMicrotask(() => tx.onabort());
            },
            objectStore() {
              return {
                openCursor(query) {
                  const selected = [...entries]
                    .filter(([key]) =>
                      query?.after !== undefined
                        ? key > query.after
                        : query === undefined || key === query,
                    )
                    .sort(([a], [b]) => a.localeCompare(b));
                  const r = {};
                  let i = 0;
                  function next() {
                    if (aborted) return;
                    let continued = false;
                    const row = selected[i];
                    r.result = row
                      ? {
                          primaryKey: row[0],
                          value: row[1],
                          continue() {
                            continued = true;
                            i++;
                            queueMicrotask(next);
                          },
                        }
                      : null;
                    r.onsuccess();
                    if (!continued)
                      queueMicrotask(() => {
                        if (!aborted) tx.oncomplete();
                      });
                  }
                  queueMicrotask(next);
                  return r;
                },
              };
            },
          };
          return tx;
        },
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  return { indexedDB, keyRange, state };
}

test("raw families use the actual local/session identities, including empty/corrupt/future strings", async () => {
  const reads = [],
    stores = Object.fromEntries(
      ["localStorage", "sessionStorage"].map((area) => [
        area,
        {
          getItem(key) {
            reads.push([area, key]);
            return key.includes("incoming") ? "" : "{broken future999\r\n";
          },
        },
      ]),
    );
  for (const d of RAW_DOCUMENTS) {
    const text = readRawDocument(d.id, stores),
      file = rawDocumentFile(d.id, text);
    assert.equal(
      Buffer.from(await file.blob.arrayBuffer()).toString("utf8"),
      text,
    );
    assert.deepEqual(reads.at(-1), [d.area, d.key]);
  }
  assert.equal(
    RAW_DOCUMENTS.find((d) => d.id === "loop-incoming").area,
    "sessionStorage",
  );
  assert.equal(
    RAW_DOCUMENTS.find((d) => d.id === "gamelan-route").area,
    "sessionStorage",
  );
  assert.throws(() => readRawDocument("private", stores), {
    code: "unknownRawDocument",
  });
});

test("raw Gamelan4MiB, route3MiB and Loop2MiB ceilings retain every byte without parsing", async () => {
  for (const id of [
    "gamelan-workspace",
    "gamelan-route",
    "loop-draft",
    "loop-incoming",
  ]) {
    const d = RAW_DOCUMENTS.find((d) => d.id === id),
      raw = "x".repeat(d.contractBytes - 2) + "\r\n",
      file = rawDocumentFile(id, raw);
    assert.equal(file.blob.size, d.contractBytes);
    assert.equal(await file.blob.text(), raw);
  }
  assert.throws(
    () => rawDocumentFile("loop-draft", "x".repeat(8 * 1024 * 1024 + 1)),
    { code: "rawDocumentTooLarge" },
  );
});

test("malformed UTF16 raw export preserves code units rather than Blob string replacement", async () => {
  const raw = "future\ud800\u0000\r\n\udfff",
    file = rawDocumentFile("loop-draft", raw),
    bytes = new Uint8Array(await file.blob.arrayBuffer()),
    view = new DataView(bytes.buffer);
  assert.equal(file.encoding, "UTF-16LE+BOM (exact code units)");
  assert(file.name.endsWith(".utf16le.txt"));
  assert.equal(view.getUint16(0, true), 0xfeff);
  assert.equal(bytes.length, raw.length * 2 + 2);
  for (let i = 0; i < raw.length; i++)
    assert.equal(view.getUint16(2 + i * 2, true), raw.charCodeAt(i));
});

test("missing inbox or unsafe discovery never opens or creates a database", async () => {
  let opens = 0;
  const indexedDB = {
    databases: async () => [],
    open() {
      opens++;
      throw Error("must not open");
    },
  };
  assert.equal((await listHandoffOriginals({ indexedDB })).missing, true);
  await assert.rejects(readHandoffOriginal("id", { indexedDB }), {
    code: "handoffMissing",
  });
  await assert.rejects(
    listHandoffOriginals({
      indexedDB: {
        open() {
          throw Error();
        },
      },
    }),
    { code: "safeDatabaseListingUnavailable" },
  );
  assert.equal(opens, 0);
});

test("inbox deletion race aborts attempted creation; late successful handles close after blocked/cancelled admission", async () => {
  let aborted = 0,
    request,
    closed = 0;
  const indexedDB = {
    databases: async () => [{ name: HANDOFF_DATABASE }],
    open() {
      const r = {
        transaction: {
          abort() {
            aborted++;
          },
        },
      };
      queueMicrotask(() => r.onupgradeneeded());
      return r;
    },
  };
  await assert.rejects(listHandoffOriginals({ indexedDB }), {
    code: "handoffDatabaseChanged",
  });
  assert.equal(aborted, 1);
  indexedDB.open = () => {
    request = {};
    queueMicrotask(() => request.onblocked());
    return request;
  };
  await assert.rejects(listHandoffOriginals({ indexedDB }), {
    code: "handoffBlocked",
  });
  request.result = {
    close() {
      closed++;
    },
  };
  request.onsuccess();
  assert.equal(closed, 1);
  const signal = new AbortController();
  signal.abort();
  await assert.rejects(
    listHandoffOriginals({ indexedDB, signal: signal.signal }),
    { code: "cancelled" },
  );
});

test("paged inbox discovery does not require UUID and has no missing/duplicate records or write transaction", async () => {
  const data = new Map(
      Array.from({ length: HANDOFF_PAGE_SIZE * 2 + 3 }, (_, i) => [
        String(i).padStart(3, "0"),
        { title: "Original", blob: new Blob([String(i)]) },
      ]),
    ),
    f = inbox(data, 7),
    rows = [];
  let after = null;
  do {
    const page = await listHandoffOriginals({ ...f, after });
    rows.push(...page.rows);
    after = page.next;
  } while (after !== null);
  assert.deepEqual(
    rows.map((r) => r.key),
    [...data.keys()],
  );
  assert.equal(f.state.opens, 3);
  assert.equal(f.state.closes, 3);
  assert(f.state.modes.every((m) => m === "readonly"));
  assert.equal(f.state.writes, 0);
});

test("original Blob bytes and every supported metadata field survive; future/corrupt row is unverified, never converted", async () => {
  const blob = new Blob([new Uint8Array([0, 255, 13, 10, 127])]),
    hash = Buffer.from(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ).toString("hex"),
    row = {
      version: 1,
      id: "known",
      kind: "legacy",
      title: "Original",
      createdAt: 1,
      bytes: blob.size,
      sha256: hash,
      blob,
      prepared: {
        backupId: "raw",
        baseSHA256: "a".repeat(64),
        mode: "replace",
      },
      accepted: null,
      future: { keep: "\ud800", revision: 999 },
    },
    data = new Map([["known", row]]),
    f = inbox(data);
  const original = await readHandoffOriginal("known", f);
  assert.equal(original.verified, true);
  assert.equal(original.sha256, hash);
  assert.deepEqual(
    new Uint8Array(await original.blob.arrayBuffer()),
    new Uint8Array(await blob.arrayBuffer()),
  );
  const metadata = JSON.parse(await handoffMetadataFile(original).text());
  assert.equal(metadata.key, "known");
  assert.deepEqual(metadata.sourceBlob, {
    bytes: blob.size,
    type: blob.type,
    sha256: hash,
  });
  const file = new File([blob], "original name.perkusi", {
    type: "application/octet-stream",
    lastModified: 1234,
  });
  const fileMetadata = JSON.parse(
    await handoffMetadataFile({
      ...original,
      row: { ...row, blob: file },
    }).text(),
  );
  assert.deepEqual(fileMetadata.sourceBlob, {
    bytes: blob.size,
    type: file.type,
    sha256: hash,
    name: file.name,
    lastModified: 1234,
  });
  const { blob: ignored, ...expected } = row;
  assert.equal(ignored, blob);
  assert.deepEqual(metadata.metadata, expected);
  assert.equal(data.get("known"), row);
  data.set("known", { ...row, version: 999, sha256: "b".repeat(64) });
  const future = await readHandoffOriginal("known", f);
  assert.equal(future.verified, false);
  assert.equal(future.blob, blob);
  assert.equal(
    JSON.parse(await handoffMetadataFile(future).text()).metadata.version,
    999,
  );
  future.row.unknown = new Map([[1, 2]]);
  assert.throws(() => handoffMetadataFile(future), {
    code: "handoffMetadataUnsupported",
  });
  assert.equal(future.blob, blob);
});

test("malformed/over-limit originals refuse without reading binary or changing storage", async () => {
  assert.equal(HANDOFF_MAX_BYTES, MAX_CANONICAL_PACKAGE);
  let copied = false;
  class TooLarge extends Blob {
    get size() {
      return HANDOFF_MAX_BYTES + 1;
    }
    arrayBuffer() {
      copied = true;
      throw Error();
    }
  }
  const f = inbox(
    new Map([
      ["large", { blob: new TooLarge() }],
      ["bad", { version: 999 }],
    ]),
  );
  await assert.rejects(readHandoffOriginal("large", f), {
    code: "handoffOriginalUnavailable",
  });
  assert.equal(copied, false);
  await assert.rejects(readHandoffOriginal("bad", f), {
    code: "handoffOriginalUnavailable",
  });
  await assert.rejects(readHandoffOriginal("missing", f), {
    code: "handoffMissing",
  });
  assert.equal(f.state.opens, f.state.closes);
});

test("old handoff deep links resolve to data-only same-origin routes, retaining ID/EN and UUID", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  for (const locale of ["id", "en"]) {
    const prefix = locale === "en" ? "/en" : "";
    for (const key of ["handoff", "canonicalOrigin"])
      assert.equal(
        handoffRecoveryRedirect(
          "https://perkusi.com" +
            prefix +
            "/studio/?candidate=canonical&" +
            key +
            "=" +
            id,
        ),
        originalRecoveryHref(locale, id),
      );
  }
  assert.equal(
    handoffRecoveryRedirect("https://perkusi.com/beatbox/?handoff=" + id),
    null,
  );
  assert.equal(
    handoffRecoveryRedirect("https://perkusi.com/studio/?handoff=bad"),
    null,
  );
});
