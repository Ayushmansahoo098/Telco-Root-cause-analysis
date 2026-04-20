import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "serve" ? "/" : "/static/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "app/static",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/health": "http://127.0.0.1:7860",
      "/tasks": "http://127.0.0.1:7860",
      "/reset": "http://127.0.0.1:7860",
      "/step": "http://127.0.0.1:7860",
      "/state": "http://127.0.0.1:7860",
      "/grade": "http://127.0.0.1:7860",
      "/trajectory": "http://127.0.0.1:7860",
    },
  },
}));
