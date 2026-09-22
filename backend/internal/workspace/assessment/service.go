package assessment

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Service exposes assessment operations with business rules enforced here.
type Service struct {
	repo Repository
}

// NewService wires an assessment service over a repository.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// RecordAsset validates and persists a new asset.
func (s *Service) RecordAsset(ctx context.Context, p CreateAssetParams) (Asset, error) {
	if strings.TrimSpace(p.Kind) == "" {
		return Asset{}, fmt.Errorf("asset kind must not be empty")
	}
	if strings.TrimSpace(p.Name) == "" {
		return Asset{}, fmt.Errorf("asset name must not be empty")
	}
	return s.repo.CreateAsset(ctx, p)
}

// GetAsset returns an asset by id.
func (s *Service) GetAsset(ctx context.Context, id uuid.UUID) (Asset, error) {
	return s.repo.GetAsset(ctx, id)
}

// ListAssetsByRun returns the assets of a run.
func (s *Service) ListAssetsByRun(ctx context.Context, runID uuid.UUID) ([]Asset, error) {
	return s.repo.ListAssetsByRun(ctx, runID)
}

// RecordObservation validates and persists an observation.
func (s *Service) RecordObservation(ctx context.Context, p CreateObservationParams) (Observation, error) {
	if strings.TrimSpace(p.Summary) == "" {
		return Observation{}, fmt.Errorf("observation summary must not be empty")
	}
	return s.repo.CreateObservation(ctx, p)
}

// GetObservation returns an observation by id.
func (s *Service) GetObservation(ctx context.Context, id uuid.UUID) (Observation, error) {
	return s.repo.GetObservation(ctx, id)
}

// ListObservationsByRun returns the observations of a run.
func (s *Service) ListObservationsByRun(ctx context.Context, runID uuid.UUID) ([]Observation, error) {
	return s.repo.ListObservationsByRun(ctx, runID)
}

// RecordHypothesis validates and persists a new hypothesis/opportunity in the
// open state. It is exposed at the service boundary so application use cases
// can create hypotheses without reaching into the module repository.
func (s *Service) RecordHypothesis(ctx context.Context, p CreateHypothesisParams) (Hypothesis, error) {
	if strings.TrimSpace(p.Title) == "" {
		return Hypothesis{}, fmt.Errorf("hypothesis title must not be empty")
	}
	return s.repo.CreateHypothesis(ctx, p)
}

// GetHypothesis returns a hypothesis by id.
func (s *Service) GetHypothesis(ctx context.Context, id uuid.UUID) (Hypothesis, error) {
	return s.repo.GetHypothesis(ctx, id)
}

// RecordCoverage validates and persists a coverage entry. A non-not_attempted
// outcome must be one of the allowed set; an unverified outcome must not be
// recorded as verified_negative.
func (s *Service) RecordCoverage(ctx context.Context, p CreateCoverageParams) (CoverageEntry, error) {
	switch p.Outcome {
	case OutcomeAttempted, OutcomeInconclusive:
		// Allowed.
	case OutcomeVerifiedNegative:
		// A verified negative is a positive record of verification and must be
		// backed by evidence; otherwise it is indistinguishable from an
		// unsupported assertion.
		if p.EvidenceID == nil || *p.EvidenceID == uuid.Nil {
			return CoverageEntry{}, fmt.Errorf("verified_negative requires an evidence reference")
		}
	case OutcomeNotAttempted:
		// Allowed.
	default:
		return CoverageEntry{}, fmt.Errorf("invalid coverage outcome %q", p.Outcome)
	}
	if strings.TrimSpace(p.Method) == "" {
		return CoverageEntry{}, fmt.Errorf("coverage method must not be empty")
	}
	return s.repo.CreateCoverage(ctx, p)
}

// SetHypothesisStatus updates a hypothesis to one of the defined statuses.
func (s *Service) SetHypothesisStatus(ctx context.Context, id uuid.UUID, status HypothesisStatus) (Hypothesis, error) {
	switch status {
	case HypothesisOpen, HypothesisInvestigating, HypothesisConfirmed, HypothesisRefuted, HypothesisInconclusive:
	default:
		return Hypothesis{}, fmt.Errorf("invalid hypothesis status %q", status)
	}
	return s.repo.UpdateHypothesisStatus(ctx, id, status)
}

// ListCoverageByRun returns all coverage entries for a run.
func (s *Service) ListCoverageByRun(ctx context.Context, runID uuid.UUID) ([]CoverageEntry, error) {
	return s.repo.ListCoverageByRun(ctx, runID)
}

// GetCoverage returns a coverage entry by id.
func (s *Service) GetCoverage(ctx context.Context, id uuid.UUID) (CoverageEntry, error) {
	return s.repo.GetCoverage(ctx, id)
}
