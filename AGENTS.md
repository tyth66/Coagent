# Coagent Repository Guidelines

## Project Structure

```
crates/
  coagent-runtime-core/     Runtime state + policy + audit (library)
  coagent-runtime-worker/   [DEPRECATED] JSON-RPC stdio worker
  coagent-mcp-server/       Rust MCP server binary (primary)

packages/
  reasonix-expert-mcp/      [DEPRECATED] TypeScript MCP adapter

docs/
  coagent/                 Canonical documentation
```

## Build, Test, and Development Commands

- `cargo build -p coagent-mcp-server` — build the Rust MCP server binary
- `cargo build --release -p coagent-mcp-server` — release build (~5 MB exe)
- `cargo test --workspace` — run all Rust tests
- `bun test` — run TypeScript adapter tests (legacy)
- `cargo fmt --all -- --check` — check Rust formatting
- `cargo clippy --workspace -- -D warnings` — lint all Rust code

## Coding Style

- Rust: standard `rustfmt` + `cargo clippy`, edition 2024
- TypeScript: `bun test` for testing, no build step needed (Bun runs `.ts` directly)
- Markdown: ATX headings (`#`), fenced code blocks, concise paragraphs

## Commit Protocol

Use the Lore commit format:
```
<one-line intent: why, not what>

Constraint: <external force>
Rejected: <alternative> | <reason>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <warning for future modifiers>
Tested: <verification performed>
Not-tested: <known gaps>
```

## Documentation

Primary docs: `docs/coagent/`. Architecture docs are in `docs/coagent/architecture/`.

Update documentation when changing architecture, APIs, or deployment.
