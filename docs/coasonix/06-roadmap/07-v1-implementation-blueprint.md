# v1 Implementation Blueprint

This document turns the v1 scope into an implementation blueprint. It does not
expand the v1 product boundary. The v1 completion rule remains:

```text
The first read-only reasonix.review_diff path must be gated by Rust and covered
by conformance tests.
```

The implementation priority is:

```text
verifiable runtime gates
-> worker protocol
-> MCP adapter
-> mock Reasonix vertical slice
-> real Reasonix integration
```

## 1. Implementation Shape

v1 is implemented as five layers:

```text
Layer 0: repository scaffold and toolchain
Layer 1: Rust Runtime Core
Layer 2: Rust Runtime Worker over JSON-RPC stdio
Layer 3: TypeScript reasonix-expert MCP Adapter
Layer 4: reasonix.review_diff vertical slice with mock Reasonix
```

Layer 1 and Layer 2 must work before the adapter invokes any real Reasonix
process. This preserves the v1 split between enforceable runtime behavior and
MCP protocol behavior.

## 2. Layer 0: Repository Scaffold

Create the target implementation layout:

```text
Cargo.toml
package.json
bun.lock
schemas/
  coasonix-v1.schema.json
crates/
  coasonix-runtime-core/
  coasonix-runtime-worker/
packages/
  reasonix-expert-mcp/
tests/
  fixtures/
  conformance/
docs/
  coasonix/
```

Minimum Rust workspace layout:

```text
crates/coasonix-runtime-core/
  src/
    schema/
    canonical/
    state/
    policy/
    audit/
    artifact/
    kernel/

crates/coasonix-runtime-worker/
  src/
    rpc/
    lifecycle/
    dispatch/
```

Minimum TypeScript package layout:

```text
packages/reasonix-expert-mcp/
  src/
    mcp/
    worker/
    reasonix/
    schemas/
    errors/
```

Initial verification:

```text
cargo test --workspace
bun test
python -m json.tool schemas/coasonix-v1.schema.json
```

The scaffold should not introduce Vite, a browser UI, a local daemon, an HTTP
listener, or real Reasonix credentials.

## 3. Layer 1A: Schema and Canonicalization

Implement these Rust modules first:

```text
schema
canonical
```

Required responsibilities:

```text
load root schema registry
validate payload by expected schema name
reject duplicate JSON keys before schema validation
verify schema_version matches expected output_schema
produce canonical_json
produce canonical_hash
shape schema_validation_result_v1
shape error_result_v1 where task_id/request_id are available
```

Reasonix payloads should enter Rust as JSON values in v1. Do not add a full Rust
domain model for `review_result_v1` unless the runtime needs to inspect fields
for safety. The v1 path needs schema validation plus common field checks such as
`schema_version`, `task_id`, `request_id`, `status`, `verdict`, `confidence`,
and artifact paths.

Minimum tests:

```text
valid review_diff_input_v1 passes
valid review_result_v1 passes
runtime_decision_v1 validates against the registry
unknown schema_version fails closed
output_schema mismatch fails
confidence outside allowed range fails
unexpected top-level field fails when schema disallows it
duplicate JSON key fails before schema validation
malformed JSON maps to schema/runtime error without panic
```

Acceptance gate:

```text
No runtime operation can return allow if its request or required result payload
cannot be validated and canonicalized.
```

## 4. Layer 1B: State, Path, Shell, and Policy

Implement these Rust modules next:

```text
state
artifact
policy
```

Minimum owned types:

```text
TaskState
TaskStateValue
RuntimeOperationRequest
RuntimeDecision
PolicyEvaluationRequest
PolicyEvaluationResult
ResourceSet
PermissionLevel
RuntimeDecisionValue
RoutingMetadata
```

State machine scope for v1:

```text
initialize or load task state
reject illegal transitions before side effects
increment reasonix_calls only through runtime-owned decisions
persist deny decisions
block terminal-state mutation
block completion while required gaps exist when completion is in scope
```

Path policy scope for v1:

```text
normalize repo root
normalize relative artifact paths
reject path traversal
reject symlink escape
handle Windows case-folding bypasses
apply denylist before allowlist
verify artifact paths are repo-local
```

