import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  envDir: "..",
  base: "/",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
