// Node-specific spawn implementation.
// Uses child_process.spawn and wraps it into the SpawnResult interface.

import { spawn as nodeSpawnRaw } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { SpawnResult, SpawnOptions } from "./spawn";

export function nodeSpawn(opts: SpawnOptions): SpawnResult {
  const [command, ...args] = opts.command;

  const proc: ChildProcess = nodeSpawnRaw(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  // Track exit for the promise
  let exitResolve!: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    exitResolve = resolve;
  });

  proc.on("exit", (code) => exitResolve(code ?? -1));
  proc.on("error", () => exitResolve(-1));

  return {
    get pid() {
      return proc.pid ?? undefined;
    },
    get stdin() {
      return new WritableStream<Uint8Array>({
        async write(chunk) {
          if (!proc.stdin || proc.stdin.destroyed) return;
          return new Promise<void>((resolve, reject) => {
            proc.stdin!.write(chunk, (err) => {
              if (err) reject(err); else resolve();
            });
          });
        },
        async close() {
          proc.stdin?.end();
        },
      });
    },
    get stdout() {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          proc.stdout?.on("data", (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk));
          });
          proc.stdout?.on("end", () => controller.close());
          proc.stdout?.on("error", (err) => controller.error(err));
        },
      });
    },
    get stderr() {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          proc.stderr?.on("data", (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk));
          });
          proc.stderr?.on("end", () => controller.close());
          proc.stderr?.on("error", () => controller.close());
        },
      });
    },
    get exitCode() {
      return exitPromise;
    },
    kill() {
      try { proc.kill(); } catch { /* ignore */ }
    },
  };
}
