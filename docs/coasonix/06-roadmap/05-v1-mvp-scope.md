# v1 MVP Scope

This document defines the first implementation boundary for Coasonix after the
technology decision in `04-technology-selection.md`.
The Rust Runtime Core API and data model boundary are defined in
`06-runtime-core-api.md`.

The goal of v1 is not to expose every documented Reasonix capability. The goal
is to prove that a Rust Runtime Worker can enforce schema, state, policy, audit,
and worker-availability gates before a TypeScript MCP Adapter performs any side
effect.

Hard rule:

```text
v1 is complete only when the first read-only Reasonix tool path is gated by Rust
and covered by conformance tests.
```

## 1. v1 Layers

v1 is split into two layers:

```text
v1-core:
  Rust Runtime Core + Rust Runtime Worker can run and pass conformance tests
  without MCP or Reasonix.

v1-adapter:
  TypeScript MCP Adapter can call one read-only Reasonix tool through Rust gates.
```

This split keeps enforceable runtime behavior independent from MCP protocol
behavior.

## 2. v1-core Required Scope

v1-core must include:

```text
1. schema loader and JSON Schema validator
2. canonical JSON and canonical hash generation
3. path normalization and path matcher
4. shell argv policy matcher
5. task state machine runner
6. minimum policy engine profile
7. SQLite-backed state, audit, lock, and cache metadata store
8. JSON-RPC 2.0 over stdio worker
9. conformance tests for schema, state, path, shell, SQLite audit, and worker failure
```

v1-core does not need Reasonix, MCP, patch application, benchmark execution, or
human approval UI.

Minimum Rust modules:

```text
schema
canonical
state
policy
audit
artifact
kernel
worker/rpc
worker/dispatch
```

Modules may be physically arranged differently, but every responsibility above
must have a clear owner.

## 3. v1-adapter Required Scope

v1-adapter must include:

```text
1. MCP initialize
2. MCP tools/list
3. MCP tools/call
4. reasonix.review_diff only
5. TypeScript Rust worker client
6. worker unavailable -> deny / side_effect_not_executed
7. Reasonix invocation only after Rust allow
8. Reasonix output validation through Rust
9. MCP structuredContent response mapping
```

The only v1 Reasonix tool is:

```text
reasonix.review_diff
```

The adapter may declare no unimplemented tools in v1. Additional tools become
eligible only after their runtime gates and conformance tests exist.

## 4. First End-to-End Vertical Slice

The first complete path is:

```text
Codex calls reasonix.review_diff
-> TypeScript MCP Adapter receives tools/call
-> TypeScript sends runtime.evaluate_operation to Rust
-> Rust validates schema/state/policy/path
-> Rust writes audit allow or deny
-> TypeScript invokes Reasonix only if Rust returns allow
-> TypeScript captures Reasonix raw output
-> TypeScript sends runtime.validate_schema to Rust
-> Rust validates review_result_v1
-> Rust writes audit result
-> TypeScript returns MCP structuredContent
```

The path is considered working only if denial and failure paths are also tested.

## 5. v1 Explicit Non-Goals

v1 does not include:

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

Some of these surfaces are documented for the larger system, but they are not
part of the first implementation boundary.

## 6. Shell Policy in v1

v1-core must implement shell argv policy matching and conformance tests.

v1-adapter may still own actual process spawning for Reasonix, but it must ask
Rust before invocation. The Rust decision gates whether the adapter may spawn the
configured Reasonix command.

Rules:

```text
1. TypeScript constructs an argv array, never a shell string.
2. Rust evaluates the argv against shell policy.
3. TypeScript spawns only after Rust returns allow.
4. TypeScript must not retry with a looser command on denial.
5. Rust audit records the command hash and policy decision.
```

Rust does not need to execute the shell command in v1. It owns the decision, not
necessarily the process spawn.

## 7. Acceptance Criteria

v1-core acceptance criteria:

```text
1. invalid schema input is denied before side effect
2. duplicate JSON keys are rejected
3. illegal state transition is denied
4. denied path blocks before read
5. shell string input is rejected
6. argv substring bypass is rejected
7. SQLite audit rows are append-only, with global id order and per-task task_sequence
8. Rust worker unavailable returns deny to TypeScript
9. runtime_decision_v1 validates against the root schema registry
10. Rust worker JSON-RPC exposes only the v1 allowed method set
```

v1-adapter acceptance criteria:

```text
1. tools/list exposes reasonix.review_diff only
2. tools/list inputSchema references review_diff_input_v1
3. tools/call asks Rust before invoking Reasonix
4. denied runtime decision prevents Reasonix invocation
5. malformed Reasonix output is rejected before structuredContent
6. valid review_result_v1 is returned as structuredContent
7. worker crash causes runtime_unavailable and no side effect
8. audit events exist for runtime decision and result validation
9. mock Reasonix executable covers success, timeout, malformed JSON, nonzero exit,
   stderr-only failure, and schema mismatch
```

Repository-level acceptance criteria:

```text
cargo test --workspace passes
bun test passes for the TypeScript adapter
schema registry validates with python -m json.tool schemas/coasonix-v1.schema.json
no v1 test requires network
no v1 test requires real Reasonix credentials
v1 may record cache metadata but does not reuse review_diff cache hits until cache conformance exists
```

## 8. Recommended Implementation Order

Implementation should proceed in this order:

```text
1. create Rust workspace and TypeScript package skeleton
2. move schema validation into Rust core tests
3. implement canonical JSON and hashing
4. implement task state machine
5. implement path matcher
6. implement shell argv matcher
7. implement SQLite runtime database and audit writer
8. implement runtime kernel decision merge
9. implement Rust JSON-RPC worker
10. implement TypeScript worker client
11. implement MCP tools/list with reasonix.review_diff only
12. implement review_diff read-only vertical slice
13. add failure-path conformance tests
```

The adapter should not call a real Reasonix process until steps 1-10 pass.
The adapter should not expose post-v1 runtime worker methods until their gates
and conformance tests exist.

The initial scaffold should use Rust edition 2024 and Bun workspace tooling.
Vite is not required for v1 because the MCP Adapter is a server process, not a
browser application.

## 9. Promotion Beyond v1

A new Reasonix tool may be added only when:

```text
1. its input and output schema are enforced by Rust
2. runtime.evaluate_operation covers its permission level
3. denial cases are tested
4. malformed output cases are tested
5. audit events are emitted
6. docs list it as implemented
```

Patch generation remains disabled until patch safety, dry-run, transaction,
rollback, verification, and audit conformance tests pass.
