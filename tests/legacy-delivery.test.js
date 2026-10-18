import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  gamelanPreviewAssets,
  originalGrooveDelivery,
} from "../scripts/gamelan-preview-assets.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
test("dev legacy URLs serve all twelve exact registered WAVs instead of the HTML fallback", async () => {
  const rows = await originalGrooveDelivery(root),
    stack = [];
  await gamelanPreviewAssets(root).configureServer({
    middlewares: {
      use(fn) {
        stack.push(fn);
      },
    },
  });
  const server = createServer((req, res) =>
    stack[0](req, res, (e) => {
      res.statusCode = e ? 500 : 404;
      res.end("not an asset");
    }),
  );
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", ok);
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal(rows.length, 12);
    for (const row of rows) {
      const r = await fetch(origin + row.assetPath),
        bytes = Buffer.from(await r.arrayBuffer());
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "audio/wav");
      assert.equal(bytes.length, row.bytes);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        row.sha256,
      );
      assert.deepEqual(bytes, await readFile(row.source));
      const head = await fetch(origin + row.assetPath, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      assert.equal(Number(head.headers.get("content-length")), row.bytes);
      const cached = await fetch(origin + row.assetPath, {
        headers: { "if-none-match": '"' + row.sha256 + '"' },
      });
      assert.equal(cached.status, 304);
    }
    assert.equal(
      (await fetch(origin + "/sounds/original-groove/not-registered.wav"))
        .status,
      404,
    );
    assert.equal(
      (await fetch(origin + "/sounds/original-groove/../manifest.json")).status,
      404,
    );
    assert.equal(
      (await fetch(origin + rows[0].assetPath, { method: "POST" })).status,
      404,
    );
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});
