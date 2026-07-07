# MCP Server (rmcp) — v2.1

The MCP server is built with `rmcp` (official Rust MCP SDK, 14.7M downloads).

## Tool Definition (declarative, ~30 lines)

```rust
#[tool_router]
impl CoagentServer {
    #[tool(name = "reasonix.review_diff", description = "...")]
    async fn review_diff(
        &self,
        Parameters(input): Parameters<ReviewDiffInput>,
    ) -> Result<CallToolResult, ErrorData> {
        let artifact_paths = ArtifactPaths::collect_read(&input.artifacts.diff_path, &[...]);
        let context = ContextProjection::from_input(/* 9 fields */);
        let goal = input.goal.clone();
        let diff_path = input.artifacts.diff_path.clone();

        self.executor.execute(
            input.task_id, input.request_id, &input, artifact_paths,
            |backend| async move { /* backend call */ },
            |review| review.validate().map_err(ValidationError::from),
            |review| CoagentReviewWrapper { review, metadata: ... },
        ).await
    }
}
```

## Pipeline Stages (RuntimeToolExecutor)

```
1. Validate input schema   → SchemaRegistry, audit on failure
2. Generate/enforce IDs    → UUID or COAGENT_REQUIRE_EXTERNAL_IDS
3. Runtime gate            → evaluate_operation (Allow/Deny/RequireApproval)
4. Invoke backend          → Mock | Reasonix ACP (with session recovery)
5. Validate output         → Finding-level + SchemaRegistry, audit on failure
6. Validate wrapper schema → SchemaRegistry, audit on failure
7. Complete lifecycle      → complete_operation (close step, task stays alive)
8. Serialize response      → MCP CallToolResult JSON
```

Each stage writes audit events on failure. Schema validation failures at
stages 1, 5, and 6 all produce `audit_events` records with task_id,
request_id, expected_schema, and errors[].

## Backend Pluggability

```rust
enum Backend {
    Mock,                        // PureReviewResult::mock_pass()
    Reasonix(ReasonixRunner),   // ACP → subprocess → DeepSeek, session recovery
}
```

`COAGENT_BACKEND=mock|reasonix` overrides the registered tool's backend binding.

## Reasonix ACP Session Recovery

The `ReasonixRunner` implements automatic reconnect + retry:

```
send_prompt() → Ok → return result
send_prompt() → Err(Io|Protocol) → drop session → reconnect → retry same prompt
send_prompt() → Err(Spawn|Timeout) → propagate immediately
```

This ensures a single Reasonix child process crash does not permanently
disable the Coagent server.

## Context Projection

`ContextProjection` captures all `ReviewDiffInput` fields (goal, diff_path,
context_path, test_log_path, build_log_path, focus, constraints, base_branch,
working_branch) and renders them as a structured prompt section for Reasonix.

## Finding Type Safety

`Finding` struct with `Severity` enum (`Blocker|Major|Minor|Note`).
`PureReviewResult::validate()` checks per-finding: issue non-empty,
category non-empty, confidence 0.0-1.0. JSON Schema provides second-layer
enum value enforcement.

## Schema Authority

`SchemaRegistry` is the single validation authority (JSON Schema 2020-12).
Embedded `schemas/coagent-v1.schema.json` defines:

- `review_diff_input_v1` — MCP request schema
- `pure_review_result_v1` — Reasonix output schema
- `coagent_review_wrapper_v1` — Coagent wrapped response

## ID Orchestration

`COAGENT_REQUIRE_EXTERNAL_IDS=true` forces callers to provide both `task_id`
and `request_id`. Pipeline returns `invalid_params` if missing. Default
`false` preserves backward compatibility with auto-generated UUIDs.

## Deployment

```powershell
cargo build --release -p coagent-mcp-server

codex mcp add coagent `
  --env COAGENT_REPO_ROOT=D:\your-repo `
  --env COAGENT_BACKEND=mock `
  -- D:\Coagent\target\release\coagent-mcp-server.exe
```