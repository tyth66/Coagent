# Coagent Collaboration Model (v3)

Coagent is a local multi-agent ACP runtime layer between Codex and external
intelligent agents. It owns tool registration, task/operation/attempt state,
permission gating, context projection, ACP session management, backend
selection, audit, and recovery.

```
Codex    = assigns work, selects tools, makes final decisions
Coagent  = tool registration, runtime gating, backend selection,
           context projection, audit, session recovery
Backend  = ACP-compatible agent (Reasonix, Mock, or any ACP agent)
           that executes delegated expert tasks
```

## Architecture

```
Codex MCP Host
  -> coagent-mcp-server.exe (Rust, ~5 MB)
      ├── Pipeline         RuntimeToolExecutor — 8-stage unified execution
      ├── ToolRegistry     ToolSpec-based declarative tool registration
      ├── RuntimeKernel    same-process state machine + policy engine + SQLite audit
      │   ├── 9-state FSM queued/running/blocked/waiting-approval/retrying/
      │   │               partially-completed/completed/failed/cancelled
      │   ├── Per-operation steps (multi-op tasks via complete_task())
      │   ├── operation_attempts table (3-layer task/operation/attempt)
      │   ├── PolicyEngine dynamic ToolRegistry + approval gates + path sandbox
      │   ├── ContextProjection full input-to-prompt projection (9 fields)
      │   └── Audit SQLite 13 tables, WAL, append-only, schema audit on all stages
      ├── BackendRegistry  AgentBackend trait + capability-based selection
      │   ├── AcpBackend   Reasonix ACP (session recovery: reconnect+retry)
      │   └── MockBackend  instant pass review
      └── BackendSelector  DefaultBackendSelector / PreferredBackendSelector
```

## Role Boundaries

### Codex
- Owns user intent, planning, workspace changes, final decision
- Calls `coagent.review_diff` through MCP but owns the workflow

### Coagent
- MCP tool surface: `coagent.review_diff`
- Pipeline: schema validation → ID enforcement → runtime gate →
  backend selection → backend invoke → output validation → lifecycle close
- Runtime state: task/operation/attempt 3-layer FSM
- Policy engine: operation, permission, approval, path sandbox
- SQLite append-only audit on all pipeline stages
- Context projection from MCP input to backend prompt
- ACP session management with reconnect+retry

### Backend
- Implements `AgentBackend` trait: `invoke(BackendRequest) → BackendResponse`
- Must return structured, schema-validated responses
- Must NOT return Coagent runtime metadata

## Current Scope

One MCP tool: `coagent.review_diff`

Multi-backend, multi-tool, and multi-session patterns are designed
(via AgentBackend trait, ToolSpec, BackendRegistry) and ready for
expansion — adding a new tool requires only a `ToolSpec` definition.
