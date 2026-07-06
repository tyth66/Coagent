// @ts-nocheck -- Bun-only module, dynamically loaded at runtime
// Bun-specific spawn implementation.
// Uses Bun.spawn and wraps it into the SpawnResult interface.

import type { SpawnResult, SpawnOptions } from "./spawn";

export function bunSpawn(opts: SpawnOptions): SpawnResult {
  const proc = Bun.spawn(opts.command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  });

  return {
    get pid() {
      return proc.pid;
    },
    get stdin() {
      return new WritableStream<Uint8Array>({
        async write(chunk) {
          proc.stdin.write(chunk);
        },
        async close() {
          proc.stdin.end();
        },
      });
    },
    get stdout() {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          const reader = proc.stdout.getReader();
          function pump(): void {
            reader.read().then(({ value, done }) => {
              if (done) { controller.close(); return; }
              controller.enqueue(value);
              pump();
            }).catch((err) => controller.error(err));
          }
          pump();
        },
      });
    },
    get stderr() {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          const reader = proc.stderr.getReader();
          function pump(): void {
            reader.read().then(({ value, done }) => {
              if (done) { controller.close(); return; }
              controller.enqueue(value);
              pump();
            }).catch(() => controller.close());
          }
          pump();
        },
      });
    },
    get exitCode() {
      return proc.exited;
    },
    kill() {
      try { proc.kill(); } catch { /* ignore */ }
    },
  };
}

