import { execSync } from "node:child_process";

declare const __PKG_VERSION__: string;

export function getVersion(): string {
  // Production build: tsup replaces __PKG_VERSION__ with the package.json version
  if (typeof __PKG_VERSION__ !== "undefined") {
    return __PKG_VERSION__;
  }

  // Development (tsx): fall back to git commit hash
  try {
    const hash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
    return `dev (${hash})`;
  } catch {
    return "dev";
  }
}
