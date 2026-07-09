# /coagent:result

Show the final stored Coagent output for a finished job.

## Arguments

- `[job-id]`: specific job to retrieve. If omitted, shows the most recently finished job.

## Workflow

1. If a job ID is provided, use it directly.
2. If no job ID is provided, run `coagent-companion.ps1 result` to auto-select the most recently completed/failed/cancelled job.
3. Call the `coagent.task_result` MCP tool with the job ID's `task_id`.
4. Return the result output verbatim, including the task state and recent decisions.
5. If no finished jobs exist, tell the user.