Shell policy scope for v1:

```text
accept argv arrays only
reject shell strings
evaluate argv[0] and args structurally
reject substring bypasses
record command hash in audit metadata
return deny without adapter retrying a looser command
```

Minimum policy profile:

```text
reasonix.review_diff:
  permission_level: L1_DIFF_REVIEW
  read: .agent/context/**, .agent/diffs/**, .agent/logs/**, repo-allowed docs/code paths
  write: .agent/results/**, .agent/logs/**
  network: deny
  shell: configured Reasonix executable argv only
```

Minimum tests:

```text
illegal state transition denied
terminal state rejects mutation
denied path blocks before read
absolute path outside repo denied
.. traversal denied
symlink escape denied
denylist beats allowlist
shell string rejected
argv substring bypass rejected
permission mismatch denied
network request denied by default
```

Acceptance gate:

```text
Runtime decisions must be based on structured operation, resources, state, and
policy data, not on natural language or adapter trust.
```

## 5. Layer 1C: SQLite Store and Audit

Implement SQLite before the adapter vertical slice. SQLite is part of the v1
safety boundary, not an optional log sink.

Database path:

```text
.agent/coasonix.sqlite
```

Open settings:

```text
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
```

Migration order:

```text
1. runtime_metadata
2. tasks
3. audit_events and append-only triggers
4. task_state
5. runtime_decisions
6. schema_validation_results
7. policy_evaluation_results
8. locks
9. artifacts
10. cache_entries
```

Runtime transaction shape:

```text
BEGIN IMMEDIATE;
validate current state
evaluate policy
insert runtime_decision
insert audit_event with next task_sequence
update task_state when applicable
COMMIT;
```

Required audit behavior:

```text
audit_events.id is global database order
audit_events.task_sequence is per-task order
audit_events cannot be updated
audit_events cannot be deleted
deny decisions are persisted
failed audit insert fails the runtime operation
allow side effects are permitted only after the allow transaction commits
```

Minimum tests:

```text
database created under .agent/coasonix.sqlite
foreign keys enabled
migrations run before runtime.initialize succeeds
failed migration blocks side effects
audit update rejected
audit delete rejected
audit id globally monotonic
audit task_sequence monotonic per task
state and audit commit atomically
rollback leaves no partial state transition
deny decision persisted
worker restart recovers task state
stale lock detected on startup
cache metadata can be recorded without enabling cache-hit reuse
cache corruption denies reuse only
```

Acceptance gate:

```text
No allow decision is complete until its runtime_decision and audit_event are
committed in SQLite.
```

## 6. Layer 1D: RuntimeKernel

`RuntimeKernel` is the only composition point for schema, state, policy, audit,
locks, and artifact gates.

Minimum public Rust API:

```rust
impl RuntimeKernel {
    pub fn initialize(config: RuntimeConfig) -> Result<Self, RuntimeError>;

    pub fn validate_schema(
        &self,
        request: SchemaValidationRequest,
    ) -> SchemaValidationResult;

    pub fn evaluate_operation(
        &mut self,
        request: RuntimeOperationRequest,
    ) -> RuntimeDecision;

    pub fn write_audit(
        &mut self,
        event: AuditEvent,
    ) -> Result<AuditWriteResult, RuntimeError>;
}
```

`transition_state` and `evaluate_policy` may exist as internal subroutines
first. They should be exposed only when direct conformance tests need them.

`evaluate_operation` flow:

```text
validate runtime_operation_request_v1 shape
load or create task state
verify operation is legal in current state
evaluate policy
merge engine decisions
write runtime_decision
write audit_event
update counters or task_state when needed
return runtime_decision_v1
```

Decision merge:

```text
deny beats require_approval
require_approval beats allow
retryable_error beats allow
fatal_error beats all except explicit policy deny
```

Minimum tests:

```text
allow decision contains schema/state/policy engine results
deny decision contains reasons and is persisted
state denial beats policy allow
policy denial beats state allow
runtime_decision_v1 validates against schema registry
audit event id is attached to persisted runtime decision
write_audit is centralized through RuntimeKernel
submodules cannot mutate audit sequence directly
```

Acceptance gate:

