# v1 MVP Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Coasonix v1 MVP from `docs/coasonix/06-roadmap/07-v1-implementation-blueprint.md`, starting with the Rust-gated runtime core and ending at the mock `reasonix.review_diff` vertical slice.

**Architecture:** Rust owns enforceable schema, canonicalization, state, policy, audit, locks, and runtime decisions. TypeScript owns the MCP adapter and process supervision only, and it invokes Reasonix only after Rust returns `allow`.

**Tech Stack:** Rust 2024, Cargo workspace, Bun, TypeScript ESM, JSON-RPC 2.0 over stdio, JSON Schema 2020-12, SQLite.

**Current Status:** M0, M1, and M2 are implemented, reviewed, verified, and committed in separate local phases. Continue with M3 in a later execution pass.

---

## Source Boundaries

Project specifications live under:

```text
docs/coasonix/
```

Implementation plans and code-progress notes live under:

```text
docs/implementation/
```

Runtime source lives under:

```text
crates/
packages/
tests/
```

## Current Execution Scope

This execution pass covers:

```text
M0: repository scaffold
M1: Rust schema and canonicalization foundation
M2: Rust state, artifact path, shell, and minimum policy foundation
```

It intentionally does not implement MCP, real Reasonix invocation, patch
application, approval UI, remote HTTP, or post-v1 `reasonix.*` tools.

## Task 1: Scaffold Workspaces

**Files:**
- Create: `Cargo.toml`
- Create: `Cargo.lock`
- Create: `.gitignore`
- Create: `crates/coasonix-runtime-core/Cargo.toml`
- Create: `crates/coasonix-runtime-core/src/lib.rs`
- Create: `crates/coasonix-runtime-core/src/schema/mod.rs`
- Create: `crates/coasonix-runtime-core/src/canonical/mod.rs`
- Create: `crates/coasonix-runtime-worker/Cargo.toml`
- Create: `crates/coasonix-runtime-worker/src/main.rs`
- Create: `package.json`
- Create: `bun.lock`
- Create: `packages/reasonix-expert-mcp/package.json`
- Create: `packages/reasonix-expert-mcp/src/index.ts`

- [x] **Step 1: Write scaffold smoke tests**

Add minimal Rust and TypeScript tests that fail because the workspaces do not
exist yet:

```text
cargo test --workspace
bun test
```

Expected before scaffold: Cargo cannot find `Cargo.toml`; Bun has no test
workspace.

- [x] **Step 2: Create minimal workspace files**

Create a Rust workspace with `coasonix-runtime-core` and
`coasonix-runtime-worker`, plus a Bun workspace with `reasonix-expert-mcp`.

- [x] **Step 3: Run scaffold verification**

Run:

```text
cargo test --workspace
bun test
python -m json.tool schemas/coasonix-v1.schema.json
```

Expected: all commands exit 0.

## Task 2: Schema Registry and Duplicate-Key Rejection

**Files:**
- Modify: `crates/coasonix-runtime-core/src/lib.rs`
- Modify: `crates/coasonix-runtime-core/src/schema/mod.rs`
- Test: `crates/coasonix-runtime-core/tests/schema_registry.rs`

- [x] **Step 1: Write failing schema tests**

Test behaviors:

```text
schema registry loads schemas/coasonix-v1.schema.json
valid review_diff_input_v1 validates
valid review_result_v1 validates
valid error_result_v1 validates
runtime_decision_v1 validates
schema_validation_result_v1 validates
wrong schema_version fails
unknown expected schema fails closed
output_schema mismatch fails
unexpected top-level field fails
duplicate JSON key fails before schema validation
malformed JSON returns an error without panic
```

- [x] **Step 2: Verify tests fail**

Run:

```text
cargo test -p coasonix-runtime-core schema_registry -- --nocapture
```

Expected: tests fail because `SchemaRegistry` does not exist.

- [x] **Step 3: Implement minimal schema registry**

Implement:

```text
SchemaRegistry::load_from_path
SchemaRegistry::validate
parse_json_no_duplicate_keys
SchemaValidationResult
SchemaValidationError
```

- [x] **Step 4: Verify schema tests pass**

Run:

```text
cargo test -p coasonix-runtime-core schema_registry -- --nocapture
```

Expected: all schema registry tests pass.

## Task 3: Canonical JSON and Hashing

**Files:**
- Modify: `crates/coasonix-runtime-core/src/canonical/mod.rs`
- Test: `crates/coasonix-runtime-core/tests/canonical_json.rs`

- [x] **Step 1: Write failing canonicalization tests**

Test behaviors:

```text
object keys are sorted deterministically
equivalent object key order produces identical canonical_hash
different payload content produces different canonical_hash
arrays preserve order
non-finite numbers do not enter serde_json::Value
```

- [x] **Step 2: Verify tests fail**

Run:

```text
cargo test -p coasonix-runtime-core canonical_json -- --nocapture
```

Expected: tests fail because canonicalization functions do not exist.

- [x] **Step 3: Implement minimal canonicalization**

Implement:

```text
canonical_json
canonical_hash
```

Use SHA-256 and prefix hashes as `sha256:<hex>`.

- [x] **Step 4: Verify canonicalization tests pass**

Run:

```text
cargo test -p coasonix-runtime-core canonical_json -- --nocapture
```

Expected: all canonical JSON tests pass.

## Task 4: M0/M1 Review and Documentation Update

**Files:**
- Modify: `docs/implementation/v1-mvp-execution-plan.md`
- Modify if needed: `docs/coasonix/README.md`

- [x] **Step 1: Run full verification**

Run:

```text
cargo test --workspace
bun test
python -m json.tool schemas/coasonix-v1.schema.json
git status --short
```

