import { describe, expect, test } from "bun:test";

import { RuntimeWorkerError } from "../runtime/RuntimeWorkerClient";
import { ERROR_CODES, errorLayerForCode } from "../agent/error-taxonomy";
import {
  BACKEND_NEUTRAL_REVIEW_DIFF_ALIAS,
  EXTERNAL_REVIEW_DIFF_TOOL_NAME,
  RUNTIME_REVIEW_DIFF_OPERATION,
} from "../agent/naming";
import { createReasonixToolsAdapter, listTools } from "./adapter";

describe("tools/list", () => {
  test("exposes reasonix.review_diff only", () => {
    expect(listTools().tools.map((tool) => tool.name)).toEqual(["reasonix.review_diff"]);
  });

  test("keeps backend-neutral alias internal until compatibility path is explicit", () => {
    expect(EXTERNAL_REVIEW_DIFF_TOOL_NAME).toBe("reasonix.review_diff");
    expect(BACKEND_NEUTRAL_REVIEW_DIFF_ALIAS).toBe("agent.review_diff");
    expect(RUNTIME_REVIEW_DIFF_OPERATION).toBe(EXTERNAL_REVIEW_DIFF_TOOL_NAME);
    expect(listTools().tools.map((tool) => tool.name)).not.toContain(BACKEND_NEUTRAL_REVIEW_DIFF_ALIAS);
  });

  test("inputSchema is inline for MCP clients", () => {
    const [tool] = listTools().tools;

    expect(tool.inputSchema).toMatchObject({
      type: "object",
      required: ["schema_version", "goal", "repo", "artifacts", "permission_level", "output_schema"],
      properties: {
        schema_version: { const: "review_diff_input_v1" },
        goal: { type: "string" },
        repo: {
          type: "object",
          required: ["root"],
        },
        artifacts: {
          type: "object",
          required: ["diff_path"],
        },
        permission_level: { const: "L1_DIFF_REVIEW" },
        output_schema: { const: "review_result_v1" },
      },
    });
    expect(JSON.stringify(tool.inputSchema)).not.toContain("coagent.local");
    expect(JSON.stringify(tool.inputSchema)).not.toContain("\"$ref\"");
  });
});

