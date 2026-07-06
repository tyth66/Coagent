import type { AgentRunner, AgentRunResult } from "../core/interfaces";

// MockRunner returns a pure review result (no system envelope fields).
// Coagent wrapper metadata (task_id, request_id, status) is attached by the adapter.

export class MockRunner implements AgentRunner {
  async runReviewDiff(_input: Record<string, unknown>): Promise<AgentRunResult> {
    const result = {
      verdict: "pass" as const,
      summary: "Mock runner completed review.",
      findings: [] as Array<Record<string, unknown>>,
      tests_to_run: [] as string[],
      risks: [] as string[],
      assumptions: [] as string[],
      confidence: 0.9
    };
    return {
      stdout: JSON.stringify(result),
      stderr: "",
      exitCode: 0
    };
  }

  async shutdown(): Promise<void> {}
}
