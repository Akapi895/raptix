-- name: CreateRole :one
INSERT INTO roles (name, description)
VALUES ($1, $2)
RETURNING id, name, description;

-- name: GetRoleByID :one
SELECT id, name, description FROM roles WHERE id = $1;

-- name: GetRoleByName :one
SELECT id, name, description FROM roles WHERE name = $1;

-- name: CreatePermission :one
INSERT INTO permissions (name, comment)
VALUES ($1, $2)
RETURNING id, name, comment;

-- name: GetPermission :one
SELECT id, name, comment FROM permissions WHERE name = $1;

-- name: GrantRolePermission :exec
INSERT INTO role_permissions (role_id, permission_id)
VALUES ($1, $2);

-- name: RoleHasPermission :one
SELECT count(*) FROM role_permissions
WHERE role_id = $1 AND permission_id = $2;

-- name: CreateCapabilityGrant :one
INSERT INTO capability_grants (subject, scope_id, capability, granted_by, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, subject, scope_id, capability, granted_by, created_at, revoked_at, expires_at;

-- name: GetCapabilityGrant :one
SELECT id, subject, scope_id, capability, granted_by, created_at, revoked_at, expires_at
FROM capability_grants
WHERE id = $1;

-- name: RevokeCapabilityGrant :one
-- Idempotent: revoking an already-revoked grant returns the row unchanged so
-- callers can tell "already revoked" from "does not exist" (ErrNoRows).
UPDATE capability_grants
SET revoked_at = COALESCE(revoked_at, now())
WHERE id = $1
RETURNING id, subject, scope_id, capability, granted_by, created_at, revoked_at, expires_at;

-- name: ListActiveGrantsForSubjectScope :many
SELECT id, subject, scope_id, capability, granted_by, created_at, revoked_at, expires_at
FROM capability_grants
WHERE subject = $1
  AND scope_id = $2
  AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now())
ORDER BY created_at;

-- name: CreateApproval :one
INSERT INTO approvals (subject, scope_id, action, expires_at)
VALUES ($1, $2, $3, $4)
RETURNING id, subject, scope_id, action, status, decided_by, decided_at, reason, created_at, expires_at;

-- name: GetApproval :one
SELECT id, subject, scope_id, action, status, decided_by, decided_at, reason, created_at, expires_at
FROM approvals
WHERE id = $1;

-- name: DecideApproval :one
UPDATE approvals
SET status = $2, decided_by = $3, decided_at = now(), reason = $4
WHERE id = $1 AND status = 'pending'
RETURNING id, subject, scope_id, action, status, decided_by, decided_at, reason, created_at, expires_at;
