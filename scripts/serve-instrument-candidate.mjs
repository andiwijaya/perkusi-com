import { createServer } from "vite";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Local-only asset bridge. Nothing is copied into public/ or default dist.
const corpus = resolve("qa-artifacts/v4-s2-2026-10-13"),
  evidence = resolve("qa-artifacts/v4-s3-combined-2026-10-14");
const manifest = JSON.parse(
  await readFile(corpus + "/DERIVATIVE-MANIFEST.json", "utf8"),
);
const routes = new Map(
  manifest.rows.flatMap((row) =>
    row.delivery.map((d) => [
      d.assetPath,
      {
        file: resolve(corpus, d.path),
        bytes: d.encodedBytes,
        sha256: d.SHA256,
      },
    ]),
  ),
);
const legacy = JSON.parse(
  await readFile(resolve("internal/original-groove/manifest.json"), "utf8"),
);
for (const asset of legacy.assets)
  routes.set("/sounds/original-groove/" + asset.assetPath.split("/").at(-1), {
    file: resolve("internal/original-groove", asset.assetPath),
    bytes: asset.bytes,
    sha256: asset.sha256,
  });
for (const directory of ["studio-kits", "v3-sounds"]) {
  const catalog = JSON.parse(
    await readFile(resolve("internal", directory, "manifest.json"), "utf8"),
  );
  for (const asset of [
    ...(catalog.kits ?? []).flatMap((k) => k.assets),
    ...(catalog.instrument?.assets ?? []),
  ])
    routes.set("/internal/" + directory + "/" + asset.assetPath, {
      file: resolve("internal", directory, asset.assetPath),
      bytes: asset.bytes,
      sha256: asset.sha256,
    });
}
for (const route of routes.values()) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(route.file)) hash.update(chunk);
  if (
    hash.digest("hex") !== route.sha256 ||
    (await stat(route.file)).size !== route.bytes
  )
    throw Error("Candidate asset integrity failed");
}
export async function candidateServer(port = 4608) {
  const server = await createServer({
    cacheDir: evidence + "/vite-cache",
    server: { host: "127.0.0.1", port, strictPort: true },
    plugins: [
      {
        name: "local-instrument-assets",
        enforce: "pre",
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            const url = new URL(req.url, "http://127.0.0.1");
            if (url.searchParams.has("import") || url.searchParams.has("url"))
              return next();
            const record = routes.get(url.pathname);
            if (!record) return next();
            res.setHeader("content-type", "audio/wav");
            res.setHeader("content-length", String(record.bytes));
            const stream = createReadStream(record.file);
            stream.on("error", () => res.destroy());
            res.on("close", () => stream.destroy());
            stream.pipe(res);
          });
        },
      },
    ],
  });
  await server.listen();
  return server;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const server = await candidateServer(Number(process.argv[2] ?? 4608));
  console.log(
    "Local candidate: http://127.0.0.1:" +
      (process.argv[2] ?? 4608) +
      "/internal/instrument-focus/",
  );
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