```text
The adapter never calls submodules directly; it can only talk to the worker,
which dispatches through RuntimeKernel.
```

## 7. Layer 2: Rust Runtime Worker

The worker is a JSON-RPC 2.0 stdio process owned by the TypeScript adapter. It
is not an MCP server.

Allowed v1 methods:

```text
runtime.initialize
runtime.validate_schema
runtime.evaluate_operation
runtime.write_audit
runtime.shutdown
```

Post-v1 methods must not be exposed by the worker until their runtime gates and
tests exist.

Protocol rules:

```text
stdin: JSON-RPC 2.0 requests
stdout: JSON-RPC 2.0 responses only
stderr: structured logs only
one line: one complete JSON-RPC frame
notifications rejected
unknown methods return Method not found
malformed frames return Parse error when possible
request id equals or maps directly to request_id
```

Error mapping:

```text
-32700  Parse error
-32600  Invalid Request
-32601  Method not found
-32602  Invalid params
-32001  runtime_policy_denied
-32002  runtime_state_denied
-32003  runtime_schema_invalid
-32004  runtime_approval_required
-32005  runtime_budget_exceeded
-32006  runtime_snapshot_mismatch
-32007  runtime_storage_error
-32008  runtime_unavailable
-32009  runtime_unknown_operation
-32010  runtime_internal_error
```

Minimum tests:

```text
valid initialize succeeds after migrations
unknown method rejected
notification rejected
malformed JSON rejected
invalid params rejected
evaluate_operation returns runtime_decision_v1
validate_schema returns schema_validation_result_v1
worker stderr does not pollute stdout
stdout contains JSON-RPC frames only
worker shutdown is explicit
```

Acceptance gate:

```text
JSON-RPC success does not authorize side effects by itself. The adapter must
also require result.decision == "allow".
```

## 8. Layer 3: TypeScript MCP Adapter

The TypeScript adapter owns protocol adaptation and process supervision only.
Security logic belongs in Rust.

Suggested modules:

```text
src/mcp/server.ts
src/mcp/tools.ts
src/worker/client.ts
src/worker/protocol.ts
src/reasonix/runner.ts
src/reasonix/output-normalizer.ts
src/errors/map-runtime-error.ts
```

Adapter responsibilities:

```text
MCP server lifecycle
MCP initialize
tools/list
tools/call
stable reasonix.review_diff tool definition
Rust worker startup, shutdown, restart, and timeout handling
JSON-RPC framing over stdio
Reasonix process invocation after Rust allow
stdout/stderr capture
MCP structuredContent response shaping
runtime_unavailable mapping
```

Adapter non-authorities:

```text
allow / deny / require_approval decisions
path policy
shell policy
network policy
patch safety
cache reuse
task completion
verification completion
approval unblock
```

`tools/list` in v1:

```text
reasonix.review_diff
```

The adapter must not declare unimplemented post-v1 tools.

`tools/call reasonix.review_diff` flow:

```text
confirm MCP initialized
validate tool name
allocate or validate task_id and request_id
perform adapter-side shape checks for ergonomics
call runtime.evaluate_operation
if decision != allow, return isError tool result and do not spawn Reasonix
spawn configured mock/Reasonix executable with argv array only
capture stdout and stderr separately
extract exactly one JSON object from stdout
call runtime.validate_schema for review_result_v1
map valid result to MCP structuredContent
map invalid result to isError tool result
```

Minimum tests:

```text
tools/list exposes reasonix.review_diff only
tools/list inputSchema references review_diff_input_v1
tools/call asks Rust before Reasonix invocation
denied runtime decision prevents Reasonix invocation
worker unavailable returns runtime_unavailable and no side effect
worker crash returns side_effect_not_executed
valid review_result_v1 becomes structuredContent
malformed output does not become structuredContent
stderr is captured as diagnostic data, not structuredContent
```

Acceptance gate:

```text
The adapter can perform early validation for ergonomics, but every security
decision comes from Rust.
```

## 9. Layer 4: Mock Reasonix Vertical Slice

Use a mock Reasonix executable before real Reasonix integration. The mock reads
stdin and writes controlled output to stdout/stderr.

Required cases:

