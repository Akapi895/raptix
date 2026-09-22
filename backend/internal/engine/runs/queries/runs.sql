-- name: CreateRun :one
INSERT INTO runs (project_id, name, status, created_by)
VALUES ($1, $2, $3, $4)
RETURNING id, project_id, name, status, version, created_by, created_at, updated_at;

-- name: GetRun :one
SELECT id, project_id, name, status, version, created_by, created_at, updated_at
FROM runs
WHERE id = $1;

-- name: TransitionRun :one
UPDATE runs
SET status = $2, version = version + 1, updated_at = now()
WHERE id = $1 AND version = $3
RETURNING id, project_id, name, status, version, created_by, created_at, updated_at;

-- name: ListRunsByProject :many
SELECT id, project_id, name, status, version, created_by, created_at, updated_at
FROM runs
WHERE project_id = $1
ORDER BY created_at DESC;

-- name: CreateTask :one
INSERT INTO tasks (run_id, name, status)
VALUES ($1, $2, $3)
RETURNING id, run_id, name, status, version, created_at, updated_at;

-- name: GetTask :one
SELECT id, run_id, name, status, version, created_at, updated_at
FROM tasks
WHERE id = $1;

-- name: TransitionTask :one
UPDATE tasks
SET status = $2, version = version + 1, updated_at = now()
WHERE id = $1 AND version = $3
RETURNING id, run_id, name, status, version, created_at, updated_at;

-- name: AddTaskDependency :exec
INSERT INTO task_dependencies (task_id, depends_on, required)
VALUES ($1, $2, $3);

-- name: ListTaskDependencies :many
SELECT task_id, depends_on, required
FROM task_dependencies
WHERE task_id = $1;

-- name: CreateAgentInstance :one
INSERT INTO agent_instances (run_id, task_id, profile, status)
VALUES ($1, $2, $3, $4)
RETURNING id, run_id, task_id, profile, status, version, created_at, updated_at;

-- name: GetAgentInstance :one
SELECT id, run_id, task_id, profile, status, version, created_at, updated_at
FROM agent_instances
WHERE id = $1;

-- name: TransitionAgentInstance :one
UPDATE agent_instances
SET status = $2, version = version + 1, updated_at = now()
WHERE id = $1 AND version = $3
RETURNING id, run_id, task_id, profile, status, version, created_at, updated_at;

-- name: ListAgentInstancesByRun :many
SELECT id, run_id, task_id, profile, status, version, created_at, updated_at
FROM agent_instances
WHERE run_id = $1
ORDER BY created_at ASC;
