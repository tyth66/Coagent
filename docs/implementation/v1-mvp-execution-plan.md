# v1 MVP Completion Summary and MCP Server Next Slice

**Status:** v1 MVP is complete for the Rust-gated
`reasonix.review_diff` mock vertical slice, the runnable MCP stdio server shell,
and official MCP SDK client compatibility.

**Boundary:** v1 proves the runtime invariant, not the full Coasonix product.
Rust owns enforceable schema, canonicalization, state, policy, audit, locks,
SQLite persistence, and runtime decisions. TypeScript owns MCP adaptation,
worker process supervision, Reasonix process invocation, output normalization,
and response shaping only.

**Tech stack:** Rust 2024, Cargo workspace, Bun, TypeScript ESM, JSON-RPC 2.0
over stdio, JSON Schema 2020-12, SQLite.

## Source Boundaries

Project specifications live under:

```text
docs/coasonix/
schemas/coasonix-v1.schema.json
```

Runtime implementation lives under:

```text
crates/coasonix-runtime-core/
crates/coasonix-runtime-worker/
packages/reasonix-expert-mcp/
```

This file is the compressed implementation status and next-slice handoff. It is
not a replacement for the source-of-truth architecture documents under
`docs/coasonix/`.

## Completed v1 MVP Scope

The completed v1 slice covers M0 through M8:

| Milestone | Completed scope | Evidence |
|---|---|---|
| M0 | Rust workspace, Bun workspace, package layout | `Cargo.toml`, `package.json`, package scaffolds |
| M1 | Schema registry, duplicate-key rejection, canonical JSON/hash | `crates/coasonix-runtime-core/src/schema/`, `src/canonical/` |
| M2 | Task state, artifact path policy, shell/argv policy, minimum policy profile | `src/state/`, `src/artifact/`, `src/policy/` |
| M3 | Repo-local SQLite store, migrations, append-only audit, locks, cache metadata | `src/storage/` |
| M4 | `RuntimeKernel` decision merge and evidence persistence | `src/kernel/` |
| M5 | Rust JSON-RPC stdio runtime worker | `crates/coasonix-runtime-worker/src/main.rs` |
| M6 | TypeScript runtime worker client | `packages/reasonix-expert-mcp/src/worker/` |
| M7 | Testable MCP tool adapter for `tools/list` and `tools/call` gate | `packages/reasonix-expert-mcp/src/mcp/tools.ts` |
| M8 | Mock Reasonix `review_diff` vertical slice | `packages/reasonix-expert-mcp/src/reasonix/` |
| M9 | Runnable Bun stdio MCP server shell and initialization lifecycle | `packages/reasonix-expert-mcp/src/mcp/server.ts` |
| M10 | Official MCP SDK client compatibility for `listTools` and `callTool` | `packages/reasonix-expert-mcp/src/mcp/server.test.ts` |

The working v1 flow is:

```text
tools/call reasonix.review_diff
-> TypeScript adapter normalizes input
-> runtime.evaluate_operation over JSON-RPC stdio
-> Rust validates schema/state/policy/path/argv
-> Rust persists runtime_decision + audit_event
-> TypeScript invokes mock Reasonix only after decision == allow
-> TypeScript extracts exactly one JSON object from stdout
-> runtime.validate_schema validates review_result_v1
-> Rust persists schema validation evidence
-> TypeScript returns MCP-style structuredContent only for valid output
```

## Verified Behavior

The v1 tests cover:

```text
schema registry loads and validates v1 payloads
duplicate JSON keys fail before schema validation
canonical hashes are stable across object key ordering
illegal or terminal task state transitions are denied
path traversal, outside-repo paths, symlink escapes, and denylisted paths fail
shell strings and argv bypasses fail
network access is denied by default
runtime decisions and audit events commit atomically
audit rows are append-only
JSON-RPC worker exposes only v1 runtime methods
worker stdout contains JSON-RPC frames only
TypeScript worker client handles timeout, crash, restart, and unavailable cases
tools/list exposes only reasonix.review_diff
tools/call asks Rust before Reasonix invocation
deny/unavailable paths do not invoke Reasonix
valid review_result_v1 becomes structuredContent
malformed, mismatched, timed-out, or nonzero Reasonix output is rejected
```

