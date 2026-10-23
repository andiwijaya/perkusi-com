import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDocument } from "./src/app/document.js";
import { buildEntries, pageFromPath } from "./src/app/routes.js";

import { retirementProvenance } from "./scripts/retirement-provenance.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const recoveryEntries = {
  ...buildEntries,
  recoveryId: "studio/recovery/index.html",
  recoveryEn: "en/studio/recovery/index.html",
  originalsId: "studio/recovery/originals/index.html",
  originalsEn: "en/studio/recovery/originals/index.html",
};
function missingPageMiddleware(server, preview = false) {
  return async (req, res, next) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (
      !["GET", "HEAD"].includes(req.method) ||
      pageFromPath(pathname) !== "notFound" ||
      pathname === "/404.html" ||
      pathname === "/en/404.html" ||
      pathname.startsWith("/@") ||
      pathname.startsWith("/node_modules/")
    )
      return next();
    const directories = preview
      ? [resolve(root, server.config.build.outDir)]
      : [root, join(root, "public")];
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      decoded = pathname;
    }
    if (
      directories.some((directory) => {
        const candidate = resolve(directory, "." + decoded);
        const within = relative(directory, candidate);
        return (
          !within.startsWith("..") &&
          !isAbsolute(within) &&
          existsSync(candidate)
        );
      })
    )
      return next();
    const locale = pathname.startsWith("/en/") ? "en" : "id";
    const html = preview
      ? readFileSync(
          resolve(
            root,
            server.config.build.outDir,
            locale === "en" ? "en/404.html" : "404.html",
          ),
          "utf8",
        )
      : await server.transformIndexHtml(
          "/404.html",
          renderDocument("notFound", locale),
        );
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(req.method === "HEAD" ? "" : html);
  };
}
export default defineConfig(({ mode }) => {
  if (
    ![
      "development",
      "production",
      "test",
      "retirement-review",
      "retirement-release",
    ].includes(mode)
  )
    throw Error("retiredBuildMode");
  return {
    appType: "mpa",
    build: {
      manifest: true,
      rollupOptions: {
        input: {
          ...recoveryEntries,
          retiredLoopId: "loop-station/index.html",
          retiredLoopEn: "en/loop-station/index.html",
          retiredGamelanId: "gamelan/index.html",
          retiredGamelanEn: "en/gamelan/index.html",
          retiredCreditsId: "gamelan/credits/index.html",
          retiredCreditsEn: "en/gamelan/credits/index.html",
        },
      },
    },
    plugins: [
      retirementProvenance(root),
      {
        name: "localized-static-pages",
        transformIndexHtml: {
          order: "pre",
          handler(html, context) {
            if (
              context.path.includes("/studio/recovery/") ||
              html.includes("data-perkusi-retired=")
            )
              return html;
            const match = html.match(
              /<!-- perkusi-page:(home|beatbox|studio|pads|privacy|notFound):(id|en) -->/,
            );
            return match ? renderDocument(match[1], match[2]) : html;
          },
        },
        configureServer(server) {
          server.middlewares.use(missingPageMiddleware(server));
        },
        configurePreviewServer(server) {
          server.middlewares.use(missingPageMiddleware(server, true));
        },
      },
      {
        name: "deployment-revision",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "version.json",
            source: JSON.stringify({
              commit: process.env.CF_PAGES_COMMIT_SHA || "local",
              branch: process.env.CF_PAGES_BRANCH || "local",
            }),
          });
        },
      },
    ],
  };
});
