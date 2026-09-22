// Package findings owns the finding aggregate, severity/confidence, revision,
// evidence links and review history. It is the ONLY owner of finding status
// transitions; a verifier may record a verdict but must never change status
// directly.
package findings

import (
	"time"

	"github.com/google/uuid"
)

// Severity rates the impact of a finding.
type Severity string

const (
	SeverityNone     Severity = "none"
	SeverityLow      Severity = "low"
	SeverityMedium   Severity = "medium"
	SeverityHigh     Severity = "high"
	SeverityCritical Severity = "critical"
)

// Confidence rates how certain the finding is.
type Confidence string

const (
	ConfidenceLow    Confidence = "low"
	ConfidenceMedium Confidence = "medium"
	ConfidenceHigh   Confidence = "high"
)

// FindingStatus is the lifecycle state of a finding.
type FindingStatus string

const (
	StatusDraft        FindingStatus = "draft"
	StatusReviewed     FindingStatus = "reviewed"
	StatusConfirmed    FindingStatus = "confirmed"
	StatusRejected     FindingStatus = "rejected"
	StatusInconclusive FindingStatus = "inconclusive"
)

// Verdict is an assessment produced by a verifier.
type Verdict string

const (
	VerdictConfirmed    Verdict = "confirmed"
	VerdictRefuted      Verdict = "refuted"
	VerdictInconclusive Verdict = "inconclusive"
)

// Finding is the aggregate root.
type Finding struct {
	ID          uuid.UUID
	RunID       uuid.UUID
	Title       string
	Description string
	Severity    Severity
	Confidence  Confidence
	Status      FindingStatus
	Version     int
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// CreateFindingParams carries the inputs for a new finding draft.
type CreateFindingParams struct {
	RunID       uuid.UUID
	Title       string
	Description string
	Severity    Severity
	Confidence  Confidence
}

// EvidenceLink ties an artifact to a finding with a role.
type EvidenceLink struct {
	FindingID  uuid.UUID
	EvidenceID uuid.UUID
	Role       string
}

// FindingVerdict is a recorded verification result. Recording one never changes
// the finding status.
type FindingVerdict struct {
	ID         uuid.UUID
	FindingID  uuid.UUID
	Verdict    Verdict
	Reason     string
	ProducedBy string
	CreatedAt  time.Time
}

// InsertVerdictParams carries a verifier-produced verdict.
type InsertVerdictParams struct {
	FindingID  uuid.UUID
	Verdict    Verdict
	Reason     string
	ProducedBy string
}

// ReviewHistoryEntry records a status transition. Owner: findings service.
type ReviewHistoryEntry struct {
	ID         uuid.UUID
	FindingID  uuid.UUID
	FromStatus FindingStatus
	ToStatus   FindingStatus
	Reviewer   string
	Reason     string
	CreatedAt  time.Time
}

// ErrFindingNotFound reports a missing finding.
type ErrFindingNotFound struct{ ID uuid.UUID }

func (e *ErrFindingNotFound) Error() string { return "finding not found: " + e.ID.String() }

// ErrOptimisticLock reports a concurrent status update on the same finding.
type ErrOptimisticLock struct{ ID uuid.UUID }

func (e *ErrOptimisticLock) Error() string { return "finding version conflict: " + e.ID.String() }

// ErrIllegalTransition reports a disallowed status transition.
type ErrIllegalTransition struct{ From, To FindingStatus }

func (e *ErrIllegalTransition) Error() string {
	return "illegal finding transition: " + string(e.From) + " -> " + string(e.To)
}
