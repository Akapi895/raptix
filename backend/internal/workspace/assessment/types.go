// Package assessment owns the attack-surface model: assets, observations,
// hypotheses/opportunities and coverage. It records what was found and what
// was checked; it does not grant execution rights (that is platform/governance).
package assessment

import (
	"time"

	"github.com/google/uuid"
)

// Outcome describes the result of a coverage check.
type Outcome string

const (
	// OutcomeAttempted records that a check was performed without a definitive result.
	OutcomeAttempted Outcome = "attempted"
	// OutcomeNotAttempted records that a check was not performed.
	OutcomeNotAttempted Outcome = "not_attempted"
	// OutcomeInconclusive records a check whose result was unclear.
	OutcomeInconclusive Outcome = "inconclusive"
	// OutcomeVerifiedNegative records a check that was verified to be negative.
	OutcomeVerifiedNegative Outcome = "verified_negative"
)

// HypothesisStatus is the lifecycle state of a hypothesis/opportunity.
type HypothesisStatus string

const (
	HypothesisOpen          HypothesisStatus = "open"
	HypothesisInvestigating HypothesisStatus = "investigating"
	HypothesisConfirmed     HypothesisStatus = "confirmed"
	HypothesisRefuted       HypothesisStatus = "refuted"
	HypothesisInconclusive  HypothesisStatus = "inconclusive"
)

// Asset is an attack-surface asset discovered during a run.
type Asset struct {
	ID         uuid.UUID
	RunID      uuid.UUID
	Kind       string
	Name       string
	Properties map[string]interface{}
	CreatedAt  time.Time
}

// Observation is an accepted observed response/behavior, optionally tied to an asset.
type Observation struct {
	ID         uuid.UUID
	RunID      uuid.UUID
	AssetID    *uuid.UUID
	Summary    string
	Detail     string
	EvidenceID *uuid.UUID
	CreatedAt  time.Time
}

// Hypothesis is an attack opportunity to investigate.
type Hypothesis struct {
	ID          uuid.UUID
	RunID       uuid.UUID
	Title       string
	Description string
	Status      HypothesisStatus
	CreatedAt   time.Time
}

// CoverageEntry records what was checked, by what method, and the outcome.
type CoverageEntry struct {
	ID           uuid.UUID
	RunID        uuid.UUID
	HypothesisID *uuid.UUID
	AssetID      *uuid.UUID
	Method       string
	Outcome      Outcome
	EvidenceID   *uuid.UUID
	Reason       string
	CreatedAt    time.Time
}

// CreateAssetParams carries the fields for creating an asset.
type CreateAssetParams struct {
	RunID      uuid.UUID
	Kind       string
	Name       string
	Properties map[string]interface{}
}

// CreateObservationParams carries the fields for creating an observation.
type CreateObservationParams struct {
	RunID      uuid.UUID
	AssetID    *uuid.UUID
	Summary    string
	Detail     string
	EvidenceID *uuid.UUID
}

// CreateHypothesisParams carries the fields for creating a hypothesis.
type CreateHypothesisParams struct {
	RunID       uuid.UUID
	Title       string
	Description string
}

// CreateCoverageParams carries the fields for creating a coverage entry.
type CreateCoverageParams struct {
	RunID        uuid.UUID
	HypothesisID *uuid.UUID
	AssetID      *uuid.UUID
	Method       string
	Outcome      Outcome
	EvidenceID   *uuid.UUID
	Reason       string
}

// ErrAssetNotFound reports a missing asset.
type ErrAssetNotFound struct{ ID uuid.UUID }

func (e *ErrAssetNotFound) Error() string { return "asset not found: " + e.ID.String() }

// ErrObservationNotFound reports a missing observation.
type ErrObservationNotFound struct{ ID uuid.UUID }

func (e *ErrObservationNotFound) Error() string { return "observation not found: " + e.ID.String() }

// ErrHypothesisNotFound reports a missing hypothesis.
type ErrHypothesisNotFound struct{ ID uuid.UUID }

func (e *ErrHypothesisNotFound) Error() string { return "hypothesis not found: " + e.ID.String() }

// ErrCoverageNotFound reports a missing coverage entry.
type ErrCoverageNotFound struct{ ID uuid.UUID }

func (e *ErrCoverageNotFound) Error() string { return "coverage entry not found: " + e.ID.String() }
