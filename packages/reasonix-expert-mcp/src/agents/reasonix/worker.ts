/**
 * Reasonix agent worker — bridges Coagent to Reasonix CLI.
 *
 * Uses `reasonix run --task ...` for one-shot non-interactive execution.
 * Falls back to built-in worker if Reasonix is not installed.
 *
 * Contract (stdin/stdout protocol):
 *   stdin  ← ReviewDiffInput JSON
 *   stdout → review_result_v1 JSON
 *   stderr → diagnostics only
 *
 * Usage:
 *   bun run agents/reasonix/worker.ts review-diff
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { stdin, stdout, stderr } from "node:process";
import { spawn } from "node:child_process";

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

// ── Task construction ──

const focusHints = input.focus?.length ? `\n重点关注: ${input.focus.join(", ")}` : "";
const constraints = input.constraints?.length ? `\n约束条件: ${input.constraints.join(", ")}` : "";
const contextSection = contextContent ? `\n\n额外上下文:\n${contextContent.slice(0, 4000)}` : "";
const testLogSection = testLogContent ? `\n\n测试日志:\n${testLogContent.slice(0, 2000)}` : "";

const task = [
  `审查以下代码 diff，评估正确性、回归风险、测试覆盖、安全性和可维护性。`,
  ``,
  `审查目标: ${input.goal}${focusHints}${constraints}`,
  ``,
  `--- DIFF ---`,
  diffContent.slice(0, 16000),
  `--- END DIFF ---`,
  contextSection,
  testLogSection,
  ``,
  `请只返回一个 JSON 对象，格式如下（不要用 markdown 代码块包裹，只输出纯 JSON）:`,
  `{`,
  `  "schema_version": "review_result_v1",`,
  `  "task_id": "${input.task_id ?? "TASK-unknown"}",`,
  `  "request_id": "${input.request_id ?? "REQ-unknown"}",`,
  `  "status": "ok",`,
  `  "verdict": "pass" | "needs_fix" | "risky" | "unknown" | "not_applicable",`,
  `  "summary": "审查结论的简短总结",`,
  `  "findings": [`,
  `    {`,
  `      "id": "F-001",`,
  `      "severity": "blocker" | "major" | "minor" | "note",`,
  `      "category": "correctness" | "test" | "security" | "protocol" | "maintainability" | "other",`,
  `      "file": "relative/path.ext",`,
  `      "line": 42,`,
  `      "issue": "问题描述",`,
  `      "evidence": "从 diff 中找到的证据",`,
  `      "recommendation": "建议的修改",`,
  `      "confidence": 0.85`,
  `    }`,
  `  ],`,
  `  "tests_to_run": [],`,
  `  "risks": [],`,
  `  "assumptions": [],`,
  `  "confidence": 0.85`,
  `}`,
].join("\n");

// ── System prompt ──

const system = [
  "你是一个代码审查专家 Agent。你的任务是审查代码 diff，找出问题并给出建议。",
  "你必须只返回 JSON 格式的审查结果。不要输出任何其他内容。",
  "如果 diff 中没有问题，verdict 设为 pass，findings 为空数组。",
  "如果发现问题，给出具体的文件路径、行号和代码证据。",
].join(" ");

// ── Reasonix invocation ──

const model = process.env.COAGENT_REASONIX_MODEL ?? process.env.REASONIX_MODEL ?? "deepseek-chat";
const reasonixBin = process.env.COAGENT_REASONIX_BIN ?? "reasonix";

const args = [
  "run",
  "--task", task,
  "--system", system,
  "--model", model,
];

// Optional: pass MCP config if user has filesystem tools configured
const mcpOpts = process.env.COAGENT_REASONIX_MCP;
if (mcpOpts) {
  args.push("--mcp", mcpOpts);
}

stderr.write(`agent worker: spawning ${reasonixBin} ${args.slice(0, 4).join(" ")} ...\n`);

const child = spawn(reasonixBin, args, {
  stdio: ["ignore", "pipe", "pipe"],
  cwd: repoRoot,
  env: { ...process.env },
});

let stdoutBuf = "";
let stderrBuf = "";

child.stdout.on("data", (chunk: Buffer) => { stdoutBuf += chunk.toString(); });
child.stderr.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString(); });

const exitCode = await new Promise<number | null>((resolve) => {
  child.on("close", resolve);
  child.on("error", (err) => {
    stderr.write(`agent worker: failed to spawn reasonix: ${err.message}\n`);
    resolve(-1);
  });
});

if (exitCode !== 0) {
  stderr.write(`agent worker: reasonix exited with code ${exitCode}\n`);
  stderr.write(`stderr: ${stderrBuf.slice(0, 1000)}\n`);
  process.exit(2);
}

// ── Output parsing ──

// Try to extract JSON from the output (Reasonix streams output inline)
// The final content should contain a JSON object matching review_result_v1
stderr.write(`agent worker: reasonix stdout length: ${stdoutBuf.length}\n`);
stderr.write(stderrBuf.slice(0, 500));

const output = stdoutBuf.trim();

// Find the last JSON object in the output
let jsonStr = "";
const jsonMatch = output.match(/\{[\s\S]*"schema_version"\s*:\s*"review_result_v1"[\s\S]*\}/);
if (jsonMatch) {
  jsonStr = jsonMatch[0];
} else {
  // Try to find any JSON object at the end
  const lastBrace = output.lastIndexOf("{");
  const matchingBrace = output.indexOf("}", lastBrace);
  if (lastBrace >= 0 && matchingBrace > lastBrace) {
    jsonStr = output.slice(lastBrace, matchingBrace + 1);
  }
}

if (!jsonStr) {
  stderr.write("agent worker: could not extract JSON from Reasonix output\n");
  stderr.write(`stdout preview: ${output.slice(0, 1000)}\n`);
  process.exit(2);
}

let result: Record<string, unknown>;
try {
  result = JSON.parse(jsonStr);
} catch {
  stderr.write(`agent worker: Reasonix output is not valid JSON: ${jsonStr.slice(0, 500)}\n`);
  process.exit(2);
}

// Ensure required fields
result.schema_version = "review_result_v1";
result.task_id = result.task_id ?? input.task_id ?? "TASK-unknown";
result.request_id = result.request_id ?? input.request_id ?? "REQ-unknown";
result.status = result.status ?? "ok";

stdout.write(JSON.stringify(result));
