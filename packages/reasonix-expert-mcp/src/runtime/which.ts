// Minimal cross-runtime `which` for resolving executable names from PATH.
// Replaces `import { which } from "bun"`.

import { existsSync } from "node:fs";
import { delimiter } from "node:path";

export function whichSync(name: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(delimiter);

  const exts = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = `${dir}\\${name}${ext}`;
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}
