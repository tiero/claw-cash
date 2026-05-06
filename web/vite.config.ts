import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  envDir: "..",
  base: "/",
  resolve: {
    alias: {
      events: "events",
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
