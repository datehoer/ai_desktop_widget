import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  resolve: {
    dedupe: ["three"],
  },
  server: {
    port: 4173,
    strictPort: true,
    fs: {
      allow: [".."],
    },
  },
});
