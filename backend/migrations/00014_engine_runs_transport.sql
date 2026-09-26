-- +goose Up
-- Domain: engine/runs, engine/agents
-- Bind each run to the scope that authorized it. Existing rows are backfilled
-- only when their single allowed run.start audit record identifies a valid
-- scope in the same project; ambiguous history must be repaired explicitly.
ALTER TABLE runs ADD COLUMN scope_id uuid;

UPDATE runs AS r
SET scope_id = CASE
    WHEN ar.resource ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN ar.resource::uuid
END
FROM audit_records AS ar
JOIN scopes AS s ON s.id = CASE
    WHEN ar.resource ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN ar.resource::uuid
END
WHERE r.scope_id IS NULL

  AND s.project_id = r.project_id
  AND ar.action = 'run.start'
  AND ar.outcome = 'allowed'
  AND ar.correlation = r.id::text
  AND 1 = (
      SELECT count(*)
      FROM audit_records AS candidate
      WHERE candidate.action = 'run.start'
        AND candidate.outcome = 'allowed'
        AND candidate.correlation = r.id::text
  );

-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM runs WHERE scope_id IS NULL) THEN
        RAISE EXCEPTION 'cannot backfill runs.scope_id: each legacy run requires exactly one valid allowed run.start audit record correlated to its id';
    END IF;
END;
$$;
-- +goose StatementEnd

ALTER TABLE runs
    ALTER COLUMN scope_id SET NOT NULL,
    ADD CONSTRAINT runs_scope_id_fkey FOREIGN KEY (scope_id) REFERENCES scopes(id) ON DELETE RESTRICT,
    ADD COLUMN request_key text NOT NULL DEFAULT '',
    ADD COLUMN request_fingerprint text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX runs_project_request_key_uidx
    ON runs (project_id, created_by, request_key)
    WHERE request_key <> '';

ALTER TABLE agent_attempts
    ADD COLUMN request_key text NOT NULL DEFAULT '',
    ADD COLUMN request_fingerprint text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX agent_attempts_agent_request_key_uidx
    ON agent_attempts (agent_id, request_key)
    WHERE request_key <> '';

-- +goose Down
DROP INDEX IF EXISTS agent_attempts_agent_request_key_uidx;
ALTER TABLE agent_attempts
    DROP COLUMN IF EXISTS request_fingerprint,
    DROP COLUMN IF EXISTS request_key;

DROP INDEX IF EXISTS runs_project_request_key_uidx;
ALTER TABLE runs
    DROP CONSTRAINT IF EXISTS runs_scope_id_fkey,
    DROP COLUMN IF EXISTS request_fingerprint,
    DROP COLUMN IF EXISTS request_key,
    DROP COLUMN IF EXISTS scope_id;
