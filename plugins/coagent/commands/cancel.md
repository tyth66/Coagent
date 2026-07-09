# /coagent:cancel

Cancel an active background Coagent job in this repository.

## Arguments

- `[job-id]`: specific job to cancel. If omitted, cancels the first active job.

## Workflow

1. If a job ID is provided, use it directly.
2. If no job ID is provided, run `coagent-companion.ps1 cancel` to auto-select the first queued/running job.
3. Call the `coagent.cancel_task` MCP tool with the job ID's `task_id`.
4. Confirm cancellation to the user with the job ID and previous status.
5. If no active jobs exist, tell the user there is nothing to cancel.
