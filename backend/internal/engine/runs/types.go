// Package runs owns the lifecycle of runs, tasks and agent instances. It is
// the sole owner of statere transitions for these entities; other modules
// observe them through the Repository or Service.
package runs

import (
	"time"

	"github.com/google/uuid"
)

// RunStatus is the lifecycle state of a run.
type RunStatus string

const (
	RunQueued          RunStatus = "queued"
	RunRunning         RunStatus = "running"
	RunPaused          RunStatus = "paused"
	RunCancelled       RunStatus = "cancelled"
	RunCompleted       RunStatus = "completed"
	RunBudgetExhausted RunStatus = "budget_exhausted"
)

// TaskStatus is the lifecycle state of a task within a run.
type TaskStatus string

const (
	TaskQueued          TaskStatus = "queued"
	TaskRunning         TaskStatus = "running"
	TaskPaused          TaskStatus = "paused"
	TaskCancelled       TaskStatus = "cancelled"
	TaskCompleted       TaskStatus = "completed"
	TaskBudgetExhausted TaskStatus = "budget_exhausted"
)

// AgentStatus is the lifecycle state of an agent instance.
type AgentStatus string

const (
	AgentPaused    AgentStatus = "paused"
	AgentRunning   AgentStatus = "running"
	AgentCompleted AgentStatus = "completed"
	AgentFailed    AgentStatus = "failed"
	AgentCancelled AgentStatus = "cancelled"
)

// Run is an engagement run. Owner: engine/runs.
type Run struct {
	ID                 uuid.UUID
	ProjectID          uuid.UUID
	ScopeID            uuid.UUID
	Name               string
	Status             RunStatus
	Version            int
	CreatedBy          string
	RequestKey         string
	RequestFingerprint string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// Task is a unit of work within a run. Owner: engine/runs.
type Task struct {
	ID        uuid.UUID
	RunID     uuid.UUID
	Name      string
	Status    TaskStatus
	Version   int
	CreatedAt time.Time
	UpdatedAt time.Time
}

// AgentInstance is a live agent within a run, optionally scoped to a task.
// Profile is a role description, not a principal. Owner: engine/runs.
type AgentInstance struct {
	ID        uuid.UUID
	RunID     uuid.UUID
	TaskID    *uuid.UUID
	Profile   string
	Status    AgentStatus
	Version   int
	CreatedAt time.Time
	UpdatedAt time.Time
}

// CreateRunParams carries the fields for creating a run.
type CreateRunParams struct {
	ProjectID          uuid.UUID
	ScopeID            uuid.UUID
	Name               string
	Status             RunStatus
	CreatedBy          string
	RequestKey         string
	RequestFingerprint string
}

// CreateRunResult reports whether an idempotent create inserted a new run.
type CreateRunResult struct {
	Run     Run
	Created bool
}

// CreateTaskParams carries the fields for creating a task.
type CreateTaskParams struct {
	RunID  uuid.UUID
	Name   string
	Status TaskStatus
}

// CreateAgentParams carries the fields for creating an agent instance.
type CreateAgentParams struct {
	RunID   uuid.UUID
	TaskID  *uuid.UUID
	Profile string
	Status  AgentStatus
}

// ErrRunNotFound reports a missing run.
type ErrRunNotFound struct{ ID uuid.UUID }

func (e *ErrRunNotFound) Error() string { return "run not found: " + e.ID.String() }

// ErrRunNotAcceptingWork reports an attempt to add work to a terminal run.
type ErrRunNotAcceptingWork struct{ ID uuid.UUID }

func (e *ErrRunNotAcceptingWork) Error() string {
	return "run does not accept work: " + e.ID.String()
}

// ErrTaskNotFound reports a missing task.
type ErrTaskNotFound struct{ ID uuid.UUID }

func (e *ErrTaskNotFound) Error() string { return "task not found: " + e.ID.String() }

// ErrAgentNotFound reports a missing agent instance.
type ErrAgentNotFound struct{ ID uuid.UUID }

func (e *ErrAgentNotFound) Error() string { return "agent not found: " + e.ID.String() }

// ErrOptimisticLock reports a version mismatch on a transition.
type ErrOptimisticLock struct{ ID uuid.UUID }

func (e *ErrOptimisticLock) Error() string { return "optimistic lock conflict for: " + e.ID.String() }

// ErrRequestConflict reports reuse of an idempotency key for a different request.
type ErrRequestConflict struct{ RequestKey string }

func (e *ErrRequestConflict) Error() string {
	return "idempotency key conflicts with a different request: " + e.RequestKey
}
