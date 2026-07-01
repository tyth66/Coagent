# Technology Selection

This document records the implementation technology decision for Coasonix v1.
It complements the node-level plan in `03-implementation-plan.md` and the
runtime details in `../02-runtime/06-executable-runtime-details.md`.

## 1. Decision

Coasonix v1 uses:

```text
Rust Runtime Core
TypeScript reasonix-expert MCP Adapter
Official MCP TypeScript SDK stable v1 line
MCP protocol baseline: latest stable specification as of implementation time
JSON-RPC 2.0 over stdio between TypeScript and Rust
Rust edition 2024
Bun toolchain for TypeScript workspace, build, and tests
ES Modules for TypeScript package format
JSON Schema 2020-12 for schema contracts
Repo-local SQLite at .agent/coasonix.sqlite
Root-level schema registry at ../../../schemas/coasonix-v1.schema.json
```

The architecture is:

```text
Codex MCP Host
  -> TypeScript reasonix-expert MCP Adapter
      -> managed Rust Runtime Worker
          -> Rust Runtime Core
      -> Reasonix CLI / future local controller
```

Hard rule:

```text
No side effect is allowed unless the Rust Runtime Worker returns allow.
```

## 1.1 Technology Baseline Matrix

The technology selection is a full runtime baseline, not only a language
choice.

| Area | v1 choice | Boundary |
|---|---|---|
| MCP adapter language | TypeScript | Owns MCP protocol, process supervision, and response shaping only. |
| MCP SDK | Official stable MCP TypeScript SDK v1 line | Do not adopt beta SDK major versions as the v1 baseline. |
| Runtime core language | Rust edition 2024 | Owns enforceable schema, state, policy, audit, lock, cache, and verification gates. |
| TypeScript toolchain | Bun | Owns package management, scripts, build, and adapter tests. |
| TypeScript module format | ES Modules | Bun is the runtime/toolchain, not the module-system decision. |
| MCP transport | STDIO | Codex starts the configured MCP server at Codex startup and initializes its MCP session; no v1 daemon or HTTP listener. |
| Internal TS-Rust protocol | JSON-RPC 2.0 over stdio | Internal worker protocol only; Rust worker is not an MCP server. |
| Schema dialect | JSON Schema 2020-12 | Root registry is the contract; generated TS/Rust types are implementation aids. |
| Runtime database | SQLite | Repo-local source of truth for state, audit, locks, runtime decisions, and cache metadata. |
| Artifact storage | Files under `.agent/` | Large bytes stay in files; SQLite stores metadata, hashes, and audit references. |
| Debug UI | None in v1 | Vite may be used later only for an optional browser debug console. |
| Remote service | None in v1 | Streamable HTTP is a deployment-model change, not a planned v1 phase. |

The implementation must re-check the official MCP specification and SDK release
state before code is scaffolded. If the latest SDK major version is still marked
beta or preview, v1 remains on the stable SDK line.

## 1.2 External Baseline References

Implementation must verify these upstream references at scaffold time:

```text
MCP specification:
  https://modelcontextprotocol.io/specification

MCP transport specification:
  https://modelcontextprotocol.io/specification/latest/basic/transports

MCP tools and structured results:
  https://modelcontextprotocol.io/docs/concepts/tools

MCP TypeScript SDK:
  https://github.com/modelcontextprotocol/typescript-sdk

SQLite:
  https://www.sqlite.org/about.html
```

Current interpretation for v1:

```text
1. MCP uses JSON-RPC 2.0 at the protocol layer.
2. Local MCP servers should use STDIO unless there is a concrete shared-service
   deployment need.
3. STDIO stdout is protocol-only; logs go to stderr.
4. Tool results should expose structuredContent and keep text fallback when
   client compatibility requires it.
5. TypeScript MCP SDK beta major versions are not production baselines.
6. SQLite is selected as an embedded repo-local runtime database, not as an
   artifact byte store.
```

## 2. Rust Runtime Core

Rust owns the enforceable security and correctness boundary.

Responsibilities:

```text
schema validation
canonical JSON and canonical hash generation
path, shell argv, network, and cache policy evaluation
task state machine enforcement
audit event construction and append-only writing
artifact read/write gate decisions
verification gate decisions
human approval lifecycle validation
patch safety, dry-run, transaction, and rollback gates
runtime_decision_v1 composition
```

Rust does not own:

```text
MCP initialize / tools/list / tools/call
Codex-facing conversation
natural-language task interpretation
Reasonix internal agent selection
final user response generation
network-exposed runtime service
```

