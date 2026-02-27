import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node20",
  platform: "node",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: ["@clw-cash/sdk", "@clw-cash/skills", "@lendasat/lendaswap-sdk-pure", "@noble/hashes"],
  external: ["better-sqlite3"],
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
