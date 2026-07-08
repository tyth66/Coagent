# Coagent Mainline Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `coagent.review_diff` runtime path match its documented behavior for backend selection, context projection, lifecycle, and audit.

**Architecture:** Keep the current Rust workspace and unified `RuntimeToolExecutor`. Fix wiring in the current path before adding new tools; leave approval/resume as a documented gap rather than adding a partial workflow.

**Tech Stack:** Rust 2024, `rmcp`, `tokio`, `rusqlite`, JSON Schema 2020-12.

## Global Constraints

- No new dependencies.
- Use tests before production edits.
- Preserve the single-binary MCP server model.
- Keep `coagent.review_diff` as the canonical tool.
- Do not implement a partial human approval workflow in this pass.

---

### Task 1: Backend Selection Wiring

**Files:**
- Modify: `crates/coagent-mcp-server/src/backends/backend_trait.rs`
- Modify: `crates/coagent-mcp-server/src/main.rs`
- Modify: `crates/coagent-mcp-server/src/pipeline/mod.rs`

**Interfaces:**
- Produces: `BackendRegistry::select_by_tag(...) -> Option<Arc<dyn AgentBackend>>`
- Produces: startup backend selection that respects `Config.backend_override`

- [ ] Write failing tests for `COAGENT_BACKEND=mock`, `COAGENT_BACKEND=reasonix`, and unset capability selection.
- [ ] Write failing test proving `RuntimeToolExecutor` records/invokes the registry-selected backend.
- [ ] Change registry storage to cloneable `Arc<dyn AgentBackend>`.
- [ ] Wire startup override into `main.rs`.
- [ ] Run targeted backend and pipeline tests.

### Task 2: Review Result Metadata and Lifecycle

**Files:**
- Modify: `crates/coagent-mcp-server/src/pipeline/mod.rs`
- Modify: `crates/coagent-mcp-server/src/tools/review_diff.rs`
- Modify: `crates/coagent-mcp-server/src/main.rs`

**Interfaces:**
- Produces: wrapper builder receives resolved `task_id` and `request_id`
- Produces: optional complete-task-on-success lifecycle policy

- [ ] Write failing test showing success metadata contains resolved IDs.
- [ ] Write failing test showing single-operation review tasks can complete terminally.
- [ ] Change wrapper builder signature to accept resolved IDs.
- [ ] Add lifecycle policy to executor context and complete task on success for review.
- [ ] Run targeted MCP server tests.

### Task 3: ACP Context and Session Path

**Files:**
- Modify: `crates/coagent-mcp-server/src/backends/acp_backend.rs`
- Modify: `crates/coagent-mcp-server/src/backends/context.rs`
- Modify: `crates/coagent-mcp-server/src/backends/acp_client.rs`

**Interfaces:**
- Produces: `ContextProjection::from_backend_context(...)`
- Produces: prompt rendering that includes focus, constraints, logs, and branches
- Produces: ACP subprocess env filtering

- [ ] Write failing test that rendered backend prompt contains the full context projection.
- [ ] Route `AcpBackend` through persistent `ReasonixRunner` for review requests.
- [ ] Add sandbox env filtering to `AcpClient::connect`.
- [ ] Run backend tests.

### Task 4: Schema Audit and Documentation

**Files:**
- Modify: `crates/coagent-runtime-core/src/kernel/mod.rs`
- Modify: `crates/coagent-mcp-server/src/pipeline/mod.rs`
- Modify: `README.md`
- Modify: `docs/coagent/architecture/01-runtime.md`
- Modify: `docs/coagent/architecture/02-mcp-server.md`

**Interfaces:**
- Produces: schema validation records for input, output, and wrapper stages

- [ ] Write failing test for successful schema validation rows.
- [ ] Add kernel API to record schema validation with audit.
- [ ] Call it from pipeline for validation stages.
- [ ] Update stale docs: 9-state FSM, backend override, alias status, approval/resume gap.
- [ ] Run `cargo fmt`, targeted tests, and workspace tests.
