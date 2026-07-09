# /coagent:rescue

Delegate an investigation, fix request, or follow-up task to a Coagent backend.

## Arguments

- `[goal]`: what Coagent should investigate, fix, or continue (required)
- `--model <model>`: model override (e.g. `spark` for fast passes)
- `--effort <level>`: reasoning effort (none|minimal|low|medium|high|xhigh)

## Workflow

1. If no goal is provided, ask the user what Coagent should investigate or fix.
2. Call the `coagent.rescue` MCP tool with the goal text.
3. The rescue tool delegates to the configured backend (Reasonix via ACP by default).
4. Return the backend output verbatim. Do not paraphrase or summarize.
5. If the backend returns findings, list them but do not apply fixes automatically.
