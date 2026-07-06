// Spawn abstraction for cross-runtime process management (Bun / Node).
// RuntimeWorkerClient and ACPClient consume this interface instead of
// Bun.spawn directly, so the same code compiles for both runtimes.

export interface SpawnResult {
  readonly pid: number | undefined;
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exitCode: Promise<number>;
  kill(): void;
}

export interface SpawnOptions {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
}

// ---- Provider ----

type SpawnImpl = (opts: SpawnOptions) => SpawnResult | Promise<SpawnResult>;

let _spawn: SpawnImpl | null = null;

export function registerSpawn(impl: SpawnImpl): void {
  _spawn = impl;
}

export async function spawn(opts: SpawnOptions): Promise<SpawnResult> {
  if (!_spawn) {
    _spawn = await autoDetectSpawn();
  }
  return _spawn!(opts);
}

async function autoDetectSpawn(): Promise<SpawnImpl> {
  // Bun runtime detection
  if (typeof (globalThis as any).Bun !== "undefined") {
    // Dynamic import with string concat to prevent tsc from resolving it
    const mod = await import(/* webpackIgnore: true */ "./spawn-bun.js" as string);
    return mod.bunSpawn as SpawnImpl;
  }
  // Node runtime
  const mod = await import(/* webpackIgnore: true */ "./spawn-node.js" as string);
  return mod.nodeSpawn as SpawnImpl;
}
