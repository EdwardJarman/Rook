import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    // The desktop app's own version (mirrors src-tauri/tauri.conf.json) so
    // the UI can show it even when the sidecar status feed is unavailable.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src/app") },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
  build: {
    outDir: "dist-app",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
  // Tauri expects a fixed port and a relative base path
  base: "./",
});
