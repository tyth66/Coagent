# Review Diff Agent Collaboration Plan

> **Status**: Tasks 1-4 (doc freeze, role model, runtime gate, old roadmap collapse)
> are complete as of 2026-07-05. Task 2 (pure review result contract refactoring
> in code) is the next implementation target. The full gap analysis is in
> [gaps-to-production.md](gaps-to-production.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `reasonix.review_diff` a clean agent-to-agent delegation where Codex assigns a diff review task, Coasonix handles safe protocol/runtime boundaries, Reasonix returns only review information, and Codex keeps final decision authority.

**Architecture:** Codex calls one MCP tool. Coasonix validates the call, asks Rust Runtime for allow/deny, delegates a pure review task to Reasonix, then wraps Reasonix's review-only payload into MCP `structuredContent`. Runtime, backend, audit, and protocol metadata stay internal to Coasonix.

**Tech Stack:** Codex MCP, Bun/TypeScript MCP adapter, Rust Runtime Worker over JSON-RPC stdio, JSON contract fixture for tests, repo-local SQLite audit.

---

## Requirements Summary

```text
Codex 负责分配任务
Coasonix 负责安全调用和协议转换
Reasonix 负责完成智能体任务
Codex 负责最终决策
```

For `reasonix.review_diff`, Reasonix must return review information only. It must
not return Coasonix runtime state, schema validation payloads, worker diagnostics,
backend profile data, or MCP protocol details.

## Target `review_diff` Contract

### Codex-facing MCP tool

Tool name remains:

```text
reasonix.review_diff
```

MCP arguments remain Coasonix-owned and may include routing/artifact fields such
as repo root and diff path. These fields are not Reasonix's final answer.

### Reasonix task input

Coasonix should translate MCP arguments into a Reasonix task payload containing:

```text
goal
repo summary or root identifier
diff content or diff artifact reference
optional context artifacts
optional focus areas
optional constraints
budget hints
```

### Reasonix task output

Reasonix should output only:

```text
verdict
summary
findings[]
tests_to_run[]
risks[]
assumptions[]
confidence
```

No Reasonix output field should be required purely for Coasonix routing.

## Current Gap

The current implementation is operational but still transitional:

```text
- MCP registration/setup/healthcheck exists.
- Rust runtime gate exists before Reasonix invocation.
- Mock review_diff vertical slice exists.
- The current review_result_v1 contract still contains system envelope fields
  such as schema_version, task_id, request_id, and status.
```

The next implementation pass should remove those system envelope fields from the
Reasonix result contract and keep them inside Coasonix wrapper metadata.

## Implementation Tasks

### Task 1: Freeze the role model in docs

**Files:**
- `D:\Coasonix\README.md`
- `D:\Coasonix\docs\coasonix\00-collaboration-model.md`
- `D:\Coasonix\docs\coasonix\00-executive-summary.md`
- `D:\Coasonix\docs\coasonix\README.md`

- [ ] Make `00-collaboration-model.md` the first conceptual document.
- [ ] State the four roles exactly: Codex assigns, Coasonix gates/translates, Reasonix performs, Codex decides.
- [ ] Remove wording that describes Reasonix as merely a CLI worker from current-status docs.
- [ ] Keep backend/stdio details in implementation docs only.

### Task 2: Redefine `review_diff` as a pure review result

**Files:**
- `D:\Coasonix\docs\coasonix\03-reasonix\01-tool-contracts-and-wrapper.md`
- `D:\Coasonix\schemas\coasonix-v1.schema.json`
- `D:\Coasonix\packages\reasonix-expert-mcp\src\mcp\tools.ts`
- `D:\Coasonix\packages\reasonix-expert-mcp\src\mcp\tools.test.ts`
- `D:\Coasonix\packages\reasonix-expert-mcp\src\reasonix\vertical-slice.test.ts`

- [ ] Change the Reasonix result contract to `verdict`, `summary`, `findings`, `tests_to_run`, `risks`, `assumptions`, `confidence`.
- [ ] Keep `task_id`, `request_id`, `schema_version`, backend exit code, and audit ids internal to Coasonix.
- [ ] Update mock Reasonix to emit the pure review result.
- [ ] Update adapter wrapping so MCP `structuredContent` contains the pure review result plus only Codex-useful review fields.
- [ ] Preserve internal identity checking by tracking request identity outside Reasonix's result payload.

### Task 3: Keep Runtime as a pre-delegation gate only

**Files:**
- `D:\Coasonix\docs\coasonix\02-runtime\02-runtime-enforcement-layer.md`
- `D:\Coasonix\docs\coasonix\02-runtime\04-schema-enforcement.md`
- `D:\Coasonix\crates\coasonix-runtime-core\src\kernel\mod.rs`
- `D:\Coasonix\crates\coasonix-runtime-worker\src\main.rs`

- [ ] Document Rust Runtime as pre-Reasonix allow/deny, not as Reasonix result owner.
- [ ] Keep path, argv, state, network, and audit checks in Rust.
- [ ] Do not reintroduce `runtime.validate_schema` into the live call path.
- [ ] Ensure result-shape checks remain adapter-side until a future need proves otherwise.

### Task 4: Collapse old gateway/backend roadmap into review_diff plan

**Files:**
- `D:\Coasonix\docs\implementation\v1-mvp-execution-plan.md`
- `D:\Coasonix\docs\implementation\codex-side-gateway-roadmap.md`
- `D:\Coasonix\docs\implementation\review-diff-agent-collaboration-plan.md`

- [ ] Treat `review-diff-agent-collaboration-plan.md` as the active forward plan.
- [ ] Mark `codex-side-gateway-roadmap.md` as merged historical implementation evidence.
- [ ] Keep setup/healthcheck/conformance facts, but do not let backend profiles define the product model.
- [ ] State that real backend bridges are only acceptable if they preserve the pure review-result boundary.

## Acceptance Criteria

```text
1. Docs state the Codex / Coasonix / Reasonix / Codex decision chain plainly.
2. Current-status docs do not imply Reasonix should return runtime, protocol, or worker metadata.
3. `review_diff` docs define a pure review result.
4. Implementation docs distinguish current transitional code from the target contract.
5. Old gateway roadmap is no longer the primary plan.
6. No docs reintroduce `runtime.validate_schema` as the live architecture path.
7. Verification commands pass after doc updates.
```

## Verification Steps

Run:

```powershell
rg -n "<old Reasonix-output-envelope patterns>" README.md docs/coasonix docs/implementation
python -m json.tool schemas/coasonix-v1.schema.json > $null
cargo test --workspace
bun test
cargo fmt --all -- --check
git diff --check
```

The search may still find explicit historical notes only if they are marked as
historical or superseded. Current architecture docs should not describe those as
the active model.



