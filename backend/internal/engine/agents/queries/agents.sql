-- name: CreateAttempt :one
INSERT INTO agent_attempts (agent_id, attempt_no, status, started_at)
VALUES (
    $1,
    COALESCE((SELECT MAX(attempt_no) FROM agent_attempts WHERE agent_id = $1), 0) + 1,
    'running',
    now()
)
RETURNING id, agent_id, attempt_no, status, request_key, request_fingerprint, started_at, finished_at, created_at, updated_at;

-- name: CreateOrGetAttempt :one
INSERT INTO agent_attempts (agent_id, attempt_no, status, started_at, request_key, request_fingerprint)
VALUES (
    $1,
    COALESCE((SELECT MAX(attempt_no) FROM agent_attempts WHERE agent_id = $1), 0) + 1,
    'running',
    now(),
    $2,
    $3
)
ON CONFLICT (agent_id, request_key) WHERE request_key <> ''
DO UPDATE SET request_key = EXCLUDED.request_key
RETURNING id, agent_id, attempt_no, status, request_key, request_fingerprint, started_at, finished_at, created_at, updated_at, (xmax = 0) AS created;

-- name: GetAttempt :one
SELECT id, agent_id, attempt_no, status, request_key, request_fingerprint, started_at, finished_at, created_at, updated_at
FROM agent_attempts
WHERE id = $1;

-- name: ListAttemptsByAgent :many
SELECT id, agent_id, attempt_no, status, request_key, request_fingerprint, started_at, finished_at, created_at, updated_at
FROM agent_attempts
WHERE agent_id = $1
ORDER BY attempt_no DESC;

-- name: FinishAttempt :one
UPDATE agent_attempts
SET status = $2,
    finished_at = $3,
    updated_at = now()
WHERE id = $1
  AND status = 'running'
RETURNING id, agent_id, attempt_no, status, request_key, request_fingerprint, started_at, finished_at, created_at, updated_at;

-- name: AppendMessage :one
INSERT INTO agent_messages (attempt_id, seq, role, content, invocation_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, attempt_id, seq, role, content, invocation_id, created_at;

-- name: ListMessages :many
SELECT id, attempt_id, seq, role, content, invocation_id, created_at
FROM agent_messages
WHERE attempt_id = $1
ORDER BY seq ASC;

-- name: CreateSnapshot :one
INSERT INTO agent_snapshots (agent_id, profile_ref, content_hash, requested, granted)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (agent_id, content_hash)
DO UPDATE SET profile_ref = EXCLUDED.profile_ref
RETURNING id, agent_id, profile_ref, content_hash, requested, granted, created_at;

-- name: GetSnapshotByAgent :one
SELECT id, agent_id, profile_ref, content_hash, requested, granted, created_at
FROM agent_snapshots
WHERE agent_id = $1
ORDER BY created_at DESC
LIMIT 1;
