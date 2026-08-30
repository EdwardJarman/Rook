import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
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