- [x] **Step 2: Review M0/M1 against blueprint**

Check:

```text
M0 scaffold exists
M1 schema tests cover duplicate keys
M1 canonical tests cover stable hashes
no MCP or Reasonix integration was added early
project docs and implementation docs remain separated
```

- [x] **Step 3: Fix any review findings**

Do not proceed to M2 while Critical or Important review issues remain.

- [x] **Step 4: Update implementation plan checkboxes**

Mark only completed steps. Do not mark future milestones complete.

### M0/M1 Completion Record

Fresh verification after review fixes:

```text
cargo test --workspace
  coasonix-runtime-core: 1 smoke, 5 canonical, 13 schema registry tests passed
  coasonix-runtime-worker: 0 tests, binary scaffold compiled

bun test
  packages/reasonix-expert-mcp/src/index.test.ts passed

python -m json.tool schemas/coasonix-v1.schema.json > $null
  exited 0

cargo fmt --all -- --check
  exited 0
```

Review outcome:

```text
M0/M1 independent review initially requested changes for repository hygiene and
missing M1 schema coverage. Fixes added .gitignore, Cargo.lock, bun.lock,
expanded schema/canonical tests, and SchemaValidationResult::to_payload.
Re-review approved M0/M1 for documentation update and local commit.
```

Non-blocking notes:

```text
Worker rpc/lifecycle/dispatch source modules are deferred to M5.
Rust 2024 is selected by the blueprint; a rust-toolchain.toml can be added when
CI/MSRV policy is introduced.
```

## Task 5: State, Path, Shell, and Minimum Policy

**Files:**
- Create: `crates/coasonix-runtime-core/src/state/mod.rs`
- Create: `crates/coasonix-runtime-core/src/artifact/mod.rs`
- Create: `crates/coasonix-runtime-core/src/policy/mod.rs`
- Modify: `crates/coasonix-runtime-core/src/lib.rs`
- Test: `crates/coasonix-runtime-core/tests/state_machine.rs`
- Test: `crates/coasonix-runtime-core/tests/artifact_policy.rs`
- Test: `crates/coasonix-runtime-core/tests/policy_engine.rs`

- [x] **Step 1: Write failing M2 tests**

Test behaviors:

```text
illegal state transition denied
terminal state rejects mutation
completion blocked while required verification gaps exist
reasonix_calls increments only through runtime-owned decisions
denied path blocks before read
absolute path outside repo denied
.. traversal denied
symlink escape denied
Windows case-folded repo path remains repo-local
denylist beats allowlist
shell string rejected
argv substring bypass rejected
argv extra-argument bypass rejected
permission mismatch denied
network request denied by default
allowed review_diff policy records command hash
M2 minimum owned types are constructible
```

- [x] **Step 2: Verify tests fail**

Run:

```text
cargo test -p coasonix-runtime-core --tests -- --nocapture
```

Expected before implementation: tests fail because `state`, `artifact`, and
`policy` modules do not exist.

- [x] **Step 3: Implement minimal M2 runtime gates**

Implemented:

```text
TaskState
TaskStateValue
RuntimeOperationRequest
RuntimeDecision
PolicyEvaluationRequest
PolicyEvaluationResult
ResourceSet
PermissionLevel
RuntimeDecisionValue
RoutingMetadata
ArtifactPolicy
CommandInvocation
PolicyEngine::review_diff
```

The M2 implementation remains in memory only. SQLite persistence, audit rows,
RuntimeKernel composition, worker RPC, MCP adapter behavior, and Reasonix
invocation remain out of scope until later milestones.

- [x] **Step 4: Verify M2 tests pass**

Run:

```text
cargo test -p coasonix-runtime-core --tests -- --nocapture
```

Expected: all state, artifact, and policy tests pass.

- [x] **Step 5: Review M2 against blueprint**

Review checks:

```text
state machine blocks illegal and terminal transitions
required completion gaps block completion
reasonix call counter cannot be advanced by adapter-observed attempts
path policy rejects traversal, absolute outside paths, and symlink escapes
denylist is evaluated before allowlist
Windows case-folding bypass is covered
shell strings are rejected
argv[0], argv args, and extra argv bypasses are rejected structurally
network is denied by default
permission mismatch is denied
command hash is recorded for allowed argv
no M3+ SQLite/audit, worker, MCP, or Reasonix integration was added
```

- [x] **Step 6: Fix review findings**

Local review found and fixed:

```text
argv extra arguments were initially allowed after matching argv[0] and argv[1]
Windows case-folded absolute repo paths were authorized but returned an
un-normalized path, and case-sensitive relative extraction rejected them
```

An attempted code-review subagent run failed with an external `402 Payment
Required` provider error, so M2 review was completed locally against the
blueprint and tests above.

- [x] **Step 7: Run full verification and update implementation docs**

Fresh verification after review fixes:

```text
cargo test --workspace
  coasonix-runtime-core: 1 smoke, 7 artifact, 5 canonical, 8 policy,
  13 schema registry, and 4 state tests passed
  coasonix-runtime-worker: 0 tests, binary scaffold compiled

bun test
  packages/reasonix-expert-mcp/src/index.test.ts passed

python -m json.tool schemas/coasonix-v1.schema.json > $null
  exited 0

cargo fmt --all -- --check
  exited 0
```

## Full v1 Later Milestones

Future execution passes should continue with:

```text
M3: SQLite persistence and audit writer
M4: RuntimeKernel decision merge
M5: Rust JSON-RPC worker
M6: TypeScript worker client
M7: MCP adapter tools/list and tools/call
M8: mock Reasonix review_diff vertical slice
```

Each milestone requires failing tests first, passing tests after implementation,
review, fixes, and documentation updates before continuing.
