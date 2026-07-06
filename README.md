# Coagent

Coagent connects two agent systems without merging their responsibilities:

```text
Codex   = assigns work and makes the final decision
Coagent = performs safe protocol translation, runtime gating, and audit
Reasonix = completes the delegated expert task
Codex   = evaluates the result and decides the next step
```

Start here:

1. [Collaboration Model](docs/coagent/00-collaboration-model.md)
2. [Executive Summary / Status](docs/coagent/00-executive-summary.md)
3. [Documentation Index](docs/coagent/README.md)
4. [Active Forward Plan](docs/implementation/review-diff-agent-collaboration-plan.md)

## Current Focus

The project is intentionally narrowed to one tool:

```text
reasonix.review_diff
```

For this tool, Codex delegates a diff review task to Reasonix. Reasonix should
return review information only: verdict, summary, findings, suggested tests,
risks, assumptions, and confidence. Coagent keeps runtime decisions, backend
status, audit ids, task routing, and protocol metadata internal.

## Architecture

```text
Codex MCP Host
  -> coagent-mcp-server.exe (Rust, ~5 MB, single binary)
      ├── rmcp (MCP protocol: initialize, tools/list, tools/call)
      ├── RuntimeKernel (same-process: evaluate, complete, fail)
      │     └── SQLite audit (.agent/coagent.sqlite)
      └── Backend (pluggable)
            ├── Mock        — returns mock review result
            └── Reasonix    — ACP protocol -> real Reasonix (DeepSeek models)
```

The new Rust MCP server (`crates/coagent-mcp-server`) replaces the TypeScript
adapter. It uses `rmcp` (official Rust MCP SDK, 14.7M downloads) for MCP protocol
handling, and calls `coagent-runtime-core` directly in-process — no JSON-RPC
subprocess. The TypeScript adapter (`packages/reasonix-expert-mcp`) is deprecated
and will be removed in a future release.

Two distributions available:
- **Rust binary**: `cargo build --release -p coagent-mcp-server` → single `.exe`
- **Node**: `node dist/index.js` (TypeScript adapter, legacy)

## Implementation Status

```text
MCP setup / registration:                   implemented
MCP server stdio startup:                   implemented
inline tools/list inputSchema:              implemented
Pluggable tool handler architecture:        implemented (strategy pattern)
Multi-operation PolicyEngine registry:      implemented
Rust pre-Reasonix runtime gate:             implemented
  - State engine (Created->Running->Completed/Failed)
  - Policy engine (operation, permission, path, argv, network)
  - SQLite append-only audit (10 tables, WAL, FK, triggers)
  - JSON Schema validation + duplicate-key detection
  - Artifact policy (path allowlist/denylist with glob matching)
Rust JSON-RPC stdio Runtime Worker:         implemented (4 methods)
TypeScript Runtime Worker client:           implemented
Mock Reasonix runner:                       implemented
Real Reasonix runner (ACP protocol):        implemented — E2E tested with deepseek-v4-flash
ACP client (session pool, stdio NDJSON):    implemented
Codex MCP registration:                     verified (codex mcp add coagent)
Healthcheck:                                7/7 checks pass
Error taxonomy:                             14 codes across 6 layers
Worker contract conformance:                implemented
Pure review result boundary:                implemented (Reasonix returns semantic-only; Coagent wraps)
Runtime lifecycle closure:                  implemented (same-process complete/fail in Rust MCP server)
Rust MCP server (rmcp):                     implemented (full tool pipeline, replaces TypeScript adapter)
TypeScript adapter:                          deprecated (kept for backward compatibility)
patch / approval / autonomous write path:   out of scope
```

## Quick Start

Register Coagent as a Codex MCP server (mock backend, for testing):

```powershell
bun run setup:codex-mcp --target-repo D:\path\to\target-repo
Or manually (mock backend):

```powershell
$env:COAGENT_REPO_ROOT = "D:\path\to\target-repo"
$env:COAGENT_RUNTIME_WORKER = "D:\Coagent\target\debug\coagent-runtime-worker.exe"
$env:COAGENT_AGENT_COMMAND_JSON = '["D:\\Coagent\\bin\\coasonix-mock-worker.cmd","review-diff"]'
bun run --silent --cwd=packages/reasonix-expert-mcp start:mcp
```
```

Register with real Reasonix backend:

```powershell
codex mcp add coagent `
  --env COAGENT_REPO_ROOT=D:\path\to\target-repo `
  --env COAGENT_RUNTIME_WORKER=D:\Coagent\target\debug\coagent-runtime-worker.exe `
  --env COAGENT_BACKEND=reasonix `
  --env COAGENT_REASONIX_MODEL=deepseek-v4-flash `
  --env COAGENT_AGENT_TIMEOUT_MS=180000 `
  -- bun run --silent --cwd=packages/reasonix-expert-mcp start:mcp
```

Run healthcheck:

```powershell
bun run health:codex-mcp --target-repo D:\path\to\target-repo
```

## Documentation Layers

| Layer | Path | Purpose |
|---|---|---|
| Product model | `docs/coagent/00-collaboration-model.md` | Codex / Coagent / Reasonix decision chain |
| Current status | `docs/coagent/00-executive-summary.md` | Implemented vs planned vs out-of-scope |
| Active plan | `docs/implementation/review-diff-agent-collaboration-plan.md` | Current review_diff refactoring plan |
| Architecture | `docs/coagent/01-architecture/` | Roles, MCP communication, context architecture |
| Runtime (implemented) | `docs/coagent/02-runtime/` | Coagent internal safety gates |
| Reasonix contract | `docs/coagent/03-reasonix/` | Reasonix task input/output boundaries |
| Design specs (post-v1) | `docs/coagent/04-patch-and-verification/`, `05-versioning/` | Future gate designs |
| Historical roadmap | `docs/coagent/06-roadmap/` | Design evolution; not the current status |
| Implementation history | `docs/implementation/v1-mvp-execution-plan.md` | Historical milestone reference |
| Gap analysis | `docs/implementation/gaps-to-production.md` | From MVP to production |

## Verification

```powershell
cargo test --workspace        # Rust: 62 pass (runtime-core, runtime-worker, mcp-server)
bun test                      # TypeScript adapter: 82 pass, 1 skip, 0 fail
python -m json.tool schemas/coagent-v1.schema.json > $null
cargo fmt --all -- --check

# Smoke test the Rust MCP server
$env:COAGENT_REPO_ROOT = (Get-Location)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | `
  cargo run -p coagent-mcp-server
```





