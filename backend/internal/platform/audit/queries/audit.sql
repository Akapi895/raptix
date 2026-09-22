-- name: InsertAuditRecord :one
INSERT INTO audit_records (actor, action, resource, outcome, reason, correlation)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, actor, action, resource, outcome, reason, correlation, created_at;

-- name: GetAuditRecord :one
SELECT id, actor, action, resource, outcome, reason, correlation, created_at
FROM audit_records
WHERE id = $1;

-- name: ListAuditByActor :many
SELECT id, actor, action, resource, outcome, reason, correlation, created_at
FROM audit_records
WHERE actor = $1
ORDER BY created_at DESC;

-- name: ListAuditByCorrelation :many
SELECT id, actor, action, resource, outcome, reason, correlation, created_at
FROM audit_records
WHERE correlation = $1
ORDER BY created_at DESC;