Repository-level verification command set:

```text
cargo test --workspace
bun test
python -m json.tool schemas/coasonix-v1.schema.json > $null
cargo fmt --all -- --check
git diff --check
```

## Explicit Non-Goals Still Out of Scope

These remain post-v1 and must not be smuggled into the MCP server shell slice:

```text
real Reasonix credentials
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
security_audit/debug/performance/architecture/test_plan tools
Reasonix write access to Codex worktree
```

Safe autonomous patch operation is still blocked until patch safety, approval,
and verification gates are implemented and tested.

## Next Slice: Real Runnable MCP Server Shell

This slice is implemented. It turns the tested adapter into a real local MCP
stdio server entrypoint. It is an operationalization slice, not a new Reasonix
capability.

### Goal

Implemented a runnable `reasonix-expert-mcp` stdio server that:

```text
starts under Bun
initializes exactly one RuntimeWorkerClient
calls runtime.initialize before tools/call can execute
serves tools/list and tools/call over MCP stdio
uses the existing reasonix.review_diff adapter
shuts down the Rust runtime worker on MCP server close or process termination
does not expose new tools
does not bypass Rust runtime decisions
```

### Proposed Files

```text
packages/reasonix-expert-mcp/src/index.ts
packages/reasonix-expert-mcp/src/mcp/server.ts
packages/reasonix-expert-mcp/src/config.ts
packages/reasonix-expert-mcp/src/mcp/server.test.ts
packages/reasonix-expert-mcp/package.json
```

Keep `src/mcp/tools.ts` as the testable business adapter. `server.ts` should be
a thin MCP transport wrapper around it.

Implementation note: this slice uses a minimal line-delimited JSON-RPC stdio
server wrapper rather than adding an MCP SDK dependency. The server maps
`initialize`, `tools/list`, and `tools/call` only.

### Configuration Contract

Use environment variables first. CLI args can be added later only if needed.

Required:

```text
COASONIX_REPO_ROOT
COASONIX_SCHEMA_PATH
COASONIX_RUNTIME_WORKER
one of:
  COASONIX_REASONIX_COMMAND_JSON
  COASONIX_REASONIX_COMMAND
```

Optional:

```text
COASONIX_RUNTIME_REQUEST_TIMEOUT_MS = 2000
COASONIX_REASONIX_TIMEOUT_MS = 10000
```

Rules:

```text
fail startup if required config is missing
resolve paths to absolute paths before runtime.initialize
do not create fallback repo roots silently
do not infer schema path from cwd unless an explicit dev-mode test helper does it
split COASONIX_REASONIX_COMMAND into argv with a structured parser or require JSON argv
prefer JSON argv if quoting becomes ambiguous on Windows
```

Recommended command format:

```text
COASONIX_REASONIX_COMMAND_JSON=["reasonix","review-diff"]
```

If both string and JSON forms exist, JSON wins. Do not execute through a shell.
If the string form is retained, parse it only into argv tokens and reject
ambiguous quoting instead of falling back to shell execution.

### Initialization Lifecycle

Server startup:

```text
1. load and validate config
2. construct RuntimeWorkerClient({ command: [COASONIX_RUNTIME_WORKER], requestTimeoutMs })
3. call runtime.initialize with repo_root, schema_path, reasonix_executable
4. construct ReasonixProcessRunner with configured argv and timeout
5. construct createReasonixToolsAdapter({ initialized: true, runtime, reasonix })
6. start MCP stdio transport
7. serve tools/list and tools/call
```

Important boundary:

```text
initialized: true is allowed only after runtime.initialize returns success.
```

If `runtime.initialize` fails:

```text
do not start serving tools/call
emit a startup error on stderr
exit nonzero
attempt RuntimeWorkerClient.shutdown() if the worker process was started
```

### Runtime Lifecycle

During MCP operation:

```text
tools/list delegates to listTools()
tools/call delegates to adapter.callTool()
server never calls Reasonix directly
server never interprets allow/deny directly
server never writes .agent state directly
worker client restart remains an explicit future operation, not automatic retry
```

