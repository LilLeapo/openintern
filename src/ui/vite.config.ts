import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);
const frontendRoot = path.resolve(thisDir, "frontend");

export default defineConfig({
  root: frontendRoot,
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:18791",
      "/healthz": "http://127.0.0.1:18791",
    },
  },
  build: {
    outDir: path.resolve(frontendRoot, "dist"),
    emptyOutDir: true,
  },
  css: {
    postcss: path.resolve(frontendRoot, "postcss.config.cjs"),
  },
});