## 3. TypeScript MCP Adapter

TypeScript owns the protocol adapter and process supervision layer.

Responsibilities:

```text
MCP server lifecycle
reasonix.* tool definitions
MCP request parsing
Rust worker startup, shutdown, restart, and timeout handling
JSON-RPC 2.0 framing over stdio
Reasonix process invocation after Rust allow decisions
MCP structuredContent response shaping
runtime_unavailable error mapping
```

TypeScript must not be the final authority for:

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

TypeScript may perform early validation for ergonomics, but early validation is
not a security decision.

## 4. Session and Rust Worker Boundary

The Rust worker is a managed child process owned by the TypeScript MCP Adapter.
The TypeScript MCP Adapter process is started with Codex as a configured MCP
server. MCP initialize creates the protocol session. Later `tools/call`
requests allocate or route Coasonix logical sessions inside that already-running
adapter; they do not start the MCP server process.

Worker scope:

```text
one Codex-launched MCP server process
one initialized MCP session
one repo root
one MCP adapter instance
one Rust worker process
no local daemon
no remote Runtime Service
no shared in-memory runtime across Codex-launched MCP server instances in v1
no network listener
```

Session rules:

```text
1. Codex startup starts the configured `reasonix-expert` MCP server process.
2. MCP initialize creates the adapter's active MCP protocol session boundary.
3. runtime.initialize binds the Rust worker to repo_root, schema registry,
   policy profile, and database path for that adapter session.
4. tools/call allocates or routes a Coasonix logical session, including
   task_namespace, session_lane, request_id, and runtime gate context.
5. The worker may live for the adapter process lifetime, but it must not be
   reused by a different Codex-started MCP server instance.
6. If the adapter or worker restarts, persisted SQLite state is the recovery
   source; in-memory session state is disposable.
7. A tools/call does not by itself define a new process, MCP server lifecycle,
   or Rust worker lifecycle.
```

Persistent facts live under `.agent/`, not only in worker memory:

```text
.agent/coasonix.sqlite
.agent/results/**
.agent/context/**
.agent/diffs/**
```

Worker memory may cache:

```text
loaded schema registry
loaded policy profile
project registry entries
task state snapshots
audit sequence cursors
lock table
cache metadata index
```

On restart, the worker must recover from persisted `.agent/` state before
allowing side effects.

## 4.1 Identity Ownership

v1 uses explicit IDs for process, worker, task, request, and audit correlation.

Ownership:

```text
mcp_server_instance_id:
  generated by the TypeScript MCP Adapter at process startup

worker_id:
  generated by the Rust Runtime Worker at worker startup

task_id:
  supplied by Codex/tool arguments when an existing Coasonix task is continued;
  otherwise allocated by the TypeScript MCP Adapter before calling Rust

request_id:
  allocated by the TypeScript MCP Adapter per tools/call and mapped directly to
  the MCP JSON-RPC id when the id already satisfies the Coasonix request format

audit_events.id:
  allocated by SQLite as global database order

audit_events.task_sequence:
  allocated by Rust AuditWriter per task inside the runtime transaction
```

Recommended generated formats:

```text
TASK-<uuid>
REQ-<uuid>
MCP-<uuid>
WORKER-<uuid>
```

Rules:

```text
1. Rust always receives task_id and request_id; it does not infer them from
   natural language or MCP content.
2. If Codex supplies task_id/request_id, the adapter validates them before any
   worker call.
3. If the MCP JSON-RPC id differs from request_id, the adapter records the
   direct mapping in audit metadata.
4. owner_worker_id in locks must equal the current Rust worker_id.
5. mcp_server_instance_id and worker_id are recovery metadata, not permission
   authorities.
```

Architecture impact:

```text
No architecture change. ID ownership clarifies adapter/kernel boundaries and
keeps SQLite recovery/audit correlation deterministic.
```

## 5. JSON-RPC 2.0 over Stdio

Transport:

```text
stdin: JSON-RPC 2.0 requests
stdout: JSON-RPC 2.0 responses only
stderr: structured logs only
one line: one complete JSON-RPC frame
```

Request shape:

```json
{
  "jsonrpc": "2.0",
  "id": "REQ-001",
  "method": "runtime.evaluate_operation",
  "params": {}
}
```

Success response:

```json
{
  "jsonrpc": "2.0",
  "id": "REQ-001",
  "result": {
    "schema_version": "runtime_decision_v1",
    "task_id": "TASK-001",
    "operation": "read_artifact",
    "decision": "allow",
    "engine_results": {
      "schema": "allow",
      "state": "allow",
      "policy": "allow"
    },
    "reasons": []
  }
}
```

