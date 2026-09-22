package runs

import (
	"context"

	"github.com/google/uuid"
)

// Repository is the persistence contract owned by this module. Implementations
// (Postgres, in-memory test double) satisfy it; other modules never import the
// generated store directly.
type Repository interface {
	CreateRun(ctx context.Context, p CreateRunParams) (Run, error)
	GetRun(ctx context.Context, id uuid.UUID) (Run, error)
	TransitionRun(ctx context.Context, id uuid.UUID, version int, newStatus RunStatus) (Run, error)
	ListRunsByProject(ctx context.Context, projectID uuid.UUID) ([]Run, error)

	CreateTask(ctx context.Context, p CreateTaskParams) (Task, error)
	GetTask(ctx context.Context, id uuid.UUID) (Task, error)
	TransitionTask(ctx context.Context, id uuid.UUID, version int, newStatus TaskStatus) (Task, error)
	AddTaskDependency(ctx context.Context, taskID uuid.UUID, dependsOn uuid.UUID, required bool) error
	ListTaskDependencies(ctx context.Context, taskID uuid.UUID) ([]TaskDependency, error)

	CreateAgent(ctx context.Context, p CreateAgentParams) (AgentInstance, error)
	GetAgent(ctx context.Context, id uuid.UUID) (AgentInstance, error)
	TransitionAgent(ctx context.Context, id uuid.UUID, version int, newStatus AgentStatus) (AgentInstance, error)
	ListAgentsByRun(ctx context.Context, runID uuid.UUID) ([]AgentInstance, error)
}

// TaskDependency links a task to another it depends on. Owner: engine/runs.
type TaskDependency struct {
	TaskID    uuid.UUID
	DependsOn uuid.UUID
	Required  bool
}
