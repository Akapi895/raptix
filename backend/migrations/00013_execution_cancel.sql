-- +goose Up
-- Domain: execution/cancel (reads execution/invocation data).
-- Partial indexes that back the stale-invocation scan: pending rows are aged by
-- created_at (no dispatch time yet), dispatched/running rows by started_at.

CREATE INDEX tool_invocations_pending_stale_idx
    ON tool_invocations (created_at) WHERE status = 'pending';

CREATE INDEX tool_invocations_running_stale_idx
    ON tool_invocations (started_at) WHERE status IN ('dispatched','running');

-- +goose Down
DROP INDEX IF EXISTS tool_invocations_running_stale_idx;
DROP INDEX IF EXISTS tool_invocations_pending_stale_idx;
