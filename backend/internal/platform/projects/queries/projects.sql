-- name: CreateProject :one
INSERT INTO projects (name, slug, status)
VALUES ($1, $2, 'active')
RETURNING id, name, slug, status, created_at, updated_at, scope_version;

-- name: GetProjectByID :one
SELECT id, name, slug, status, created_at, updated_at, scope_version
FROM projects
WHERE id = $1;

-- name: GetProjectBySlug :one
SELECT id, name, slug, status, created_at, updated_at, scope_version
FROM projects
WHERE slug = $1;

-- name: ListProjects :many
SELECT id, name, slug, status, created_at, updated_at, scope_version
FROM projects
ORDER BY created_at DESC;

-- name: SetProjectStatus :one
UPDATE projects
SET status = $2, updated_at = now()
WHERE id = $1
RETURNING id, name, slug, status, created_at, updated_at, scope_version;

-- name: AddProjectMember :one
INSERT INTO project_members (project_id, subject, role)
VALUES ($1, $2, $3)
RETURNING project_id, subject, role, created_at;

-- name: ListProjectMembers :many
SELECT project_id, subject, role, created_at
FROM project_members
WHERE project_id = $1;

-- name: GetMemberRole :one
SELECT role
FROM project_members
WHERE project_id = $1 AND subject = $2;

-- name: NextScopeVersion :one
-- Atomically reserves the next project-local scope version. The UPDATE takes a
-- row lock on the project and, under READ COMMITTED, re-reads the row after any
-- concurrent lock wait, so two callers always receive distinct values. A
-- version may be skipped if the following insert fails, which is acceptable.
UPDATE projects
SET scope_version = scope_version + 1
WHERE projects.id = $1
RETURNING scope_version;

-- name: CreateScope :one
INSERT INTO scopes (project_id, version, asset_types, include, exclude, expires_at, approval_note)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, project_id, version, asset_types, include, exclude, expires_at, approval_note, created_at;

-- name: GetScopeByID :one
SELECT id, project_id, version, asset_types, include, exclude, expires_at, approval_note, created_at
FROM scopes
WHERE id = $1;

-- name: ListScopesByProject :many
SELECT id, project_id, version, asset_types, include, exclude, expires_at, approval_note, created_at
FROM scopes
WHERE project_id = $1
ORDER BY version DESC;
