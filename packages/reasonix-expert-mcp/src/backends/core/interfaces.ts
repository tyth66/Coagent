// Core interfaces for Coagent backend agents.

export interface AgentRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

export interface AgentRunner {
  runReviewDiff(input: { [key: string]: unknown; goal: string; repo: { root: string }; artifacts: { diff_path: string } }): Promise<AgentRunResult>;
  shutdown(): Promise<void>;
}

