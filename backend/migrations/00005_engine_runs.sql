-- +goose Up
-- Domain: engine/runs
CREATE TABLE runs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        text NOT NULL,
    status      text NOT NULL DEFAULT 'queued',  -- queued | running | paused | cancelled | completed | budget_exhausted
    version     integer NOT NULL DEFAULT 1,      -- optimistic concurrency on transitions
    created_by  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE runs IS 'Run lifecycle. Owner: engine/runs. budget_exhausted is distinct from completed.';

CREATE TABLE tasks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name        text NOT NULL,
    status      text NOT NULL DEFAULT 'queued',  -- queued | running | paused | cancelled | completed | budget_exhausted
    version     integer NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_dependencies (
    task_id        uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    required       boolean NOT NULL DEFAULT true,
    PRIMARY KEY (task_id, depends_on),
    CHECK (task_id <> depends_on)
);

COMMENT ON TABLE task_dependencies IS 'Dependency graph independent of agent tree. Owner: engine/runs.';

CREATE TABLE agent_instances (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id     uuid REFERENCES tasks(id) ON DELETE SET NULL,
    profile     text NOT NULL,          -- agent profile name
    status      text NOT NULL DEFAULT 'paused',  -- paused | running | completed | failed | cancelled
    version     integer NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE agent_instances IS 'Agent instance lifecycle. Owner: engine/runs. Profile is a role description, not a principal.';

-- +goose Down
DROP TABLE IF EXISTS agent_instances;
DROP TABLE IF EXISTS task_dependencies;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS runs;
