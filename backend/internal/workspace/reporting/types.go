// Package reporting owns immutable report input snapshots and report publication
// lifecycle. Rendering is deliberately performed by a separate worker.
package reporting

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Status is the lifecycle state of a report request.
type Status string

const (
	StatusQueued    Status = "queued"
	StatusRendering Status = "rendering"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
	StatusCancelled Status = "cancelled"
)

// Template identifies the exact template used to render a report. Hash is the
// lowercase SHA-256 of the template content.
type Template struct {
	ID      string
	Version string
	Hash    string
}

// Report is the persistent report request and immutable input snapshot.
type Report struct {
	ID               uuid.UUID
	RunID            uuid.UUID
	Template         Template
	Snapshot         json.RawMessage
	Status           Status
	Version          int
	LeaseOwner       string
	LeaseExpiresAt   *time.Time
	OutputArtifactID *uuid.UUID
	FailureCode      string
	FailureMessage   string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// RequestParams creates the single idempotent report request for a run.
type RequestParams struct {
	RunID    uuid.UUID
	Template Template
}

// ClaimParams identifies a worker and its expected report version. The worker
// may claim a queued report or take over an expired rendering lease.
type ClaimParams struct {
	ID              uuid.UUID
	ExpectedVersion int
	Worker          string
	LeaseDuration   time.Duration
}

// CompleteParams finalizes a leased render using an already available evidence
// artifact. The repository performs the final compare-and-swap.
type CompleteParams struct {
	ID               uuid.UUID
	ExpectedVersion  int
	Worker           string
	OutputArtifactID uuid.UUID
}

// FailParams records a worker failure while it holds an unexpired lease.
type FailParams struct {
	ID              uuid.UUID
	ExpectedVersion int
	Worker          string
	Code            string
	Message         string
}

// CancelParams cancels queued or rendering report work at the expected version.
type CancelParams struct {
	ID              uuid.UUID
	ExpectedVersion int
}

// ErrReportNotFound reports a missing report request.
type ErrReportNotFound struct{ ID uuid.UUID }

func (e *ErrReportNotFound) Error() string { return "report not found: " + e.ID.String() }

// ErrReportAlreadyRequested reports an attempt to change the single report
// request for a run. Retrying with the same template returns the existing row.
type ErrReportAlreadyRequested struct{ RunID uuid.UUID }

func (e *ErrReportAlreadyRequested) Error() string {
	return "report already requested for run: " + e.RunID.String()
}

// ErrOptimisticLock reports a status, version, or lease mismatch.
type ErrOptimisticLock struct{ ID uuid.UUID }

func (e *ErrOptimisticLock) Error() string {
	return "optimistic lock conflict for report: " + e.ID.String()
}