describe("tools/call reasonix.review_diff", () => {
  test("asks Rust policy gate before Reasonix invocation without runtime schema validation", async () => {
    const events: string[] = [];
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call(method, params) {
          events.push(`runtime:${method}`);
          if (method === "runtime.evaluate_operation") {
            expect(params).toMatchObject({
              task_id: "TASK-call-order",
              request_id: "REQ-call-order",
              operation: "reasonix.review_diff",
            });
            return allowDecision("TASK-call-order", "REQ-call-order");
          }
          return validSchema("TASK-call-order", "REQ-call-order");
        },
      },
      agent: {
        async runReviewDiff(_input) {
          events.push("reasonix");
          return {
            stdout: JSON.stringify(pureReviewResult()),
            stderr: "",
            exitCode: 0,
          };
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-call-order", "REQ-call-order"),
    });

    expect(result.isError).toBe(false);
    // structuredContent now has { review, metadata } wrapper
    expect(result.structuredContent?.review).toMatchObject(pureReviewResult());
    expect(result.structuredContent?.metadata?.schema_version).toBe("review_result_v1");
    expect(events).toEqual(["runtime:runtime.evaluate_operation", "reasonix", "runtime:runtime.complete_operation"]);
  });

  test("denied runtime decision prevents Reasonix invocation", async () => {
    let invoked = false;
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call() {
          return {
            ...allowDecision("TASK-deny", "REQ-deny"),
            decision: "deny",
            reasons: ["network access is denied"],
          };
        },
      },
      agent: {
        async runReviewDiff() {
          invoked = true;
          throw new Error("must not run");
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-deny", "REQ-deny"),
    });

    expect(invoked).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0].text).toContain("runtime_policy_denied");
    expect(result._meta?.code).toBe(ERROR_CODES.RUNTIME_POLICY_DENIED);
    expect(result._meta?.layer).toBe(errorLayerForCode(ERROR_CODES.RUNTIME_POLICY_DENIED));
    expect(result._meta?.side_effect).toBe("side_effect_not_executed");
  });

  test("worker unavailable returns runtime_unavailable and no side effect", async () => {
    let invoked = false;
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call() {
          throw RuntimeWorkerError.unavailable("worker unavailable");
        },
      },
      agent: {
        async runReviewDiff() {
          invoked = true;
          throw new Error("must not run");
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-unavailable", "REQ-unavailable"),
    });

    expect(invoked).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("runtime_unavailable");
    expect(result._meta?.code).toBe("runtime_unavailable");
    expect(result._meta?.layer).toBe("runtime");
    expect(result._meta?.side_effect).toBe("side_effect_not_executed");
  });

  test("worker crash returns side_effect_not_executed", async () => {
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call() {
          throw RuntimeWorkerError.unavailable("runtime worker exited with code 42");
        },
      },
      agent: {
        async runReviewDiff() {
          throw new Error("must not run");
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-crash", "REQ-crash"),
    });

    expect(result.isError).toBe(true);
    expect(result._meta?.code).toBe("runtime_unavailable");
    expect(result._meta?.layer).toBe("runtime");
    expect(result._meta?.side_effect).toBe("side_effect_not_executed");
  });

  test("valid review_result_v1 becomes structuredContent", async () => {
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call(method) {
          if (method === "runtime.evaluate_operation") {
            return allowDecision("TASK-valid", "REQ-valid");
          }
          return validSchema("TASK-valid", "REQ-valid");
        },
      },
      agent: {
        async runReviewDiff() {
          return {
            stdout: JSON.stringify(pureReviewResult()),
            stderr: "diagnostic line",
            exitCode: 0,
          };
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-valid", "REQ-valid"),
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent?.review).toEqual(pureReviewResult());
    expect(result.structuredContent?.metadata).toMatchObject({
      schema_version: "review_result_v1",
      task_id: "TASK-valid",
      request_id: "REQ-valid",
      status: "ok",
      operation: "reasonix.review_diff",
      runtime_decision: "allow",
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("diagnostic line");
    expect(result._meta?.diagnostics).toEqual({ stderr: "diagnostic line" });
    expect(result._meta?.code).toBeUndefined();
    expect(result._meta?.layer).toBeUndefined();
  });

  test("malformed output does not become structuredContent", async () => {
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call(method) {
          if (method === "runtime.evaluate_operation") {
            return allowDecision("TASK-malformed", "REQ-malformed");
          }
          return validSchema("TASK-malformed", "REQ-malformed");
        },
      },
      agent: {
        async runReviewDiff() {
          return { stdout: "not-json", stderr: "", exitCode: 0 };
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-malformed", "REQ-malformed"),
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0].text).toContain("worker_malformed_json");
    expect(result._meta?.code).toBe(ERROR_CODES.WORKER_MALFORMED_JSON);
    expect(result._meta?.layer).toBe(errorLayerForCode(ERROR_CODES.WORKER_MALFORMED_JSON));
  });

  test("uninitialized adapter does not call runtime or Reasonix", async () => {
    let touchedRuntime = false;
    let touchedReasonix = false;
    const adapter = createReasonixToolsAdapter({
      runtime: {
        async call() {
          touchedRuntime = true;
          throw new Error("must not call runtime");
        },
      },
      agent: {
        async runReviewDiff() {
          touchedReasonix = true;
          throw new Error("must not run Reasonix");
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-uninitialized", "REQ-uninitialized"),
    });

    expect(touchedRuntime).toBe(false);
    expect(touchedReasonix).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("runtime_unavailable");
    expect(result._meta?.code).toBe(ERROR_CODES.RUNTIME_UNAVAILABLE);
    expect(result._meta?.layer).toBe(errorLayerForCode(ERROR_CODES.RUNTIME_UNAVAILABLE));
  });

  test("unknown tool name returns runtime_schema_invalid", async () => {
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call() {
          throw new Error("must not call runtime");
        },
      },
      agent: {
        async runReviewDiff() {
          throw new Error("must not run Reasonix");
        },
      },
    });

    const result = await adapter.callTool({
      name: "unknown.tool",
      arguments: reviewDiffInput("TASK-unknown", "REQ-unknown"),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("runtime_schema_invalid");
    expect(result._meta?.code).toBe(ERROR_CODES.RUNTIME_SCHEMA_INVALID);
    expect(result._meta?.layer).toBe(errorLayerForCode(ERROR_CODES.RUNTIME_SCHEMA_INVALID));
  });

  test("invalid input arguments return runtime_schema_invalid", async () => {
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call() {
          throw new Error("must not call runtime");
        },
      },
      agent: {
        async runReviewDiff() {
          throw new Error("must not run Reasonix");
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: { schema_version: "wrong_version" },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("runtime_schema_invalid");
    expect(result._meta?.code).toBe(ERROR_CODES.RUNTIME_SCHEMA_INVALID);
    expect(result._meta?.layer).toBe(errorLayerForCode(ERROR_CODES.RUNTIME_SCHEMA_INVALID));
    expect(result._meta?.side_effect).toBe("side_effect_not_executed");
  });

  test("fatal_error runtime decision returns runtime_unavailable", async () => {
    let invoked = false;
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call() {
          return {
            ...allowDecision("TASK-fatal", "REQ-fatal"),
            decision: "fatal_error",
            reasons: ["runtime storage error"],
          };
        },
      },
      agent: {
        async runReviewDiff() {
          invoked = true;
          throw new Error("must not run");
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-fatal", "REQ-fatal"),
    });

    expect(invoked).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("runtime_unavailable");
    expect(result._meta?.code).toBe(ERROR_CODES.RUNTIME_UNAVAILABLE);
    expect(result._meta?.layer).toBe(errorLayerForCode(ERROR_CODES.RUNTIME_UNAVAILABLE));
    expect(result._meta?.side_effect).toBe("side_effect_not_executed");
  });

  test("worker timeout returns worker_timeout", async () => {
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call(method) {
          if (method === "runtime.evaluate_operation") {
            return allowDecision("TASK-timeout", "REQ-timeout");
          }
          return validSchema("TASK-timeout", "REQ-timeout");
        },
      },
      agent: {
        async runReviewDiff() {
          return { stdout: "", stderr: "killed", exitCode: -1, timedOut: true };
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-timeout", "REQ-timeout"),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("worker_timeout");
    expect(result._meta?.code).toBe(ERROR_CODES.WORKER_TIMEOUT);
    expect(result._meta?.layer).toBe(errorLayerForCode(ERROR_CODES.WORKER_TIMEOUT));
    expect(result._meta?.diagnostics).toEqual({ stderr: "killed" });
  });

  test("worker nonzero exit returns worker_nonzero_exit", async () => {
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call(method) {
          if (method === "runtime.evaluate_operation") {
            return allowDecision("TASK-exit", "REQ-exit");
          }
          return validSchema("TASK-exit", "REQ-exit");
        },
      },
      agent: {
        async runReviewDiff() {
          return { stdout: "", stderr: "crash", exitCode: 7 };
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-exit", "REQ-exit"),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("worker_nonzero_exit");
    expect(result.content[0].text).toContain("exited with 7");
    expect(result._meta?.code).toBe(ERROR_CODES.WORKER_NONZERO_EXIT);
    expect(result._meta?.layer).toBe(errorLayerForCode(ERROR_CODES.WORKER_NONZERO_EXIT));
  });

  test("empty stdout returns worker_empty_stdout", async () => {
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call(method) {
          if (method === "runtime.evaluate_operation") {
            return allowDecision("TASK-empty", "REQ-empty");
          }
          return validSchema("TASK-empty", "REQ-empty");
        },
      },
      agent: {
        async runReviewDiff() {
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-empty", "REQ-empty"),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("worker_empty_stdout");
    expect(result._meta?.code).toBe(ERROR_CODES.WORKER_EMPTY_STDOUT);
    expect(result._meta?.layer).toBe(errorLayerForCode(ERROR_CODES.WORKER_EMPTY_STDOUT));
  });

  // identity mismatch is no longer a separate error path — Coagent owns identity,
  // so mismatched task_id/request_id from Reasonix is irrelevant.
  // The adapter now validates only the pure review fields.
  test("identity fields from backend are ignored (no identity mismatch check)", async () => {
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call(method) {
          if (method === "runtime.evaluate_operation") {
            return allowDecision("TASK-id", "REQ-id");
          }
          return validSchema("TASK-id", "REQ-id");
        },
      },
      agent: {
        async runReviewDiff() {
          return {
            stdout: JSON.stringify({ ...pureReviewResult(), verdict: "needs_fix", summary: "Fix needed." }),
            stderr: "",
            exitCode: 0,
          };
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-id", "REQ-id"),
    });

    // Should succeed even if backend returns no identity fields.
    // Coagent wraps with its own task_id/request_id.
    expect(result.isError).toBe(false);
    expect(result.structuredContent?.review?.verdict).toBe("needs_fix");
    expect(result.structuredContent?.metadata?.task_id).toBe("TASK-id");
    expect(result.structuredContent?.metadata?.request_id).toBe("REQ-id");
  });

  test("schema validation failure returns worker_schema_invalid", async () => {
    const adapter = createReasonixToolsAdapter({
      initialized: true,
      runtime: {
        async call(method) {
          if (method === "runtime.evaluate_operation") {
            return allowDecision("TASK-schema", "REQ-schema");
          }
          throw new Error("runtime schema validation must not be called");
        },
      },
      agent: {
        async runReviewDiff() {
          return {
            stdout: JSON.stringify({
              ...pureReviewResult(),
              confidence: 2,
            }),
            stderr: "",
            exitCode: 0,
          };
        },
      },
    });

    const result = await adapter.callTool({
      name: "reasonix.review_diff",
      arguments: reviewDiffInput("TASK-schema", "REQ-schema"),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("worker_schema_invalid");
    expect(result._meta?.code).toBe(ERROR_CODES.WORKER_SCHEMA_INVALID);
    expect(result._meta?.layer).toBe(errorLayerForCode(ERROR_CODES.WORKER_SCHEMA_INVALID));
    expect(result._meta?.diagnostics?.schema_errors?.[0].path).toBe("/confidence");
  });
});

function reviewDiffInput(taskId: string, requestId: string) {
  return {
    schema_version: "review_diff_input_v1",
    task_id: taskId,
    request_id: requestId,
    mode: "review_diff",
    goal: "Review the current diff.",
    repo: { root: "D:/repo" },
    artifacts: { diff_path: ".agent/diffs/current.diff" },
    permission_level: "L1_DIFF_REVIEW",
    output_schema: "review_result_v1",
  };
}

function allowDecision(taskId: string, requestId: string) {
  return {
    schema_version: "runtime_decision_v1",
    task_id: taskId,
    request_id: requestId,
    operation: "reasonix.review_diff",
    decision: "allow",
    engine_results: { state: "allow", policy: "allow" },
    reasons: [],
  };
}

function validSchema(taskId: string, requestId: string) {
  return {
    schema_version: "schema_validation_result_v1",
    task_id: taskId,
    request_id: requestId,
    expected_schema: "review_result_v1",
    valid: true,
    errors: [],
  };
}

// Pure review result — no system envelope fields.
// Reasonix returns only semantic review data.
function pureReviewResult() {
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

// Legacy helper kept for reference — no longer used in new tests.
function reviewResult(taskId: string, requestId: string) {
  return {
    schema_version: "review_result_v1",
    task_id: taskId,
    request_id: requestId,
    status: "ok",
    verdict: "pass",
    summary: "No findings.",
    findings: [],
    tests_to_run: [],
    risks: [],
    assumptions: [],
    confidence: 0.9,
  };
}

