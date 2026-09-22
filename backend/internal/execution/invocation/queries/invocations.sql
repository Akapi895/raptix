-- name: CreateInvocation :one
WITH active_run AS (
    SELECT runs.id
    FROM runs
    WHERE runs.id = $1
      AND runs.status NOT IN ('cancelled', 'completed', 'budget_exhausted')
    FOR SHARE
)
INSERT INTO tool_invocations (
    run_id, task_id, scope_id, actor, capability, capability_version,
    status, request, idempotency_key
)
SELECT active_run.id, $2, $3, $4, $5, $6, 'pending', $7, $8
FROM active_run
RETURNING id, run_id, task_id, scope_id, actor, capability, capability_version,
          status, request, raw_artifact_id, structured_artifact_id,
          result_execution, result_parse, exit_code, error_code, error_message,
          idempotency_key, version, started_at, finished_at, created_at, updated_at;

-- name: GetInvocation :one
SELECT id, run_id, task_id, scope_id, actor, capability, capability_version,
       status, request, raw_artifact_id, structured_artifact_id,
       result_execution, result_parse, exit_code, error_code, error_message,
       idempotency_key, version, started_at, finished_at, created_at, updated_at
FROM tool_invocations
WHERE id = $1;

-- name: GetInvocationByRunAndKey :one
SELECT id, run_id, task_id, scope_id, actor, capability, capability_version,
       status, request, raw_artifact_id, structured_artifact_id,
       result_execution, result_parse, exit_code, error_code, error_message,
       idempotency_key, version, started_at, finished_at, created_at, updated_at
FROM tool_invocations
WHERE run_id = $1 AND idempotency_key = $2;

-- name: UpdateInvocationResult :one
WITH active_run AS (
    SELECT runs.id
    FROM runs
    JOIN tool_invocations inv ON inv.run_id = runs.id
    WHERE inv.id = $1
      AND runs.status NOT IN ('cancelled', 'completed', 'budget_exhausted')
    FOR SHARE OF runs
)
UPDATE tool_invocations AS ti
SET status = $2,
    raw_artifact_id = $3,
    structured_artifact_id = $4,
    result_execution = $5,
    result_parse = $6,
    exit_code = $7,
    error_code = $8,
    error_message = $9,
    finished_at = $10,
    version = version + 1,
    updated_at = now()
WHERE ti.id = $1 AND ti.version = $11
  AND ti.status = 'running'
  AND EXISTS (SELECT 1 FROM active_run)
RETURNING ti.*;

-- name: CountInvocationsByRun :one
SELECT count(*)
FROM tool_invocations
WHERE run_id = $1;

-- name: ListInvocationsByRun :many
SELECT id, run_id, task_id, scope_id, actor, capability, capability_version,
       status, request, raw_artifact_id, structured_artifact_id,
       result_execution, result_parse, exit_code, error_code, error_message,
       idempotency_key, version, started_at, finished_at, created_at, updated_at
FROM tool_invocations
WHERE run_id = $1
ORDER BY created_at DESC;

-- name: StartInvocation :one
WITH active_run AS (
    SELECT runs.id
    FROM runs
    JOIN tool_invocations inv ON inv.run_id = runs.id
    WHERE inv.id = $1
      AND runs.status NOT IN ('cancelled', 'completed', 'budget_exhausted')
    FOR SHARE OF runs
)
UPDATE tool_invocations AS ti
SET status = 'running', started_at = now(), version = version + 1, updated_at = now()
WHERE ti.id = $1 AND ti.version = $2 AND ti.status = 'pending'
  AND EXISTS (SELECT 1 FROM active_run)
RETURNING ti.*;

-- name: ListStaleInvocations :many
SELECT id, run_id, task_id, scope_id, actor, capability, capability_version,
       status, request, raw_artifact_id, structured_artifact_id,
       result_execution, result_parse, exit_code, error_code, error_message,
       idempotency_key, version, started_at, finished_at, created_at, updated_at
FROM tool_invocations
WHERE (status = 'pending' AND created_at < $1)
   OR (status IN ('dispatched', 'running') AND started_at < $1)
ORDER BY created_at ASC;

-- name: CancelInvocationsByRun :execrows
UPDATE tool_invocations
SET status = $3, finished_at = now(), version = version + 1, updated_at = now()
WHERE run_id = $1 AND status = ANY($2::text[]);

-- name: MarkUnknown :one
UPDATE tool_invocations
SET status = 'unknown', finished_at = now(), version = version + 1, updated_at = now()
WHERE id = $1 AND version = $2
  AND status IN ('pending', 'dispatched', 'running')
RETURNING id, run_id, task_id, scope_id, actor, capability, capability_version,
          status, request, raw_artifact_id, structured_artifact_id,
          result_execution, result_parse, exit_code, error_code, error_message,
          idempotency_key, version, started_at, finished_at, created_at, updated_at;
