# Coagent Architecture: Roles and Boundaries

Coagent coordinates two agent systems:

```text
Codex   = primary controller and final decision maker
Reasonix = delegated expert agent system
Coagent = safe collaboration boundary between them
```

The architecture is not Codex and Reasonix chatting as peers. Codex assigns a
bounded task. Reasonix completes that task. Coagent controls the protocol,
runtime gate, and audit boundary.

## Core Chain

```text
User asks Codex
-> Codex decides whether Reasonix review is useful
-> Codex calls reasonix.review_diff through MCP
-> Coagent validates and gates the request
-> Reasonix performs the diff review
-> Coagent wraps the review result for MCP
-> Codex evaluates the review and decides the next step
```

## Responsibilities

### Codex

Codex owns:

```text
user intent
planning
workspace edits
command execution
test execution
final decision
final user response
```

Codex may use Reasonix as an expert reviewer. Codex must not let Reasonix own
workspace mutation, policy decisions, or final completion claims.

### Coagent

Coagent owns:

```text
MCP tool definition
request normalization
runtime allow/deny decision path
path / argv / network policy
audit
backend process isolation
error taxonomy
MCP result wrapping
```

Coagent may maintain internal ids, audit records, backend diagnostics, and
runtime decisions. Those details are not Reasonix answer.

### Reasonix

Reasonix owns the delegated expert task only. For `reasonix.review_diff`, that
means:

```text
review the diff
identify findings
summarize risk
recommend tests or fixes
state confidence
```

Reasonix must not return Coagent runtime status, backend logs, schema validation
payloads, MCP metadata, or routing ids as part of the review result.

## Current v1 Scope

Only this tool is in scope:

```text
reasonix.review_diff
```

Out of scope until this tool is clean:

```text
reasonix.propose_patch
patch apply
approval UI
remote transport
network exceptions
additional Reasonix tools
```

## Target review_diff Result

The canonical review_diff contract is in
[03-reasonix/01-tool-contracts-and-wrapper.md](../03-reasonix/01-tool-contracts-and-wrapper.md).

Reasonix target output is review data only. Coagent wraps this in MCP
`structuredContent` and attaches internal metadata in MCP `_meta` or audit
records. The review payload itself stays pure.

## Implementation Status (updated 2026-07-06)

✅ Pure review result boundary: Reasonix backends return only semantic review
data. Coagent adapter wraps with `{ review, metadata }` in MCP
`structuredContent`. Identity check removed from adapter — Coagent owns
all internal tracking fields (task_id, request_id, status, runtime_decision).
Next target: Runtime lifecycle closure with `complete_operation` / `fail_operation`.


