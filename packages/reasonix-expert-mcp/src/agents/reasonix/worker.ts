/**
 * Real Reasonix agent worker.
 *
 * Contract (stdin/stdout protocol):
 *   stdin  ← ReviewDiffInput JSON
 *   stdout → review_result_v1 JSON
 *   stderr → diagnostics only (never trusted as review content)
 *
 * Usage:
 *   bun run agents/reasonix/worker.ts review-diff
 *
 * The worker:
 *   1. Reads the diff file referenced in artifacts.diff_path
 *   2. Reads optional context/test_log/build_log artifacts
 *   3. Constructs a review prompt and submits to LLM
 *   4. Parses and validates the structured review output
 *   5. Writes review_result_v1 JSON to stdout
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { stdin, stdout, stderr } from "node:process";

// ── Subcommand dispatch ──

const subcommand = process.argv.at(-1);
if (subcommand !== "review-diff") {
  stderr.write(`agent worker: unknown subcommand "${subcommand}" (supported: review-diff)\n`);
  process.exit(2);
}

// ── Input parsing ──

interface ReviewDiffInput {
  goal: string;
  repo: { root: string; base_branch?: string; working_branch?: string };
  artifacts: {
    diff_path: string;
    context_path?: string;
    test_log_path?: string;
    build_log_path?: string;
  };
  focus?: string[];
  constraints?: string[];
  task_id?: string;
  request_id?: string;
}

let input: ReviewDiffInput;
try {
  const raw = await new Response(stdin).text();
  input = JSON.parse(raw);
} catch (err) {
  stderr.write(`agent worker: invalid input JSON: ${String(err)}\n`);
  process.exit(2);
}

// ── Artifact reading ──

const repoRoot = resolve(input.repo.root);

function readArtifact(relativePath: string | undefined): string | null {
  if (!relativePath) return null;
  const fullPath = resolve(repoRoot, relativePath);
  if (!existsSync(fullPath)) {
    stderr.write(`agent worker: artifact not found: ${fullPath}\n`);
    return null;
  }
  return readFileSync(fullPath, "utf-8");
}

const diffContent = readArtifact(input.artifacts.diff_path);
if (!diffContent) {
  stderr.write("agent worker: required artifact diff_path not found or empty\n");
  process.exit(2);
}

const contextContent = readArtifact(input.artifacts.context_path);
const testLogContent = readArtifact(input.artifacts.test_log_path);
const buildLogContent = readArtifact(input.artifacts.build_log_path);

// ── Prompt construction ──

const focusHints = input.focus?.length
  ? `\nFocus areas: ${input.focus.join(", ")}`
  : "";
const constraints = input.constraints?.length
  ? `\nConstraints: ${input.constraints.join(", ")}`
  : "";

const contextSection = contextContent
  ? `\n\nAdditional context:\n${contextContent.slice(0, 4000)}`
  : "";
const testLogSection = testLogContent
  ? `\n\nTest log summary:\n${testLogContent.slice(0, 2000)}`
  : "";
const buildLogSection = buildLogContent
  ? `\n\nBuild log summary:\n${buildLogContent.slice(0, 2000)}`
  : "";

const reviewPrompt = [
  `You are a code review agent. Review the following diff for correctness,`,
  `regression risk, missing tests, security issues, and protocol or safety concerns.`,
  ``,
  `Goal: ${input.goal}`,
  `${focusHints}${constraints}`,
  ``,
  `--- DIFF ---`,
  diffContent.slice(0, 16000),
  `--- END DIFF ---`,
  contextSection,
  testLogSection,
  buildLogSection,
  ``,
  `Return ONLY a JSON object with this shape (no markdown, no explanation):`,
  `{`,
  `  "schema_version": "review_result_v1",`,
  `  "task_id": "${input.task_id ?? "TASK-unknown"}",`,
  `  "request_id": "${input.request_id ?? "REQ-unknown"}",`,
  `  "status": "ok",`,
  `  "verdict": "pass" | "needs_fix" | "risky" | "unknown" | "not_applicable",`,
  `  "summary": "Short review conclusion.",`,
  `  "findings": [`,
  `    {`,
  `      "id": "F-001",`,
  `      "severity": "blocker" | "major" | "minor" | "note",`,
  `      "category": "correctness" | "test" | "security" | "protocol" | "maintainability" | "other",`,
  `      "file": "relative/path.ext",`,
  `      "line": 42,`,
  `      "issue": "What is wrong or risky.",`,
  `      "evidence": "Why this follows from the diff.",`,
  `      "recommendation": "What should change.",`,
  `      "confidence": 0.85`,
  `    }`,
  `  ],`,
  `  "tests_to_run": [],`,
  `  "risks": [],`,
  `  "assumptions": [],`,
  `  "confidence": 0.85`,
  `}`,
].join("\n");

// ── LLM invocation ──

const llmEndpoint = process.env.COAGENT_LLM_ENDPOINT ?? process.env.OPENAI_BASE_URL;
const llmApiKey = process.env.COAGENT_LLM_API_KEY ?? process.env.OPENAI_API_KEY;
const llmModel = process.env.COAGENT_LLM_MODEL ?? "gpt-4o-mini";

if (!llmEndpoint && !llmApiKey) {
  // No LLM configured — fall back to basic static analysis
  const lines = diffContent.split("\n");
  const addedLines = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removedLines = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  const testFiles = lines.some((l) => l.includes(".test.") || l.includes("_test.") || l.includes("spec."));

  const findings: Array<Record<string, unknown>> = [];
  if (!testFiles && (addedLines > 20 || removedLines > 20)) {
    findings.push({
      id: "F-001",
      severity: "minor",
      category: "test",
      file: input.artifacts.diff_path,
      line: 1,
      issue: "No test files appear to be modified in this diff.",
      evidence: "Diff contains code changes but no test file modifications were detected.",
      recommendation: "Consider adding or updating tests for the changed behavior.",
      confidence: 0.5,
    });
  }

  stdout.write(JSON.stringify({
    schema_version: "review_result_v1",
    task_id: input.task_id ?? "TASK-unknown",
    request_id: input.request_id ?? "REQ-unknown",
    status: "ok",
    verdict: findings.length > 0 ? "needs_fix" : "pass",
    summary: findings.length > 0
      ? `Static analysis found ${findings.length} issue(s). No LLM configured; install COAGENT_LLM_API_KEY for AI-powered review.`
      : `Static analysis passed. No LLM configured; install COAGENT_LLM_API_KEY for AI-powered review.`,
    findings,
    tests_to_run: [],
    risks: [],
    assumptions: ["No LLM configured; review is based on static heuristics only."],
    confidence: 0.3,
  }));
  process.exit(0);
}

// ── LLM call ──

try {
  const response = await fetch(`${llmEndpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${llmApiKey}`,
    },
    body: JSON.stringify({
      model: llmModel,
      messages: [{ role: "user", content: reviewPrompt }],
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    stderr.write(`agent worker: LLM API error ${response.status}: ${await response.text()}\n`);
    process.exit(2);
  }

  const data = await response.json() as Record<string, unknown>;
  const content = (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
  if (!content) {
    stderr.write("agent worker: LLM returned empty response\n");
    process.exit(2);
  }

  // ── Output parsing ──

  // Try to extract JSON from the response (handles markdown fences)
  let jsonStr = content;
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  let result: Record<string, unknown>;
  try {
    result = JSON.parse(jsonStr);
  } catch {
    stderr.write(`agent worker: LLM output is not valid JSON: ${jsonStr.slice(0, 500)}\n`);
    process.exit(2);
  }

  // Ensure required fields
  result.schema_version = "review_result_v1";
  result.task_id = result.task_id ?? input.task_id ?? "TASK-unknown";
  result.request_id = result.request_id ?? input.request_id ?? "REQ-unknown";
  result.status = result.status ?? "ok";

  stdout.write(JSON.stringify(result));
} catch (err) {
  stderr.write(`agent worker: LLM call failed: ${String(err)}\n`);
  process.exit(2);
}