```text
success: valid review_result_v1
timeout
malformed JSON
multiple JSON objects
markdown-fenced JSON
nonzero exit
stderr-only failure
schema mismatch
wrong task_id
wrong request_id
invalid confidence
```

The complete v1 vertical slice:

```text
Codex or MCP test client calls reasonix.review_diff
-> TypeScript MCP Adapter receives tools/call
-> TypeScript sends runtime.evaluate_operation to Rust
-> Rust validates schema/state/policy/path
-> Rust writes audit allow or deny
-> TypeScript invokes mock Reasonix only if Rust returns allow
-> TypeScript captures raw output
-> TypeScript sends runtime.validate_schema to Rust
-> Rust validates review_result_v1
-> Rust writes validation/audit evidence
-> TypeScript returns MCP structuredContent
```

Required negative proofs:

```text
runtime deny -> Reasonix not invoked
worker unavailable -> no Reasonix invocation
invalid input -> no Reasonix invocation
invalid Reasonix output -> no trusted structuredContent
timeout -> isError true
nonzero exit -> isError true
schema mismatch -> schema_validation_failed
```

Acceptance gate:

```text
The path is not working until both success and denial/failure paths are tested.
```

## 10. Milestone Plan

| Milestone | Scope | Verification |
|---|---|---|
| M0 | Scaffold Rust workspace, Bun workspace, package layout | `cargo test --workspace`, `bun test`, schema JSON validates |
| M1 | Schema registry and canonicalization | schema/canonical tests pass, duplicate keys rejected |
| M2 | State, path, shell, and minimum policy | state/policy/path/shell denial tests pass |
| M3 | SQLite persistence and audit writer | migration, append-only audit, transaction, restart tests pass |
| M4 | RuntimeKernel decision merge | `evaluate_operation` returns schema-valid persisted decisions |
| M5 | Rust JSON-RPC worker | allowed methods and JSON-RPC error mapping pass |
| M6 | TypeScript worker client | framing, timeout, crash, unavailable behavior pass |
| M7 | MCP adapter `tools/list` and `tools/call` | only `reasonix.review_diff`, Rust asked before spawn |
| M8 | Mock Reasonix vertical slice | success and failure matrix pass |

Each milestone should leave the repository in a state where the relevant tests
can run without network access and without real Reasonix credentials.

## 11. Required Final v1 Verification

Repository-level verification:

```text
cargo test --workspace
bun test
python -m json.tool schemas/coasonix-v1.schema.json
```

v1-core verification:

```text
invalid schema input denied before side effect
duplicate JSON keys rejected
illegal state transition denied
denied path blocks before read
shell string rejected
argv substring bypass rejected
SQLite audit rows append-only
runtime_decision_v1 validates against root schema registry
worker JSON-RPC exposes only v1 methods
```

v1-adapter verification:

```text
tools/list exposes reasonix.review_diff only
tools/call asks Rust before invoking Reasonix
denied runtime decision prevents Reasonix invocation
malformed Reasonix output is rejected before structuredContent
valid review_result_v1 is returned as structuredContent
worker crash causes runtime_unavailable and no side effect
mock Reasonix covers success, timeout, malformed JSON, nonzero exit,
stderr-only failure, and schema mismatch
```

## 12. Explicit Non-Goals During Implementation

Do not implement these in v1:

```text
reasonix.propose_patch
patch apply
patch transaction commit
human approval UI
network allow exceptions
remote HTTP transport
local daemon
multi-repo worker sharing
project-level shared session lane reuse
advanced Project Controller cache reuse
benchmark runner
profiling runner
security_audit/debug/performance/architecture/test_plan tools
Reasonix write access to Codex worktree
```

These are not hidden milestones. They remain out of scope until their runtime
gates, schemas, denial cases, malformed-output cases, and audit events are
implemented and tested.

## 13. Implementation Principle

The v1 implementation should prove this invariant:

```text
Every Reasonix-related side effect crosses Rust Runtime schema/state/policy/audit
gates before execution, and every Reasonix result crosses Rust schema validation
before it becomes MCP structuredContent for Codex.
```

If a shortcut makes `reasonix.review_diff` appear to work while bypassing this
invariant, it is not a valid v1 implementation.
