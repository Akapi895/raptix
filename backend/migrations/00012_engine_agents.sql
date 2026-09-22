-- +goose Up
-- Domain: engine/agents
-- Agent attempts, conversation messages and the resolved content/capability
-- snapshot. engine/runs still owns agent_instances lifecycle; these tables hold
-- the agent's own working data (conversation + snapshot provenance).

CREATE TABLE agent_attempts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    uuid NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
    attempt_no  integer NOT NULL DEFAULT 1,
    status      text NOT NULL DEFAULT 'running',
        -- running | succeeded | failed | timed_out | cancelled
    started_at  timestamptz,
    finished_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (agent_id, attempt_no),
    CHECK (status IN ('running','succeeded','failed','timed_out','cancelled')),
    CHECK (attempt_no > 0)
);

COMMENT ON TABLE agent_attempts IS 'One agent working attempt. Owner: engine/agents. Lifecycle of the agent instance stays in engine/runs.';

CREATE TABLE agent_messages (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id    uuid NOT NULL REFERENCES agent_attempts(id) ON DELETE CASCADE,
    seq           integer NOT NULL,
    role          text NOT NULL,   -- system | user | assistant | tool
    content       text NOT NULL,
    invocation_id uuid REFERENCES tool_invocations(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, seq),
    CHECK (role IN ('system','user','assistant','tool')),
    CHECK (seq >= 0)
);

COMMENT ON TABLE agent_messages IS 'Agent conversation turns. Owner: engine/agents. invocation_id references a tool invocation for traceability only.';

CREATE TABLE agent_snapshots (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id     uuid NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
    profile_ref  text NOT NULL,
    content_hash text NOT NULL,
    requested    jsonb NOT NULL DEFAULT '[]'::jsonb,
    granted      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (agent_id, content_hash)
);

COMMENT ON TABLE agent_snapshots IS 'Resolved content/capability snapshot at a point in time. Owner: engine/agents. granted is a record, not a substitute for dispatch-time checks.';

CREATE INDEX agent_attempts_agent_idx ON agent_attempts (agent_id, attempt_no DESC);
CREATE INDEX agent_messages_attempt_idx ON agent_messages (attempt_id, seq);

-- +goose Down
DROP TABLE IF EXISTS agent_snapshots;
DROP TABLE IF EXISTS agent_messages;
DROP TABLE IF EXISTS agent_attempts;
