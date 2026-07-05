# Repository Guidelines

## Project Structure & Module Organization

This repository now contains the Coagent v1 MVP implementation plus its project documentation. Coagent is a Codex-Orchestrated Reasonix Runtime. The root `README.md` gives the high-level entry point. The canonical project documentation lives under `docs/coagent/`, while implementation execution notes live under `docs/implementation/`:

- `00-collaboration-model.md` defines the canonical Codex / Coagent / Reasonix collaboration model.
- `00-executive-summary.md` summarizes current conclusions and implementation status.
- `01-architecture/` defines roles, context ownership, MCP communication, and project/session routing.
- `02-runtime/` describes task state, runtime enforcement, policy checks, and observability.
- `03-reasonix/` covers Reasonix tool contracts, concurrency, cache behavior, and context projection risks.
- `04-patch-and-verification/` documents patch transactions, safety checks, verification, and approval gates.
- `05-versioning/` defines schema and compatibility policy.
- `06-roadmap/` records reassessment, defaults, and implementation planning.
- `schemas/coagent-v1.schema.json` is the v1 review_diff test contract schema.
- `crates/Coagent-runtime-core/` implements the Rust RuntimeKernel, canonicalization, state, policy, audit, and SQLite storage.
- `crates/coagent-runtime-worker/` implements the JSON-RPC stdio Runtime Worker.
- `packages/reasonix-expert-mcp/` implements the Bun/TypeScript MCP adapter, Runtime Worker client, and mock Reasonix runner.

## Build, Test, and Development Commands

Use the workspace build and verification commands:

- `git status --short` checks pending edits before and after changes.
- `cargo test --workspace` runs the Rust runtime core and worker tests.
- `bun test` runs the TypeScript adapter, worker client, and vertical-slice tests.
- `python -m json.tool schemas/coagent-v1.schema.json > $null` verifies the schema file is valid JSON.
- `cargo fmt --all -- --check` checks Rust formatting.
- `git diff --check` checks whitespace errors before commit.

## Coding Style & Naming Conventions

Markdown files should use ATX headings (`#`, `##`), concise paragraphs, and fenced code blocks for command or contract examples. Preserve the numbered directory prefixes because they encode the intended reading order. New documentation files should use lowercase kebab-case names, for example `07-conformance-tests/01-test-runner.md`.

JSON schema edits should keep two-space indentation, stable key ordering where practical, and explicit `additionalProperties` decisions for object contracts.

## Testing Guidelines

For documentation changes, verify links and cross-references manually against `docs/coagent/README.md`. For schema changes, run the JSON validation command above and inspect affected `$defs` references. For Rust changes, add focused tests under the relevant crate's `tests/` tree. For TypeScript adapter changes, add tests beside the changed module under `packages/reasonix-expert-mcp/src/`.

## Commit & Pull Request Guidelines

Current history uses concise, imperative summary commits such as `Establish Coagent documentation baseline`. Keep commit subjects short and outcome-focused.

Pull requests should include a summary, changed documentation areas, schema impact if any, verification performed, and open risks or follow-up work. Link related issues when available. Include screenshots only if generated diagrams or rendered documentation are part of the change.

## Agent-Specific Instructions

Treat `docs/coagent/00-collaboration-model.md`, `docs/coagent/README.md`, and `docs/implementation/review-diff-agent-collaboration-plan.md` as source-of-truth entry points for the current v1 direction. Treat `schemas/coagent-v1.schema.json` as the review_diff test contract fixture, not as a runtime architecture gate. Keep documentation, schema names, roadmap status, and implementation notes aligned in the same change.


