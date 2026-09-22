-- +goose Up
-- Domain: execution/invocation
CREATE TABLE tool_invocations (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                 uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id                uuid REFERENCES tasks(id) ON DELETE SET NULL,
    scope_id               uuid NOT NULL REFERENCES scopes(id) ON DELETE RESTRICT,
    actor                  text NOT NULL,
    capability             text NOT NULL,
    capability_version     text NOT NULL DEFAULT '',
    status                 text NOT NULL DEFAULT 'pending',
        -- pending | dispatched | running | succeeded | failed | timed_out | cancelled | denied | unknown
    request                jsonb NOT NULL DEFAULT '{}'::jsonb,  -- args đã sanitize
    raw_artifact_id        uuid REFERENCES artifacts(id) ON DELETE SET NULL,
    structured_artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
    result_execution       text NOT NULL DEFAULT 'not_attempted',
    result_parse           text NOT NULL DEFAULT 'not_attempted',
    exit_code              integer,
    error_code             text NOT NULL DEFAULT '',
    error_message          text NOT NULL DEFAULT '',
    idempotency_key        text NOT NULL,
    version                integer NOT NULL DEFAULT 1,
    started_at             timestamptz,
    finished_at            timestamptz,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, idempotency_key),
    CHECK (status IN ('pending','dispatched','running','succeeded','failed','timed_out','cancelled','denied','unknown')),
    CHECK (result_execution IN ('not_attempted','success','failed','timed_out','cancelled')),
    CHECK (result_parse IN ('not_attempted','success','partial','failed')),
    CHECK (version > 0)
);
CREATE INDEX tool_invocations_run_idx ON tool_invocations (run_id, created_at DESC);
CREATE INDEX tool_invocations_status_idx ON tool_invocations (status);

COMMENT ON TABLE tool_invocations IS 'Tool invocation lifecycle. Owner: execution/invocation.';

-- +goose Down
DROP TABLE IF EXISTS tool_invocations;
