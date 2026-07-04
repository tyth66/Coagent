import { runServerFromEnv } from "./mcp/server";

export function adapterScaffoldReady(): boolean {
  return true;
}

export { runMcpServer, runServerFromEnv } from "./mcp/server";

if (import.meta.main) {
  runServerFromEnv().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
