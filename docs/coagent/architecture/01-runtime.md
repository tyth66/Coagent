# Runtime: State, Policy, Audit

The Rust RuntimeKernel runs in-process inside the MCP server binary.
No JSON-RPC subprocess.

## State Machine

```
Created ────→ Running ────→ Completed
    │             │              │
    │             └──→ Failed ←──┘
    │
    └──→ Cancelled
```

Terminal states (Completed, Failed, Cancelled) reject all subsequent
`evaluate_operation` calls.

## Policy Engine

Registered operations: `reasonix.review_diff` → `L1_DIFF_REVIEW`

Permission levels:
- L0_READONLY — read-only observation
- L1_DIFF_REVIEW — read diffs + context, write results
- L2_PATCH_ONLY — generate patches (not implemented)
- L3_ISOLATED_WORKTREE — full worktree access (not implemented)

Artifact policy: path allowlist/denylist with glob matching, `..` traversal
rejection, symlink escape detection, case-insensitive on Windows.

## Audit (SQLite)

10 tables in `.agent/coagent.sqlite`:
- `tasks`, `task_state` — task lifecycle
- `audit_events` — append-only event log (UPDATE/DELETE triggers reject mutations)
- `runtime_decisions` — each evaluate_operation result
- `schema_validation_results` — schema check outcomes
- `policy_evaluation_results` — policy check outcomes
- `locks`, `artifacts`, `cache_entries`, `runtime_metadata`

WAL mode, FULL synchronous, 5s busy timeout.

## Lifecycle API

```rust
// Permission gate (called before every backend invocation)
kernel.evaluate_operation(request) -> RuntimeDecision { allow | deny | ... }

// Lifecycle closure (called after backend invocation)
kernel.complete_operation(task_id, request_id, operation) -> Completed
kernel.fail_operation(task_id, request_id, operation, error_code, message) -> Failed
```
