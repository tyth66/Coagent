import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  runAgentWorkerConformance,
  validateAgentWorkerReviewResult,
  type AgentWorkerRunResult,
  type ReviewDiffContractInput,
} from "./worker-contract";

const repoRoot = resolve(import.meta.dir, "../../../..");

describe("Agent Worker Contract", () => {
  test("root package exposes conformance:agent-worker", () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

    expect(packageJson.scripts?.["conformance:agent-worker"]).toBe(
      "bun packages/reasonix-expert-mcp/src/agent/worker-contract.ts",
    );
  });

  test("repo-local mock worker passes the success conformance check", async () => {
    const command = [
      resolve(
        repoRoot,
        process.platform === "win32" ? "bin/coagent-mock-worker.cmd" : "bin/coagent-mock-worker",
      ),
      "review-diff",
    ];

    const report = await runAgentWorkerConformance({ command, timeoutMs: 1_000 });

    expect(report.status).toBe("pass");
    expect(report.checks).toEqual([
      {
        name: "success",
        status: "pass",
        message: "worker emitted one valid pure review result JSON object",
      },
    ]);
  });

  for (const [name, run, code] of invalidCases()) {
    test(`${name} fails with ${code}`, () => {
      const result = validateAgentWorkerReviewResult(validInput(), run);

      expect(result.ok).toBe(false);
      expect(result.code).toBe(code);
    });
  }

  test("CLI exits zero for the default repo-local mock worker", async () => {
    const child = Bun.spawn([process.execPath, "packages/reasonix-expert-mcp/src/agent/worker-contract.ts"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Agent Worker Contract conformance: pass");
  });

  test("--help prints usage and exits zero", async () => {
    const child = Bun.spawn(
      [process.execPath, "packages/reasonix-expert-mcp/src/agent/worker-contract.ts", "--help"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );

    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--command-json");
  });
});

function invalidCases(): Array<[string, AgentWorkerRunResult, string]> {
  return [
    ["timeout", { stdout: "", stderr: "", exitCode: -1, timedOut: true }, "worker_timeout"],
    ["empty stdout", { stdout: "", stderr: "", exitCode: 0 }, "worker_empty_stdout"],
    ["malformed JSON", { stdout: "not-json", stderr: "", exitCode: 0 }, "worker_malformed_json"],
    [
      "multiple JSON objects",
      {
        stdout: `${JSON.stringify(validOutput())}\n${JSON.stringify(validOutput())}`,
        stderr: "",
        exitCode: 0,
      },
      "worker_malformed_json",
    ],
    [
      "markdown-fenced JSON",
      { stdout: `\`\`\`json\n${JSON.stringify(validOutput())}\n\`\`\``, stderr: "", exitCode: 0 },
      "worker_malformed_json",
    ],
    [
      "invalid verdict",
      { stdout: JSON.stringify({ ...validOutput(), verdict: "invalid" }), stderr: "", exitCode: 0 },
      "worker_schema_invalid",
    ],
    [
      "missing summary",
      { stdout: JSON.stringify({ ...validOutput(), summary: "" }), stderr: "", exitCode: 0 },
      "worker_schema_invalid",
    ],
    [
      "nonzero exit",
      { stdout: JSON.stringify(validOutput()), stderr: "failure", exitCode: 7 },
      "worker_nonzero_exit",
    ],
    [
      "invalid confidence",
      { stdout: JSON.stringify({ ...validOutput(), confidence: 2 }), stderr: "", exitCode: 0 },
      "worker_schema_invalid",
    ],
    [
      "findings not array",
      { stdout: JSON.stringify({ ...validOutput(), findings: "not-array" }), stderr: "", exitCode: 0 },
      "worker_schema_invalid",
    ],
  ];
}

function validInput(): ReviewDiffContractInput {
  return {
    schema_version: "review_diff_input_v1",
    task_id: "TASK-agent-contract",
    request_id: "REQ-agent-contract",
    mode: "review_diff",
    goal: "Validate the Agent Worker Contract.",
    repo: { root: repoRoot },
    artifacts: { diff_path: ".agent/diffs/current.diff" },
    permission_level: "L1_DIFF_REVIEW",
    output_schema: "review_result_v1",
  };
}

// Pure review result — no system envelope fields.
function validOutput() {
  return {
    verdict: "pass",
    summary: "No findings.",
    findings: [],
    tests_to_run: [],
    risks: [],
    assumptions: [],
    confidence: 0.9,
  };
}
