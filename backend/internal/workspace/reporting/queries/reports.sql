-- name: CreateReport :one
INSERT INTO report_requests (
    run_id, template_id, template_version, template_hash, snapshot, status
)
VALUES ($1, $2, $3, $4, $5, 'queued')
ON CONFLICT (run_id) DO UPDATE
SET run_id = EXCLUDED.run_id
RETURNING id, run_id, template_id, template_version, template_hash, snapshot,
          status, version, lease_owner, lease_expires_at, output_artifact_id,
          failure_code, failure_message, created_at, updated_at, (xmax = 0) AS created;

-- name: GetReport :one
SELECT id, run_id, template_id, template_version, template_hash, snapshot,
       status, version, lease_owner, lease_expires_at, output_artifact_id,
       failure_code, failure_message, created_at, updated_at
FROM report_requests
WHERE id = $1;

-- name: GetReportByRun :one
SELECT id, run_id, template_id, template_version, template_hash, snapshot,
       status, version, lease_owner, lease_expires_at, output_artifact_id,
       failure_code, failure_message, created_at, updated_at
FROM report_requests
WHERE run_id = $1;

-- name: ClaimReport :one
UPDATE report_requests
SET status = 'rendering',
    lease_owner = $2,
    lease_expires_at = now() + ($3::bigint * interval '1 microsecond'),
    version = version + 1,
    updated_at = now()
WHERE id = $1
  AND version = $4
  AND (
      status = 'queued'
      OR (status = 'rendering' AND lease_expires_at <= now())
  )
RETURNING id, run_id, template_id, template_version, template_hash, snapshot,
          status, version, lease_owner, lease_expires_at, output_artifact_id,
          failure_code, failure_message, created_at, updated_at;

-- name: CompleteReport :one
UPDATE report_requests
SET status = 'completed',
    lease_owner = NULL,
    lease_expires_at = NULL,
    output_artifact_id = $3,
    version = version + 1,
    updated_at = now()
WHERE id = $1
  AND version = $2
  AND status = 'rendering'
  AND lease_owner = $4
  AND lease_expires_at > now()
  AND output_artifact_id IS NULL
RETURNING id, run_id, template_id, template_version, template_hash, snapshot,
          status, version, lease_owner, lease_expires_at, output_artifact_id,
          failure_code, failure_message, created_at, updated_at;

-- name: FailReport :one
UPDATE report_requests
SET status = 'failed',
    lease_owner = NULL,
    lease_expires_at = NULL,
    failure_code = $3,
    failure_message = $4,
    version = version + 1,
    updated_at = now()
WHERE id = $1
  AND version = $2
  AND status = 'rendering'
  AND lease_owner = $5
  AND lease_expires_at > now()
RETURNING id, run_id, template_id, template_version, template_hash, snapshot,
          status, version, lease_owner, lease_expires_at, output_artifact_id,
          failure_code, failure_message, created_at, updated_at;

-- name: CancelReport :one
UPDATE report_requests
SET status = 'cancelled',
    lease_owner = NULL,
    lease_expires_at = NULL,
    version = version + 1,
    updated_at = now()
WHERE id = $1
  AND version = $2
  AND status IN ('queued', 'rendering')
RETURNING id, run_id, template_id, template_version, template_hash, snapshot,
          status, version, lease_owner, lease_expires_at, output_artifact_id,
          failure_code, failure_message, created_at, updated_at;
