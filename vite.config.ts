/**
 * Vite configuration for the Counterpedia Chrome extension.
 *
 * Produces four separate bundles:
 *   dist/background/service-worker.js
 *   dist/panel/panel.js
 *   dist/panel/local-pairing.js
 *   dist/popup/popup.js
 *
 * Also copies static assets (HTML, CSS, manifest, icons). The team-beta local
 * pairing entry is injected into the copied panel HTML at build time so the
 * canonical panel source remains unchanged and the capability stays confined
 * to builds that include this config/branch.
 */

import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import {
  copyFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Plugin to copy static assets after build
function copyStaticAssets() {
  return {
    name: "copy-static-assets",
    closeBundle() {
      // manifest.json → dist/manifest.json
      copyFileSync("manifest.json", "dist/manifest.json");

      // Panel HTML + CSS
      mkdirSync("dist/panel", { recursive: true });
      copyFileSync("src/panel/index.html", "dist/panel/index.html");
      copyFileSync("src/panel/panel.css", "dist/panel/panel.css");

      // TEAM-UX0: inject the separately-bundled local pairing UI immediately
      // before the existing panel entry. The pairing module only configures
      // local transport; it does not alter acquisition/authoring semantics.
      const panelHtmlPath = "dist/panel/index.html";
      const panelHtml = readFileSync(panelHtmlPath, "utf8");
      const marker = '  <script type="module" src="panel.js"></script>';
      if (!panelHtml.includes(marker)) {
        throw new Error("panel.js script marker missing; refusing to build unpaired team-beta HTML");
      }
      writeFileSync(
        panelHtmlPath,
        panelHtml.replace(
          marker,
          '  <script type="module" src="local-pairing.js"></script>\n' + marker,
        ),
        "utf8",
      );

      // Popup HTML
      mkdirSync("dist/popup", { recursive: true });
      copyFileSync("src/popup/index.html", "dist/popup/index.html");

      // Icons (if they exist)
      if (existsSync("icons")) {
        mkdirSync("dist/icons", { recursive: true });
        for (const icon of ["icon16.png", "icon48.png", "icon128.png"]) {
          if (existsSync(`icons/${icon}`)) {
            copyFileSync(`icons/${icon}`, `dist/icons/${icon}`);
          }
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [copyStaticAssets()],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    minify: false, // Keep readable for extension review
    rollupOptions: {
      input: {
        "background/service-worker": resolve(__dirname, "src/background/service-worker.ts"),
        "panel/panel": resolve(__dirname, "src/panel/panel.ts"),
        "panel/local-pairing": resolve(__dirname, "src/panel/localPairing.ts"),
        "popup/popup": resolve(__dirname, "src/popup/popup.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "[name][extname]",
        format: "esm",
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
