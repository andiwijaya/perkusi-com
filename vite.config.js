import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: { input: { main: "index.html", notFound: "404.html" } },
  },
  plugins: [
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
});
