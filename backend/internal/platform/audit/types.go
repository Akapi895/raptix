// Package audit records business audit history, distinct from application
// telemetry. Owner: platform/audit.
package audit

import (
	"time"

	"github.com/google/uuid"
)

// Outcome is the result of an audited action.
type Outcome string

const (
	OutcomeAllowed Outcome = "allowed"
	OutcomeDenied  Outcome = "denied"
	OutcomeError   Outcome = "error"
)

// AuditRecord is an immutable business audit entry.
type AuditRecord struct {
	ID          uuid.UUID
	Actor       string
	Action      string
	Resource    string
	Outcome     Outcome
	Reason      string
	Correlation string
	CreatedAt   time.Time
}

// Record carries the fields for creating an audit entry.
type Record struct {
	Actor       string
	Action      string
	Resource    string
	Outcome     Outcome
	Reason      string
	Correlation string
}
