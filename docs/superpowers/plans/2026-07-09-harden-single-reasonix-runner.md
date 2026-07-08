# Harden Single ReasonixRunner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current single `ReasonixRunner` lane provably durable, serial, recoverable, and prompt-complete.

**Architecture:** Keep `coagent.review_diff -> AcpBackend -> ReasonixRunner -> AcpSession` as one single-session lane. Add deterministic fake-ACP tests for session reuse, reconnect retry, timeout cleanup, and prompt projection, then make the minimal runner changes needed to pass them.

**Tech Stack:** Rust 2024, Tokio async tests, fake Reasonix ACP subprocess scripts, existing `ReasonixRunner` and `ContextProjection`.

## Global Constraints

- No multi-tool work.
- No session pool or `SessionKey` manager.
- No new dependencies.
- Use TDD: every behavior change starts with a failing test.
- Keep `ReasonixRunner` intentionally single-session and serial.

---

### Task 1: Prove Persistent Session Reuse

**Files:**
- Modify: `crates/coagent-mcp-server/src/backends/reasonix.rs`

**Interfaces:**
- Consumes: `ReasonixRunner::run(goal, diff_path, context) -> Result<PureReviewResult, ReasonixError>`
- Produces: fake-ACP test showing one process/session handles two prompts.

- [x] Add fake ACP script support for counting initialize/session/prompt events.
- [x] Write `reasonix_runner_reuses_one_session_for_multiple_prompts`.
- [x] Run the test and verify it fails before implementation if needed.
- [x] Make minimal helper changes until it passes.

### Task 2: Prove Reconnect Retry

**Files:**
- Modify: `crates/coagent-mcp-server/src/backends/reasonix.rs`

**Interfaces:**
- Consumes: recoverable `ReasonixError::Io | ReasonixError::Protocol`
- Produces: retry-once behavior with a fresh fake ACP process.

- [x] Add fake ACP case that closes stdout on the first prompt and succeeds after reconnect.
- [x] Write `reasonix_runner_reconnects_and_retries_after_protocol_eof`.
- [x] Run the test and verify expected failure before implementation if needed.
- [x] Keep retry limited to one reconnect.

### Task 3: Drop Session On Timeout

**Files:**
- Modify: `crates/coagent-mcp-server/src/backends/reasonix.rs`

**Interfaces:**
- Produces: `ReasonixError::should_drop_session() -> bool`
- Produces: `ReasonixError::is_retryable() -> bool`

- [x] Write `reasonix_runner_drops_timed_out_session_without_retry`.
- [x] Run it and verify it fails while timeout leaves stale session.
- [x] Change `ReasonixRunner::run()` so timeout drops the session and returns timeout without retry.

### Task 4: Lock Prompt Projection

**Files:**
- Modify: `crates/coagent-mcp-server/src/backends/reasonix.rs`

**Interfaces:**
- Consumes: `ContextProjection::render_context_section()`
- Produces: fake-ACP captured prompt with all review context fields.

- [x] Write `reasonix_prompt_includes_full_review_context`.
- [x] Assert goal, diff path, context path, test log, build log, branches, focus, and constraints are present.
- [x] Keep prompt format stable enough for Reasonix cache behavior.

### Task 5: Document Single-Session Serial Semantics And Errors

**Files:**
- Modify: `crates/coagent-mcp-server/src/backends/reasonix.rs`
- Modify: `docs/coagent/architecture/01-runtime.md`
- Modify: `docs/coagent/architecture/02-mcp-server.md`

**Interfaces:**
- Produces: explicit docs that the same runner serializes concurrent calls through one mutex-protected ACP session.
- Produces: clearer spawn/initialize/session error text.

- [x] Update comments/docs for serial single-session semantics.
- [x] Improve Reasonix executable-not-found and ACP phase error messages.
- [x] Run full verification.
