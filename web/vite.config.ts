import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  base: "/pay/",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
