package reporting

import (
	"context"

	"github.com/google/uuid"
)

// CreateResult distinguishes the first request creation from an idempotent
// replay that returned the existing single report for the run.
type CreateResult struct {
	Report  Report
	Created bool
}

// Repository is the reporting persistence contract. Other modules use the
// service and never import the generated SQL store.
type Repository interface {
	CreateOrGet(ctx context.Context, p CreateParams) (CreateResult, error)
	Get(ctx context.Context, id uuid.UUID) (Report, error)
	GetByRun(ctx context.Context, runID uuid.UUID) (Report, error)
	Claim(ctx context.Context, p ClaimParams) (Report, error)
	Complete(ctx context.Context, p CompleteParams) (Report, error)
	Fail(ctx context.Context, p FailParams) (Report, error)
	Cancel(ctx context.Context, p CancelParams) (Report, error)
}

// CreateParams carries already-captured immutable data to persistence.
type CreateParams struct {
	RunID    uuid.UUID
	Template Template
	Snapshot []byte
}
