import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDocument } from "./src/app/document.js";
import { buildEntries, pageFromPath } from "./src/app/routes.js";
import {
  gamelanPreviewAssets,
  gamelanDeliveryAliases,
} from "./scripts/gamelan-preview-assets.mjs";
import { gamelanBuildMode } from "./src/gamelan/public-context.js";
import { publicCandidateHTML } from "./scripts/gamelan-public-pages.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
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
  const finalStudio = mode === "gamelan-v5-final";
  const canonicalRelease = mode === "gamelan-v5-canonical-release";
  const v5UX = [
    "gamelan-v5-ux",
    "gamelan-v5-public-candidate",
    "gamelan-v5-canonical-release",
    "gamelan-v5-final",
  ].includes(mode);
  const gamelan = gamelanBuildMode(mode) || v5UX;
  const publicCandidate = [
    "gamelan-public-candidate",
    "gamelan-v5-public-candidate",
    "gamelan-v5-canonical-release",
    "gamelan-v5-final",
  ].includes(mode);
  const delivery =
    process.env.PERKUSI_GAMELAN_DELIVERY ||
    (publicCandidate || v5UX ? "flac" : "pcm");
  return {
    appType: "mpa",
    define: {
      "import.meta.env.CANONICAL_FINAL_STUDIO": JSON.stringify(finalStudio),
      "import.meta.env.CANONICAL_PUBLIC_PREVIEW":
        JSON.stringify(canonicalRelease),
      // Private compiled review only. Public builds keep canonical routes off.
      "import.meta.env.CANONICAL_LOCAL_REVIEW": JSON.stringify(
        mode === "gamelan-v5-ux",
      ),
      "import.meta.env.GAMELAN_V5_UX": JSON.stringify(v5UX),
      "import.meta.env.GAMELAN_BUILD": JSON.stringify(gamelan),
      "import.meta.env.GAMELAN_PUBLIC_BUILD": JSON.stringify(publicCandidate),
      "import.meta.env.GAMELAN_DELIVERY": JSON.stringify(
        gamelan && delivery === "flac" ? "flac" : "pcm",
      ),
    },
    resolve: {
      alias: gamelan ? gamelanDeliveryAliases(root, delivery) : [],
    },
    build: {
      ...(mode === "gamelan-preview"
        ? { outDir: "qa-artifacts/gamelan-preview-dist", emptyOutDir: false }
        : {}),
      rollupOptions: {
        input:
          mode === "audio-prototype"
            ? {
                ...buildEntries,
                audioPrototype: "internal/audio/index.html",
                soundLab: "internal/sound-lab/index.html",
              }
            : gamelan
              ? {
                  ...buildEntries,
                  ...(publicCandidate
                    ? {
                        recoveryId: "studio/recovery/index.html",
                        recoveryEn: "en/studio/recovery/index.html",
                      }
                    : {}),
                  ...(v5UX
                    ? {
                        loopId: "loop-station/index.html",
                        loopEn: "en/loop-station/index.html",
                      }
                    : {}),
                  gamelanId: "gamelan/index.html",
                  gamelanEn: "en/gamelan/index.html",
                  gamelanCreditsId: "gamelan/credits/index.html",
                  gamelanCreditsEn: "en/gamelan/credits/index.html",
                }
              : buildEntries,
      },
    },
    plugins: [
      ...(gamelan
        ? [
            gamelanPreviewAssets(root, {
              delivery,
              localV5: v5UX,
            }),
          ]
        : []),
      {
        name: "localized-static-pages",
        transformIndexHtml: {
          order: "pre",
          handler(html, context) {
            if (context.path.includes("/studio/recovery/"))
              return finalStudio
                ? html
                    .replace(/ Preview/g, "")
                    .replace(
                      'id="recovery-legacy"',
                      'id="recovery-legacy" hidden',
                    )
                    .replace(/\?candidate=canonical&amp;lang=/g, "?lang=")
                : html;
            if (context.path.includes("/loop-station/"))
              return v5UX
                ? publicCandidateHTML(html, {
                    loop: true,
                    locale: context.path.startsWith("/en/") ? "en" : "id",
                  })
                : html;
            const match = html.match(
              /<!-- perkusi-page:(home|beatbox|studio|privacy|notFound):(id|en) -->/,
            );
            let rendered = match ? renderDocument(match[1], match[2]) : html;
            if (publicCandidate || v5UX)
              rendered = publicCandidateHTML(rendered, {
                v5UX,
                finalStudio,
                page: match?.[1] || null,
                locale:
                  match?.[2] || (context.path.startsWith("/en/") ? "en" : "id"),
                credits: context.path.includes("/credits/"),
              });
            return (mode === "gamelan-preview" || (v5UX && !publicCandidate)) &&
              match?.[1] === "studio"
              ? rendered.replace(
                  "<head>",
                  '<head><meta name="robots" content="noindex,nofollow">',
                )
              : rendered;
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
