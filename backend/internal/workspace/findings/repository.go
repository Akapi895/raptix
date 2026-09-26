package findings

import (
	"context"

	"github.com/google/uuid"
)

// Repository is the persistence contract owned by this module. Callers (the
// service) never import the generated store directly.
type Repository interface {
	CreateFinding(ctx context.Context, p CreateFindingParams) (Finding, error)
	GetFinding(ctx context.Context, id uuid.UUID) (Finding, error)
	ListFindingsByRun(ctx context.Context, runID uuid.UUID) ([]Finding, error)
	GetCurrentRevision(ctx context.Context, findingID uuid.UUID) (FindingRevision, error)
	GetRevision(ctx context.Context, findingID uuid.UUID, revisionNo int) (FindingRevision, error)
	ListRevisions(ctx context.Context, findingID uuid.UUID) ([]FindingRevision, error)
	ReviseFinding(ctx context.Context, p ReviseFindingParams) (Finding, error)
	ReviewFinding(ctx context.Context, p ReviewFindingParams) (Finding, error)
	InsertVerdict(ctx context.Context, p InsertVerdictParams) (FindingVerdict, error)
	ListVerdicts(ctx context.Context, findingID uuid.UUID) ([]FindingVerdict, error)
	ListReviewHistory(ctx context.Context, findingID uuid.UUID) ([]ReviewHistoryEntry, error)
}
