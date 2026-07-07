# Coagent v3 Blueprint (COMPLETE — all 5 phases implemented)

Coagent v3 upgrades from a Reasonix-specific adapter to a general-purpose
multi-agent ACP runtime. All 5 phases are implemented and tested.

## Implementation Progress

| Phase | Scope | Commit |
|-------|-------|--------|
| Phase 1 | `AgentBackend` trait, `BackendRegistry`, `AcpBackend`, `MockBackend` | ad279fe |
| Phase 2 | `ToolSpec` declarative registration, `ToolSpecRegistry` | 44d98b6 |
| Phase 3 | Pipeline wired to `Arc<dyn AgentBackend>` | 934c6c1 |
| Phase 4 | `operation_attempts` table, `AttemptState`, 3-layer kernel API | ea56018 |
| Phase 5 | `BackendSelector` trait, capability-based backend selection | ad4c7cc |

## Architecture

```
Codex MCP Host
  -> coagent-mcp-server (~5 MB)
      ├── Pipeline         RuntimeToolExecutor 8-stage unified execution
      ├── ToolRegistry     ToolSpec-based declarative registration
      ├── RuntimeKernel    10-state FSM + per-operation steps + attempt layer
      ├── BackendRegistry  AgentBackend trait + capability-based selection
      └── BackendSelector  DefaultBackendSelector / PreferredBackendSelector
```

## Core Abstractions

| Abstraction | Status | Description |
|-------------|--------|-------------|
| AgentBackend trait | ✅ | `invoke(BackendRequest) -> BackendResponse` |
| BackendRegistry | ✅ | Multi-backend registration with capability tags |
| ToolSpec | ✅ | Declarative tool definition (coagent.review_diff) |
| RuntimeToolExecutor | ✅ | 8-stage unified pipeline |
| Task/Operation/Attempt | ✅ | 3-layer state with operation_attempts table |
| BackendSelector | ✅ | Capability-based and preferred/fallback selection |
| Schema audit | ✅ | All 3 pipeline stages write audit records |
| ACP session recovery | ✅ | Reconnect + retry on Io/Protocol errors |