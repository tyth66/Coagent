# Coagent Repository Guidelines

Pure Rust project — no TypeScript, no Bun, no Node.js required.

## Project Structure

```
crates/
  coagent-runtime-core/     Runtime state + policy + audit (library)
  coagent-runtime-worker/   [DEPRECATED] JSON-RPC stdio worker
  coagent-mcp-server/       MCP server binary (primary)

docs/coagent/              Canonical documentation
```

## Build, Test, and Verify

- `cargo build -p coagent-mcp-server` — build debug binary
- `cargo build --release -p coagent-mcp-server` — release build (~5 MB)
- `cargo test --workspace` — run all tests
- `cargo fmt --all -- --check` — check formatting
- `cargo clippy --workspace -- -D warnings` — lint all code

## Coding Style

- Rust edition 2024, standard `rustfmt` + `cargo clippy`
- Markdown: ATX headings, fenced code blocks, concise paragraphs

## Commit Protocol (Lore)

```
<intent line: why, not what>

Constraint: <external force>
Rejected: <alternative> | <reason>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <warning for future modifiers>
Tested: <verification performed>
Not-tested: <known gaps>
```

## Documentation

Primary docs: `docs/coagent/`. Architecture docs: `docs/coagent/architecture/`.

Update documentation when changing architecture, APIs, or deployment.