On shutdown:

```text
handle normal MCP transport close
handle SIGINT and SIGTERM
call RuntimeWorkerClient.shutdown()
wait for shutdown or timeout
then exit
make shutdown idempotent
avoid writing protocol data to stdout after transport close
```

On uncaught fatal error:

```text
attempt RuntimeWorkerClient.shutdown()
write diagnostic text to stderr only
exit nonzero
```

### MCP Method Mapping

The server shell should map only these MCP surfaces:

```text
initialize / initialized lifecycle from the MCP SDK or equivalent stdio server
tools/list -> listTools()
tools/call -> adapter.callTool()
```

Do not expose resource, prompt, sampling, logging, patch, or approval surfaces in
this slice.

### Test Plan

Add server-level tests before implementation:

```text
missing required config exits nonzero and does not serve tools
startup calls runtime.initialize exactly once before tools/call can run
runtime.initialize failure exits nonzero and does not invoke Reasonix
tools/list over MCP stdio exposes only reasonix.review_diff
tools/call over MCP stdio returns structuredContent for valid mock output
tools/call deny path does not invoke mock Reasonix
tools/call malformed output returns isError without structuredContent
SIGTERM or transport close calls runtime.shutdown
worker stderr never appears as MCP structuredContent
server stdout contains MCP protocol frames only
```

The most valuable end-to-end test should use:

```text
real Bun server process
real Rust runtime worker process
mock Reasonix process
temporary repo root with .agent/diffs/current.diff
real schemas/coasonix-v1.schema.json
```

### Acceptance Gate

This slice is complete when:

```text
bun run packages/reasonix-expert-mcp/src/index.ts starts a stdio MCP server
tools/list works through the real server process
tools/call reasonix.review_diff works through the real server process
runtime.initialize is required before any tool side effect
runtime.shutdown runs on server shutdown
all existing v1 tests still pass
new server lifecycle tests pass
```

Current review status:

```text
TDD red/green completed for server lifecycle tests.
External code-reviewer subagent was attempted but failed with upstream 402.
Local detailed review checked startup config, Rust initialization before tools,
configured Reasonix argv propagation, deny/no-side-effect behavior, stdout
protocol cleanliness, and transport-close shutdown.
No Critical or Important review findings remain in this slice.
```

Current server test evidence:

```text
bun test packages/reasonix-expert-mcp/src/mcp/server.test.ts
  missing config exits nonzero without stdout protocol frames
  tools/list and tools/call work through the real server process
  runtime deny through the real server does not invoke mock Reasonix
  transport close exits the server process cleanly
```

## M10: Official MCP SDK Client Compatibility

The server is verified against `@modelcontextprotocol/sdk@1.29.0` as a
dev-only test dependency. This confirms that the local stdio server is not only
an internal JSON-RPC harness: the SDK `Client` can connect via
`StdioClientTransport`, list `reasonix.review_diff`, and call it through the
Rust-gated path.

The tool definition keeps the canonical schema reference while also declaring
the JSON Schema object type required by the SDK client:

```text
inputSchema:
  type: object
  $ref: https://coasonix.local/schemas/coasonix-v1.schema.json#/$defs/review_diff_input_v1
```

Review status for this slice:

```text
TDD red: SDK client test initially failed because tools/list returned an
inputSchema with only $ref and no object type.
Fix: add type: object while preserving the schema registry $ref.
Local review checked that SDK remains a dev-only test dependency and does not
enter the runtime server path.
No Critical or Important review findings remain in this slice.
```

Run before closing the slice:

```text
cargo test --workspace
bun test
python -m json.tool schemas/coasonix-v1.schema.json > $null
cargo fmt --all -- --check
git diff --check
```

## Implementation Principle

The MCP server shell must preserve the v1 invariant:

```text
Every Reasonix-related side effect crosses Rust Runtime schema/state/policy/audit
gates before execution, and every Reasonix result crosses Rust schema validation
before it becomes MCP structuredContent for Codex.
```

If the server makes `reasonix.review_diff` easier to call while weakening that
invariant, the slice is invalid.
