// Package agents owns the agent loop and agent attempt: it loads the profile,
// prepares the conversation and content/capability snapshot, builds context,
// calls the model, requests capabilities through execution, and records the
// conversation. It never decides permission (execution checks governance at
// dispatch) and never writes lifecycle status directly (engine/runs owns it).
package agents

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// AttemptStatus is the lifecycle state of one agent working attempt.
type AttemptStatus string

const (
	AttemptRunning   AttemptStatus = "running"
	AttemptSucceeded AttemptStatus = "succeeded"
	AttemptFailed    AttemptStatus = "failed"
	AttemptTimedOut  AttemptStatus = "timed_out"
	AttemptCancelled AttemptStatus = "cancelled"
)

// MessageRole is the speaker of an agent conversation message.
type MessageRole string

const (
	RoleSystem    MessageRole = "system"
	RoleUser      MessageRole = "user"
	RoleAssistant MessageRole = "assistant"
	RoleTool      MessageRole = "tool"
)

// Attempt is one run of an agent instance. Owner: engine/agents.
type Attempt struct {
	ID         uuid.UUID
	AgentID    uuid.UUID
	AttemptNo  int
	Status     AttemptStatus
	StartedAt  *time.Time
	FinishedAt *time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// Message is one conversation turn recorded for an attempt. InvocationID links
// a tool turn to the tool invocation that produced it (reference only).
type Message struct {
	ID           uuid.UUID
	AttemptID    uuid.UUID
	Seq          int
	Role         MessageRole
	Content      string
	InvocationID *uuid.UUID
	CreatedAt    time.Time
}

// Snapshot is the resolved content/capability view at a point in time. Requested
// and Granted are JSON documents. A snapshot records what was resolved; it never
// substitutes for the dispatch-time permission check.
type Snapshot struct {
	ID          uuid.UUID
	AgentID     uuid.UUID
	ProfileRef  string
	ContentHash string
	Requested   json.RawMessage
	Granted     json.RawMessage
	CreatedAt   time.Time
}

// CreateAttemptParams carries the fields for starting an attempt.
type CreateAttemptParams struct {
	AgentID uuid.UUID
}

// FinishAttemptParams carries the outcome of an attempt.
type FinishAttemptParams struct {
	ID         uuid.UUID
	Status     AttemptStatus
	FinishedAt time.Time
}

// AppendMessageParams carries one conversation turn.
type AppendMessageParams struct {
	AttemptID    uuid.UUID
	Seq          int
	Role         MessageRole
	Content      string
	InvocationID *uuid.UUID
}

// CreateSnapshotParams carries a resolved snapshot.
type CreateSnapshotParams struct {
	AgentID     uuid.UUID
	ProfileRef  string
	ContentHash string
	Requested   json.RawMessage
	Granted     json.RawMessage
}

// ErrAttemptNotFound reports a missing agent attempt.
type ErrAttemptNotFound struct{ ID uuid.UUID }

func (e *ErrAttemptNotFound) Error() string { return "agent attempt not found: " + e.ID.String() }

// ErrAttemptNotRunning reports a completion race with an attempt that was
// already finished or cancelled.
type ErrAttemptNotRunning struct{ ID uuid.UUID }

func (e *ErrAttemptNotRunning) Error() string {
	return "agent attempt is not running: " + e.ID.String()
}

// ErrSnapshotNotFound reports that an agent has no recorded snapshot.
type ErrSnapshotNotFound struct{ AgentID uuid.UUID }

func (e *ErrSnapshotNotFound) Error() string {
	return "agent snapshot not found for agent: " + e.AgentID.String()
}
