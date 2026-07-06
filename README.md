# Coagent

Coagent connects two agent systems without merging their responsibilities:

```text
Codex   = assigns work and makes the final decision
Coagent = performs safe protocol translation, runtime gating, and audit
Reasonix = completes the delegated expert task
Codex   = evaluates the result and decides the next step
```

Start here:

1. [Collaboration Model](docs/coasonix/00-collaboration-model.md)
2. [Executive Summary / Status](docs/coasonix/00-executive-summary.md)
3. [Documentation Index](docs/coasonix/README.md)
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
  -> TypeScript reasonix-expert MCP Adapter (packages/reasonix-expert-mcp)
      -> managed Rust Runtime Worker (crates/coagent-runtime-worker)
          -> Rust Runtime Core (crates/coagent-runtime-core)
      -> Backend (pluggable)
          -> MockRunner     — hardcoded echo worker for testing
          -> ReasonixRunner — ACP protocol -> real Reasonix (DeepSeek models)
```

The TypeScript adapter handles MCP protocol (initialize, tools/list, tools/call).
Before delegating to Reasonix, the adapter calls the Rust Runtime Worker over
JSON-RPC 2.0 stdio. The Runtime Core evaluates state and policy gates.
Only on `allow` does the adapter invoke the backend. SQLite stores append-only
audit records under `.agent/coagent.sqlite`.

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
pure Reasonix review-only result contract:  active transition
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
| Product model | `docs/coasonix/00-collaboration-model.md` | Codex / Coagent / Reasonix decision chain |
| Current status | `docs/coasonix/00-executive-summary.md` | Implemented vs planned vs out-of-scope |
| Active plan | `docs/implementation/review-diff-agent-collaboration-plan.md` | Current review_diff refactoring plan |
| Architecture | `docs/coasonix/01-architecture/` | Roles, MCP communication, context architecture |
| Runtime (implemented) | `docs/coasonix/02-runtime/` | Coagent internal safety gates |
| Reasonix contract | `docs/coasonix/03-reasonix/` | Reasonix task input/output boundaries |
| Design specs (post-v1) | `docs/coasonix/04-patch-and-verification/`, `05-versioning/` | Future gate designs |
| Historical roadmap | `docs/coasonix/06-roadmap/` | Design evolution; not the current status |
| Implementation history | `docs/implementation/v1-mvp-execution-plan.md` | Historical milestone reference |
| Gap analysis | `docs/implementation/gaps-to-production.md` | From MVP to production |

## Verification

```powershell
cargo test --workspace        # Rust Runtime Core + Worker: all pass
bun test                      # TypeScript adapter: 82 pass, 1 skip, 0 fail
python -m json.tool schemas/coagent-v1.schema.json > $null
cargo fmt --all -- --check
```
