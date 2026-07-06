// Post-build: fix tsc output for Node ESM compatibility.
// 1. Replace tsc paths aliases with runtime-relative paths.
// 2. Add .js extensions to all relative imports (Node ESM requirement).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "..", "dist");

function walk(dir: string, fn: (path: string) => void): void {
  let entries: string[];
  try { entries = require("node:fs").readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    let stat;
    try { stat = require("node:fs").statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      walk(full, fn);
    } else if (full.endsWith(".js") || full.endsWith(".d.ts")) {
      fn(full);
    }
  }
}

walk(distDir, (filePath) => {
  let content = readFileSync(filePath, "utf8");
  let changed = false;

  // Replace #runtime/ aliases with computed relative paths
  if (content.includes("#runtime/")) {
    const fileDir = dirname(filePath);
    const runtimeDir = resolve(distDir, "runtime");
    let rel = relative(fileDir, runtimeDir).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    content = content.replaceAll('"#runtime/', `"${rel}/`);
    changed = true;
  }

  // Add .js extension to relative imports without extensions
  // Matches: from "./foo" or from "../foo/bar"  (no extension)
  content = content.replace(
    /(from\s+")(\.[^"]+?)(?<!\.js|\.json|\.mjs)(")/g,
    (_match, prefix, path, suffix) => {
      // Don't add .js if it already ends with a known extension
      if (path.endsWith(".js") || path.endsWith(".json") || path.endsWith(".mjs")) {
        return prefix + path + suffix;
      }
      return prefix + path + '.js' + suffix;
    }
  );

  if (content !== readFileSync(filePath, "utf8")) {
    writeFileSync(filePath, content, "utf8");
    console.log(`  postbuild: fixed ${filePath.replace(distDir, "dist")}`);
  }
});

console.log("  postbuild: done");
