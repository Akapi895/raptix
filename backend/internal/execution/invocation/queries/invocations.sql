-- name: CreateInvocation :one
INSERT INTO tool_invocations (
    run_id, task_id, scope_id, actor, capability, capability_version,
    status, request, idempotency_key
)
VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
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
UPDATE tool_invocations
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
WHERE id = $1 AND version = $11
RETURNING id, run_id, task_id, scope_id, actor, capability, capability_version,
          status, request, raw_artifact_id, structured_artifact_id,
          result_execution, result_parse, exit_code, error_code, error_message,
          idempotency_key, version, started_at, finished_at, created_at, updated_at;

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
