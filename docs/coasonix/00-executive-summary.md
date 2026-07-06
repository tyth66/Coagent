# Executive Summary
The current implemented state and forward plan.

```text
Codex   = assigns tasks, owns workspace execution, and makes final decisions
Coagent = safely translates protocol, gates side effects, and records audit evidence
Reasonix = performs the delegated expert task
Codex   = consumes the result and decides what to do next
```

## Current Product Boundary

One tool only:

```text
reasonix.review_diff
```

The intended behavior is simple:

```text
Codex asks for a diff review
Coagent checks whether the call is safe and well-formed
Reasonix reviews the diff and returns only review information
Codex decides whether to act on that review
```

Reasonix must not return Coagent runtime state, schema validation payloads,
worker diagnostics, backend profile data, task routing metadata, or MCP
transport details. Those are Coagent internals.

## Architecture

```text
Codex MCP Host
  -> TypeScript reasonix-expert MCP Adapter (packages/reasonix-expert-mcp)
      -> managed Rust Runtime Worker (crates/coagent-runtime-worker)
          -> Rust Runtime Core (crates/coagent-runtime-core)
      -> Backend (pluggable)
          -> MockRunner     — for testing
          -> ReasonixRunner — ACP protocol -> real Reasonix + DeepSeek models
```

Two crates (Rust) + one package (TypeScript/Bun). The adapter calls the Rust
Runtime Worker over JSON-RPC 2.0 stdio before delegating to the backend.
SQLite stores append-only audit records under `.agent/coagent.sqlite`.

## Implementation Status

### Completed

```text
MCP registration/setup                   (codex/setup.ts, codex/health.ts)
MCP stdio server                         (mcp/server.ts)
inline tools/list inputSchema            (mcp/tools/review-diff.ts)
Pluggable tool handler architecture      (strategy pattern, mcp/adapter.ts)
Multi-operation PolicyEngine registry    (policy/mod.rs)
Rust pre-Reasonix runtime gate           (crates/coagent-runtime-core)
  - State engine (Created -> Running -> Completed/Failed)
  - Policy engine (operation, permission, path, argv, network)
  - Artifact policy (path allowlist/denylist with glob matching)
  - SQLite append-only audit (10 tables, WAL, FK, triggers)
  - JSON Schema validation + duplicate-key detection
  - Canonical JSON/path normalization
Rust JSON-RPC stdio Runtime Worker       (4 methods)
TypeScript Runtime Worker client         (RuntimeWorkerClient.ts)
Mock Reasonix runner                     (MockRunner.ts)
Real Reasonix ACP runner                 (ReasonixRunner.ts -> ACPClient.ts)
  - ACP session pool with prompt/notification collection
  - E2E tested with deepseek-v4-flash: 3 findings in 25s
  - PCI-DSS aware, multi-severity findings
ACP client (stdio NDJSON JSON-RPC)       (ACPClient.ts + ACPSessionPool.ts)
Codex MCP integration:                   verified
  - Registered: codex mcp add coagent (mock + reasonix backends)
  - Healthcheck: 7/7 checks pass
Error taxonomy                           14 codes across 6 layers
Worker contract conformance              implemented
Backend profiles                         mock, conformance, reasonix-cli, mimocode-cli
```

### Active Transition

The current `review_result_v1` contract still includes system envelope fields
(`schema_version`, `task_id`, `request_id`, `status`) that belong in Coagent
wrapper metadata, not in Reasonix review answer.

### Out of Scope

```text
additional tools beyond review_diff
patch application / write autonomy
human approval UI
remote transport / HTTP / daemon
context projection
cache reuse (SQLite cache_entries table exists but reuse_enabled always 0)
performance/security/architecture review tools
```

## Verification

```powershell
cargo test --workspace        # all pass
bun test                      # 82 pass, 1 skip, 0 fail
python -m json.tool schemas/coagent-v1.schema.json > $null
cargo fmt --all -- --check
```
