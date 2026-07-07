# Runtime: State, Policy, Audit (v2.1)

The Rust RuntimeKernel runs in-process inside the MCP server binary.
No JSON-RPC subprocess.

## State Machine

### TaskState (10-state FSM, long-lived)

```
                ┌──────────────────────────┐
                │         Queued           │ ← entry point
                └────────────┬─────────────┘
                             │
    ┌────────────────────────┼────────────────────────┐
    │                        ▼                        │
    │              ┌─────────────────┐                │
    │              │    Running      │◄───────────┐   │
    │              └───────┬─────────┘            │   │
    │                      │                      │   │
    │         ┌────────────┼────────────┐         │   │
    │         ▼            ▼            ▼         │   │
    │   ┌──────────┐ ┌──────────────┐ ┌────────┐ │   │
    │   │ Blocked  │ │WaitingApproval│ │Retrying│─┼───┘
    │   └────┬─────┘ └──────┬───────┘ └────────┘ │
    │        │              │                     │
    │        │ (unblock)    │ (approved/rejected) │
    │        ▼              ▼                     │
    │   Running ◄── Running | Failed              │
    │                                             │
    │   ┌──────────────────────┐                  │
    │   │ PartiallyCompleted   │                  │
    │   └──────────┬───────────┘                  │
    │              │ (all subtasks done)          │
    │              ▼                              │
    │   ┌──────────────────┐                     │
    └──►│    Completed      │ (terminal)          │
        └──────────────────┘                     │
                                                 │
        ┌─────────────────┐                      │
        │     Failed      │ (terminal) ◄─────────┘
        └─────────────────┘
        ┌─────────────────┐
        │    Cancelled    │ (terminal) ◄── any alive state
        └─────────────────┘
```

### Operation-Level Steps (per tool call)

Each `evaluate_operation()` creates a `runtime_steps` row. A single task can
have multiple operations. `complete_operation()` closes the step; `complete_task()`
transitions the task itself to terminal. This two-layer model enables:

```
TASK-1:
  reasonix.review_architecture  → operation completed
  reasonix.review_diff          → operation completed
  reasonix.verify_tests         → operation completed
  complete_task()               → task Completed
```

Cancelled is the only task-level state that blocks new operations.

### Subtask Dependencies

```rust
state.add_subtask("SUB-1", TaskStateValue::Completed);
state.add_subtask("SUB-2", TaskStateValue::Completed);
// transition_to(Completed) rejected until all resolved
state.resolve_subtask("SUB-1");
state.resolve_subtask("SUB-2");
state.transition_to(TaskStateValue::Completed).unwrap();
```

### Timeout & Retry

```rust
state.set_timeout(TaskTimeout {
    max_duration: Duration::from_secs(3600),
    max_blocked_duration: Duration::from_secs(600),
    max_approval_duration: Duration::from_secs(1800),
    max_retries: 3,
});
```

## Policy Engine

### Dynamic Tool Registry

Thread-safe (`Arc<RwLock<HashMap>>`): `register_dynamic()`, `unregister()`,
`enable()`, `disable()`, `upgrade()`, `list_enabled()`, `snapshot()`.

### Approval Gates

`ApprovalPolicy::Required` → `RequireApproval` runtime decision.
Pipeline returns `{"status":"approval_required"}`. Caller transitions
task from `WaitingApproval` back to `Running` to resume.

### Permission Levels

`L0_READONLY` → `L1_DIFF_REVIEW` → `L2_PATCH_ONLY` → `L3_ISOLATED_WORKTREE`

### Runtime Decisions

`Allow | Deny | RequireApproval | RetryableError | FatalError`

Merge priority: `Deny > FatalError > RequireApproval > RetryableError > Allow`

## Pipeline (RuntimeToolExecutor)

8-stage unified execution in `pipeline/mod.rs`:

```
Stage 1: Validate input schema   → SchemaRegistry
Stage 2: Generate/enforce IDs    → UUID or COAGENT_REQUIRE_EXTERNAL_IDS
Stage 3: Runtime gate            → evaluate_operation (Allow/Deny/RequireApproval)
Stage 4: Invoke backend          → Mock | Reasonix ACP
Stage 5: Validate output         → Finding-level + SchemaRegistry
Stage 6: Validate wrapper schema → SchemaRegistry
Stage 7: Complete lifecycle      → complete_operation (close step)
Stage 8: Serialize response      → MCP CallToolResult JSON
```

Each tool handler is a ~30-line declarative wrapper. Adding a new tool requires:
input type, artifact paths, backend closure, output validator, wrapper builder.

## Context Projection

`ContextProjection` captures all 9 `ReviewDiffInput` fields and projects them
into the Reasonix prompt:

```
AVAILABLE FILES:
  - diff: .agent/diffs/current.diff
  - test log: .agent/logs/test.log
BASE BRANCH: main
FOCUS AREAS:
  - state machine
  - policy engine
CONSTRAINTS:
  - ignore formatting changes
```

## Finding Type Safety

`Finding` struct with `Severity` enum (`Blocker | Major | Minor | Note`).
Dual-layer validation: Rust `validate()` checks issue non-empty, category
non-empty, confidence 0.0-1.0 per finding. JSON Schema provides second-layer
enum value enforcement.

## Execution Sandbox

`SandboxConfig`: working directory, env allowlist/denylist, resource budgets
(max_wall_clock, max_output_bytes, max_tokens, max_cpu_time).

## Event-Sourcing Replay

`replay_task_state()` rebuilds task execution summary from append-only event log.
`check_idempotency()` prevents duplicate event emission.

## ACP Session Recovery

`ReasonixRunner::run()` implements reconnect + retry:

```
send_prompt → Ok → return
send_prompt → Err(recoverable: Io|Protocol) → drop session → reconnect → retry
send_prompt → Err(non-recoverable) → propagate
```

## Audit (SQLite)

12 tables in `.agent/coagent.sqlite`, WAL mode, FULL synchronous, 5s busy timeout.

### Schema Validation Audit (all 3 stages)

Every schema validation failure writes an `audit_events` record:

| Stage | event_type | payload |
|-------|-----------|---------|
| Input validation | `input_schema_validation_failed` | task_id, request_id, expected_schema, errors[] |
| Output validation | `output_schema_validation_failed` | task_id, request_id, expected_schema, errors[] |
| Wrapper validation | `wrapper_schema_validation_failed` | task_id, request_id, expected_schema, errors[] |

Input validation failures before ID generation use `"pre-gate"` as placeholder
task_id/request_id to ensure audit completeness even for pre-gate errors.

### Other Audit Records

- `audit_events` — append-only (UPDATE/DELETE triggers reject)
- `runtime_decisions` — each `evaluate_operation` result
- `task_state` — task lifecycle transitions
- `runtime_steps` + `runtime_events` — per-operation execution records
- `schema_validation_results`, `policy_evaluation_results` — table exists, wired via kernel APIs

## Lifecycle API

```rust
kernel.evaluate_operation(request) → RuntimeDecision
kernel.complete_operation(task_id, request_id, operation) → closes step, task stays alive
kernel.fail_operation(task_id, request_id, operation, error_code, message) → closes step
kernel.complete_task(task_id) → transitions task to Completed (terminal)
```