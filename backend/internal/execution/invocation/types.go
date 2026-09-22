// Package invocation owns tool invocation lifecycle: dispatch, result capture
// and status transitions. It checks governance at dispatch time, records the
// invocation durable list and writes evidence through a contract. Owner:
// execution/invocation.
package invocation

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Status is the lifecycle state of a tool invocation.
type Status string

const (
	StatusPending    Status = "pending"
	StatusDispatched Status = "dispatched"
	StatusRunning    Status = "running"
	StatusSucceeded  Status = "succeeded"
	StatusFailed     Status = "failed"
	StatusTimedOut   Status = "timed_out"
	StatusCancelled  Status = "cancelled"
	StatusDenied     Status = "denied"
	StatusUnknown    Status = "unknown"
)

// Invocation is a persistent record of one capability call. Status order is
// pending -> dispatched -> running -> terminal (succeeded|failed|timed_out|
// cancelled|denied). A crash may leave a pending/running row that Phase 6
// reconciles to unknown.
type Invocation struct {
	ID                   uuid.UUID
	RunID                uuid.UUID
	TaskID               *uuid.UUID
	ScopeID              uuid.UUID
	Actor                string
	Capability           string
	CapabilityVersion    string
	Status               Status
	Request              json.RawMessage
	RawArtifactID        *uuid.UUID
	StructuredArtifactID *uuid.UUID
	ResultExecution      string
	ResultParse          string
	ExitCode             *int
	ErrorCode            string
	ErrorMessage         string
	IdempotencyKey       string
	Version              int
	StartedAt            *time.Time
	FinishedAt           *time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// CreateParams carries the fields for recording a pending invocation.
type CreateParams struct {
	RunID             uuid.UUID
	TaskID            *uuid.UUID
	ScopeID           uuid.UUID
	Actor             string
	Capability        string
	CapabilityVersion string
	Request           json.RawMessage
	IdempotencyKey    string
}

// ResultUpdate applies the outcome of a dispatch.
type ResultUpdate struct {
	ID                   uuid.UUID
	Version              int
	Status               Status
	RawArtifactID        *uuid.UUID
	StructuredArtifactID *uuid.UUID
	ResultExecution      string
	ResultParse          string
	ExitCode             *int
	ErrorCode            string
	ErrorMessage         string
	FinishedAt           time.Time
}

// ErrInvocationNotFound reports a missing invocation.
type ErrInvocationNotFound struct{ ID uuid.UUID }

func (e *ErrInvocationNotFound) Error() string { return "invocation not found: " + e.ID.String() }

// ErrOptimisticLock reports a state/version mismatch on a transition.
type ErrOptimisticLock struct{ ID uuid.UUID }

func (e *ErrOptimisticLock) Error() string { return "optimistic lock conflict for: " + e.ID.String() }

// ErrRunNotAcceptingWork reports that the run became terminal before its
// invocation could be recorded.
type ErrRunNotAcceptingWork struct{ RunID uuid.UUID }

func (e *ErrRunNotAcceptingWork) Error() string {
	return "run does not accept work: " + e.RunID.String()
}

// ErrIdempotencyConflict reports a simultaneous first use of an idempotency
// key. Callers must read the stored invocation rather than dispatching again.
type ErrIdempotencyConflict struct {
	RunID uuid.UUID
	Key   string
}

func (e *ErrIdempotencyConflict) Error() string {
	return "idempotency key already exists for run " + e.RunID.String()
}

// ErrOutcomeUnknown reports that a prior invocation for the same idempotency key
// is non-terminal or unknown: its external effect may have happened but the
// result is not recorded. The caller must reconcile before concluding, and must
// NOT treat the work as done or re-dispatch.
type ErrOutcomeUnknown struct {
	ID     uuid.UUID
	Status Status
}

func (e *ErrOutcomeUnknown) Error() string {
	return "invocation " + e.ID.String() + " outcome is unknown (status " + string(e.Status) + ")"
}