Failure response:

```json
{
  "jsonrpc": "2.0",
  "id": "REQ-001",
  "error": {
    "code": -32001,
    "message": "runtime_policy_denied",
    "data": {
      "schema_version": "error_result_v1",
      "task_id": "TASK-001",
      "request_id": "REQ-001",
      "status": "permission_denied",
      "verdict": "blocked",
      "summary": "Path denied by policy.",
      "recoverable": false
    }
  }
}
```

Rules:

```text
1. JSON-RPC notifications are rejected; every request needs id.
2. id must equal or map directly to request_id.
3. Unknown methods return Method not found.
4. Malformed frames return Parse error when possible.
5. Worker unavailable means deny and side_effect_not_executed.
6. JSON-RPC success is not enough for side effects; TypeScript must require
   result.decision == "allow".
```

v1 worker allowed methods:

```text
runtime.initialize
runtime.validate_schema
runtime.evaluate_operation
runtime.write_audit
runtime.shutdown
```

Post-v1 candidate methods:

```text
runtime.transition_state
runtime.evaluate_policy
runtime.freeze_snapshot
runtime.evaluate_cache
runtime.check_patch
runtime.run_verification_gate
runtime.request_approval
runtime.resolve_approval
```

Architecture impact:

```text
No architecture change. This narrows the v1 worker attack surface while keeping
the Rust core API free to expose transition_state and evaluate_policy internally
for conformance tests.
```

## 6. Repository Layout

Target implementation layout:

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

Rust workspace:

```text
crates/coasonix-runtime-core/
  schema/
  canonical/
  state/
  policy/
  audit/
  artifact/
  cache/
  approval/
  verification/
  patch/
  kernel/

crates/coasonix-runtime-worker/
  rpc/
  lifecycle/
  dispatch/
```

TypeScript package:

```text
packages/reasonix-expert-mcp/
  src/mcp/
  src/worker/
  src/reasonix/
  src/schemas/
  src/errors/
```

Security logic belongs in Rust. TypeScript must not grow `policy`, `state`, or
`patchSafety` authority modules.

## 7. Dependency Direction

Rust workspace configuration:

```text
edition = "2024"
resolver = "2"
```

Rust dependencies should start narrow:

```text
serde
serde_json
jsonschema
rusqlite
thiserror
tracing
tempfile
uuid
```

TypeScript dependencies should start narrow:

```text
official MCP TypeScript SDK
ajv for adapter-side boundary checks
typescript
```

The TypeScript workspace uses Bun for package management, scripts, building,
and tests. The TypeScript package uses ES Modules as its module format; Bun is
the runtime/toolchain, not a separate module system. Vite is not part of the v1
runtime path; it may be introduced later only for an optional browser-based debug
console.

The schema registry is the source of truth. Zod or TypeScript types may be
generated or hand-written for adapter ergonomics, but they are not the contract.

## 8. Testing Strategy

Rust owns conformance tests for enforceable behavior:

```text
schema validation
state transitions
path policy
shell argv policy
network policy
cache reuse
SQLite persistence
audit writer
approval lifecycle
verification gate
patch safety
runtime kernel decision merge
```

TypeScript owns adapter tests:

```text
MCP tools/list
MCP tools/call request shaping
Rust worker client framing
runtime_unavailable behavior
Reasonix invocation only after Rust allow
structuredContent response mapping
```

Shared fixtures live under `tests/fixtures/` and must be consumable by both Rust
and TypeScript tests.

## 9. Non-Goals

Coasonix v1 does not include:

```text
local daemon
remote Runtime Service
network-exposed Runtime Kernel
shared runtime across Codex sessions
N-API / native addon integration
HTTP transport between TS and Rust
Reasonix direct write access to Codex worktree
```

These are not deferred milestones for v1. They are out of scope unless the
deployment model changes.

## 10. Rejected Alternatives

All TypeScript:

```text
Rejected because the safety kernel would live in the same dynamic runtime as the
protocol adapter. This is faster to build but weaker for canonicalization,
path/shell policy, locking, audit durability, and long-term enforcement.
```

All Rust:

```text
Rejected because the MCP adapter surface is faster and lower-risk in
TypeScript, while Rust should stay focused on the enforceable runtime core.
```

Python primary implementation:

```text
Rejected because Python is useful for tests and scripts, but the core runtime
gate benefits from Rust's type system, explicit error handling, and process
boundary discipline.
```
