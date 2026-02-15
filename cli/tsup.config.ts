import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node20",
  platform: "node",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: ["@clw-cash/sdk", "@clw-cash/skills", "@lendasat/lendaswap-sdk-pure", "@noble/hashes"],
  external: ["better-sqlite3"],
});
