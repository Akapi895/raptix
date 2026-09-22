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
	// TransitionFindingWithHistory applies a status change and its review
	// history atomically; version is the optimistic lock. The from-status is
	// derived from the row being updated, not passed by the caller.
	TransitionFindingWithHistory(ctx context.Context, id uuid.UUID, version int, to FindingStatus, reviewer, reason string) (Finding, error)
	LinkEvidence(ctx context.Context, link EvidenceLink) error
	InsertVerdict(ctx context.Context, p InsertVerdictParams) (FindingVerdict, error)
	ListVerdicts(ctx context.Context, findingID uuid.UUID) ([]FindingVerdict, error)
	ListReviewHistory(ctx context.Context, findingID uuid.UUID) ([]ReviewHistoryEntry, error)
}
