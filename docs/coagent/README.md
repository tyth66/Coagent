# Coagent Documentation

## Architecture (v3)

- [Collaboration Model](architecture/00-collaboration-model.md) — Current v3 architecture
- [Runtime: State, Policy, Audit](architecture/01-runtime.md) — Pipeline, ToolSpec, Attempts, Audit
- [MCP Server](architecture/02-mcp-server.md) — Tool registration, BackendRegistry, Deployment

## Historical

- [General Agent Runtime Gaps](architecture/03-general-agent-runtime-gaps.md) — ARCHIVED (v1→v2, all resolved)
- [Architecture Backlog](architecture/04-backlog.md) — ARCHIVED (8/8 resolved)
- [v3 Blueprint](architecture/05-v3-blueprint.md) — All 5 phases complete

## Development

### Build

```powershell
cargo build -p coagent-mcp-server
```

### Test

```powershell
cargo test --workspace    # 153 pass, 1 ignored (live Reasonix)
```

### Verification

```powershell
cargo build -p coagent-mcp-server
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings -A dead_code -A unused_imports
```