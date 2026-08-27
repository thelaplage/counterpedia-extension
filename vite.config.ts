/**
 * Vite configuration for the Counterpedia Chrome extension.
 *
 * Produces separate bundles for the background worker, panel, pitch-research
 * demo composition, and popup. Static HTML/CSS/manifest assets are copied after
 * build so the Chrome package remains inspectable.
 */

import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { copyFileSync, mkdirSync, existsSync } from "fs";
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
        "panel/pitchResearchDemo": resolve(__dirname, "src/panel/pitchResearchDemo.ts"),
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