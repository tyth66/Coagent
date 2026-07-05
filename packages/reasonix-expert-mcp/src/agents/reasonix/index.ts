// Reasonix agent backend registration.
//
// Two modes:
//   mock    — 621-byte echo worker for CI/testing (no LLM needed)
//   default — real worker that reads diff files and calls LLM
//
// Set COAGENT_AGENT_MODE=mock to use the mock worker.

import type { AgentRunner } from "../types";
import { AgentProcessRunner } from "../process-runner";

export function createReasonixAgent(command: string[], timeoutMs: number): AgentRunner {
  return new AgentProcessRunner({ command, timeoutMs }) as unknown as AgentRunner;
}

export function reasonixDefaultCommand(): string[] {
  if (process.env.COAGENT_AGENT_MODE === "mock") {
    return [process.execPath, new URL("./mock-worker.ts", import.meta.url).pathname];
  }
  return ["bun", "run", new URL("./worker.ts", import.meta.url).pathname];
}
