# Roadmap: from MVP to real agent-to-agent delegation

This document records what stands between the current v1 MVP and a fully
operational system where Codex delegates tasks and Reasonix executes them.

Last updated: 2026-07-06.

---

## What is Done

```text
MCP server stdio lifecycle                 implemented (mcp/server.ts)
reasonix.review_diff tool registration     implemented (mcp/tools/review-diff.ts)
Pluggable tool handler architecture        implemented (strategy pattern)
Multi-operation PolicyEngine registry      implemented (policy/mod.rs)
Rust pre-Reasonix runtime gate             implemented (kernel/mod.rs)
  - State engine (Created->Running->Completed/Failed)
  - Policy engine (operation, permission, path, argv, network)
  - Artifact policy (path allowlist/denylist, glob matching)
  - SQLite append-only audit (10 tables, WAL, FK, triggers)
  - JSON Schema validation + duplicate-key detection
  - Canonical JSON/path normalization
Rust JSON-RPC stdio Runtime Worker         implemented (4 methods)
TypeScript Runtime Worker client           implemented (RuntimeWorkerClient.ts)
Mock Reasonix runner                       implemented (MockRunner.ts)
Real Reasonix ACP runner                   implemented (ReasonixRunner.ts)
  - ACPClient: JSON-RPC 2.0 NDJSON stdio
  - ACPSessionPool: session/new, session/prompt, notification collection
  - E2E tested: deepseek-v4-flash reviews diff with 3 findings in ~25s
ACP client (agent-to-agent protocol)       implemented (ACPClient.ts)
Codex MCP registration:                    verified (codex mcp add coagent)
Healthcheck:                               7/7 checks pass
Error taxonomy:                            14 codes across 6 layers
Worker contract conformance:               implemented
docs: implementation status annotated      implemented
bun test:                                  82 pass, 0 fail, 1 skip
```

---

## Gap 1: Reasonix Exists and Works (DONE)

**Status**: Implemented. `ReasonixRunner` connects to real Reasonix via ACP
protocol. Verified E2E with deepseek-v4-flash: Reasonix reads diff files,
produces structured findings with severity/category/evidence/recommendation,
and returns confidence scores. Review quality is production-grade (PCI-DSS
aware, multi-severity, specific file/line references).

---

## Gap 2: Review Result Contract Still Carries Envelope Fields (P0)

**Current state**: The `review_result_v1` contract and mock worker output include
`schema_version`, `task_id`, `request_id`, `status` — fields that belong to
Coagent wrapper metadata.

**What is needed**: Remove these envelope fields from the Reasonix result
contract. Track `task_id`/`request_id` internally in the adapter. Reasonix
output should be pure review data: `verdict`, `summary`, `findings[]`,
`tests_to_run[]`, `risks[]`, `assumptions[]`, `confidence`.

Tracked in: `docs/implementation/review-diff-agent-collaboration-plan.md` Task 2.

---

## Gap 3: No Context Projection (P1)

**Current state**: MCP tool arguments pass directly to Reasonix as task input.
There is no redaction, no compression, no secret filtering, no projection
hashing.

---

## Gap 4: No Real CI / Test Integration (P1)

**Current state**: The system operates on static diff files. No CI integration.

---

## Gap 5: No Patch Generation or Application (P1)

**Current state**: Only `reasonix.review_diff` is exposed. Design specs exist
in `docs/coasonix/04-patch-and-verification/`. Code does not exist.

---

## Gap 6: No Cache Reuse (P2)

**Current state**: `cache_entries` SQLite table exists but `reuse_enabled` always 0.

---

## Gap 7: No Observability Beyond SQLite Audit (P2)

**Current state**: Only append-only `audit_events` table. No metrics, tracing,
or SLO thresholds.

---

## Gap 8: No Human Approval Gate (P2)

**Current state**: No approval flow. Design spec exists.

---

## Gap 9: No Verification Gate (P1)

**Current state**: No structured verification gate. Design spec exists.

---

## Gap 10: No Multi-Project / Session Routing (P2)

**Current state**: Each `tools/call` is independent. No Project Controller
or session lane routing.

---

## Summary

```text
DONE:                           Gap 1 (real Reasonix via ACP)
P0 (blocks clean contract):     Gap 2 (pure review result)
P1 (blocks production):         Gap 3 (context projection), Gap 4 (CI),
                                 Gap 5 (patch), Gap 9 (verification gate)
P2 (quality/scale):             Gap 6 (cache), Gap 7 (observability),
                                 Gap 8 (approval), Gap 10 (routing)
```
