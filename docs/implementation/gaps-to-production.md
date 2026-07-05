# Roadmap: from MVP to real agent-to-agent delegation

This document records what stands between the current v1 MVP and a fully
operational system where Codex delegates tasks and Reasonix executes them.

Last updated: 2026-07-05. Covers status as of the post-refactor tool-handler
architecture.

---

## What is Done

```text
MCP server stdio lifecycle              implemented
reasonix.review_diff tool registration  implemented
Rust pre-Reasonix runtime gate          implemented
  - State engine (Created->Running->Completed/Failed)
  - Policy engine (operation, permission, path, argv, network)
  - SQLite append-only audit
  - JSON Schema validation + duplicate-key detection
Pluggable tool handler architecture     implemented (strategy pattern)
Multi-operation PolicyEngine registry   implemented
mock Reasonix vertical slice            implemented (621-byte echo worker)
healthcheck / conformance / error taxonomy  implemented
docs: implementation status annotated        implemented
```

---

## Gap 1: Reasonix Does Not Exist (P0)

**Current state**: `reasonix/runner.ts` spawns a process named `reasonix`,
but the actual binary is a 621-byte `mock-worker.ts` that echos a hardcoded
`review_result_v1` JSON. It does not read diffs, analyze code, or produce
real findings.

**What is needed**:
- A real Reasonix CLI or HTTP service that accepts a review task as JSON
  on stdin, reads the referenced diff file, performs actual code review,
  and returns structured findings on stdout.
- Or a bridge adapter (e.g., MimoCode, or any external review agent) that
  translates the Coagent task format into the backend agent format.

**Impact**: This is not a Coagent code problem — it is a product/external
dependency. Coagent provides the protocol, runtime gate, and audit. Reasonix
must exist on the other side.

---

## Gap 2: review_diff Result Contract Is Transitional (P1)

**Current state**: `review_result_v1` still carries system-envelope fields
(`schema_version`, `task_id`, `request_id`, `status`) that belong in
Coagent wrapper metadata, not in the Reasonix review answer.

The `adapter.ts` / `review-diff.ts` handler currently validates identity by
checking `parsed.value.task_id === input.value.task_id`. If Reasonix stops
returning `task_id`, this check must move to Coagent internal wrapper
metadata.

**Active plan**: `docs/implementation/review-diff-agent-collaboration-plan.md`

**What to change**:
- Remove `schema_version`, `task_id`, `request_id`, `status` from the
  Reasonix output contract (in `schemas/coagent-v1.schema.json` and
  `review-diff.ts` `validateOutput()`)
- Track request identity outside Reasonix result payload (in adapter
  wrapper metadata)
- Update mock Reasonix to emit the pure review shape
- Update tests to verify the new contract

---

## Gap 3: Diff Content Delivery Is Incomplete (P1)

**Current state**: `ReasonixProcessRunner.runReviewDiff()` writes the entire
`ReviewDiffInput` JSON to Reasonix stdin. The input contains file *paths*
(e.g., `artifacts.diff_path: ".agent/diffs/current.diff"`) but not the actual
diff *content*. Reasonix must read the files itself.

**Problem**: This means:
- Reasonix needs filesystem access beyond what Coagent controls at runtime
  (the Rust PolicyEngine checks paths at MCP-call time, but cannot enforce
  what Reasonix does inside its own process)
- The task input is not self-contained — you cannot replay a review from the
  audit log alone

**What to change**:
- Coagent reads artifact files and embeds their content (or a content hash
  reference) into the Reasonix task input JSON before spawning the process
- Or: implement a Reasonix process sandbox that restricts filesystem access
  to the PolicyEngine-approved paths (see Gap 5)

---

## Gap 4: No Iteration/Feedback Loop (P2)

**Current state**: One call, one response. Codex calls `reasonix.review_diff`,
gets back a verdict. There is no mechanism for:

```
Codex fixes issues -> asks Reasonix to re-review -> Reasonix sees updated diff
```

**What is needed**:
- Context Projection (design spec in `docs/coagent/01-architecture/03-context-architecture.md`,
  zero implementation): on each iteration, project only the relevant delta
  of context to Reasonix, not the full git history
- Snapshot management (design spec in `01-architecture/04-project-session-tool-mapping.md`,
  zero implementation): freeze an immutable snapshot of artifacts at call
  time, detect snapshot mismatches on re-review
- Task state checkpoint expansion: current state machine is
  `Created -> Running -> Completed/Failed`. Needs intermediate states:
  `waiting_for_reasonix` -> `codex_reviewing_result` -> `re-reviewing`

---

## Gap 5: No Reasonix Process Sandbox (P2)

**Current state**: The Rust PolicyEngine checks paths, argv, and network
*before* spawning Reasonix, but once Reasonix is running, it can:

- Read files outside the PolicyEngine-approved paths
- Open network connections (if the OS allows)
- Run subprocesses

The policy enforcement is at the gate, not at the runtime.

**What to change**:
- OS-level sandbox for the Reasonix child process (filesystem restrictions,
  network disable, seccomp/AppContainer on Windows)
- Or: move Reasonix into a container/VM boundary
- At minimum: the diff content embedding from Gap 3 eliminates the need
  for Reasonix to read arbitrary files

---

## Gap 6: Only One Tool (P2)

**Current state**: Only `reasonix.review_diff` exists. Six post-v1 tools
are documented as design specs:

```
reasonix.security_audit
reasonix.debug_hypothesis
reasonix.architecture_options
reasonix.performance_review
reasonix.propose_patch
reasonix.test_plan
```

**What to add** (in recommended order, to validate the tool-handler architecture):
1. `reasonix.test_plan` — validates that a second tool handler can be added
   without changing the adapter router
2. `reasonix.security_audit` — validates security-focused output schemas
3. Others as needed

Each new tool requires:
- Input/output schema definition
- `tools/<name>.ts` handler implementing `ToolHandler`
- One-line registration in `adapter.ts` toolRegistry
- PolicyEngine operation registration in Rust kernel `initialize()`
- Reasonix-side capability implementation

---

## Gap 7: Post-v1 Design Specs Not Implemented

All documented as design specs with status headers. None have code:

```text
Context Projector               docs/coagent/01-architecture/03-context-architecture.md
Session/Project routing         docs/coagent/01-architecture/04-project-session-tool-mapping.md
Cache engineering               docs/coagent/03-reasonix/03-cache-engineering-model.md
Patch safety checker            docs/coagent/04-patch-and-verification/
Verification gate               docs/coagent/04-patch-and-verification/
Human approval gate             docs/coagent/04-patch-and-verification/
Observability (metrics/tracing) docs/coagent/02-runtime/05-observability-contract.md
Concurrency/fan-out             docs/coagent/03-reasonix/02-reasonix-concurrency-model.md
Schema versioning               docs/coagent/05-versioning/
```

---

## Priority Order

```
P0: Build or bridge a real Reasonix
    └── external dependency, Coagent is ready on the protocol side

P1: Clean up the review_diff result contract
    ├── remove envelope fields from Reasonix output
    └── embed diff content in task input (not just file paths)

P2: Reasonix sandbox + Context Projection (minimum viable)
    ├── process-level filesystem/network restrictions
    └── basic context snapshot + projection

P3: Second tool (test_plan) + task state expansion
    ├── validates tool handler architecture
    └── supports iteration states

P4: Remaining post-v1 tools and design specs
```

---

## Verification Baseline

```powershell
cargo test --workspace          # 65 Rust tests
bun test                        # 91 TypeScript tests
python -m json.tool schemas/coagent-v1.schema.json > $null
cargo fmt --all -- --check
git diff --check
```


