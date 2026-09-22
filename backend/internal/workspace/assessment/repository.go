package assessment

import (
	"context"

	"github.com/google/uuid"
)

// Repository is the persistence contract owned by this module. Implementations
// (Postgres, in-memory test double) satisfy it; handlers and other modules
// never import the generated store directly.
type Repository interface {
	CreateAsset(ctx context.Context, p CreateAssetParams) (Asset, error)
	GetAsset(ctx context.Context, id uuid.UUID) (Asset, error)
	ListAssetsByRun(ctx context.Context, runID uuid.UUID) ([]Asset, error)

	CreateObservation(ctx context.Context, p CreateObservationParams) (Observation, error)
	GetObservation(ctx context.Context, id uuid.UUID) (Observation, error)
	ListObservationsByRun(ctx context.Context, runID uuid.UUID) ([]Observation, error)

	CreateHypothesis(ctx context.Context, p CreateHypothesisParams) (Hypothesis, error)
	GetHypothesis(ctx context.Context, id uuid.UUID) (Hypothesis, error)
	UpdateHypothesisStatus(ctx context.Context, id uuid.UUID, status HypothesisStatus) (Hypothesis, error)

	CreateCoverage(ctx context.Context, p CreateCoverageParams) (CoverageEntry, error)
	GetCoverage(ctx context.Context, id uuid.UUID) (CoverageEntry, error)
	ListCoverageByRun(ctx context.Context, runID uuid.UUID) ([]CoverageEntry, error)
}
