# Coasonix

Coasonix is a Codex-Orchestrated Reasonix Runtime: Codex remains the primary controller, executor, verifier, and final decision maker while Reasonix is invoked as a controlled expert system through `reasonix-expert`.

Start from the documentation index:

1. [docs/coasonix/README.md](docs/coasonix/README.md)
2. [docs/coasonix/00-executive-summary.md](docs/coasonix/00-executive-summary.md)
3. [Architecture](docs/coasonix/01-architecture/01-overview-and-roles.md)
4. [Runtime](docs/coasonix/02-runtime/01-global-task-state-machine.md)
5. [Reasonix Integration](docs/coasonix/03-reasonix/01-tool-contracts-and-wrapper.md)
6. [Patch and Verification](docs/coasonix/04-patch-and-verification/01-patch-transaction-model.md)
7. [Versioning](docs/coasonix/05-versioning/01-schema-contract-and-versioning.md)
8. [Roadmap](docs/coasonix/06-roadmap/01-framework-reassessment.md)
9. [v1 Implementation Blueprint](docs/coasonix/06-roadmap/07-v1-implementation-blueprint.md)

Current status:

```text
Deterministic Multi-Agent Runtime Spec: complete
Runtime Enforcement Layer design: complete
Global Runtime / Project Controller isolation / Session Pool / session lane mapping: complete
MVP engineering defaults: complete
v1 technology baseline: Rust 2024 core, Bun ESM adapter, JSON-RPC stdio worker, SQLite persistence
v1 implementation blueprint: complete through M8
v1 MVP implementation: complete for Rust-gated reasonix.review_diff mock vertical slice
Safe autonomous patch operation: still blocked until patch safety, approval, and verification gates are implemented
```

Canonical schema registry:

[schemas/coasonix-v1.schema.json](schemas/coasonix-v1.schema.json)

Current implementation entry points:

```text
crates/coasonix-runtime-core/      Rust runtime kernel, schema, policy, state, audit, and storage
crates/coasonix-runtime-worker/    JSON-RPC stdio worker exposing runtime methods
packages/reasonix-expert-mcp/      Bun/TypeScript MCP adapter, worker client, and mock Reasonix runner
docs/implementation/               Implementation execution notes and verification evidence
```

Verification:

```text
cargo test --workspace
bun test
python -m json.tool schemas/coasonix-v1.schema.json > $null
cargo fmt --all -- --check
git diff --check
```
