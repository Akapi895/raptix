package agents

import (
	"context"

	"github.com/google/uuid"
)

// Repository is the persistence contract owned by this module. Implementations
// (Postgres, in-memory test double) satisfy it; other modules never import the
// generated store directly.
type Repository interface {
	CreateAttempt(ctx context.Context, p CreateAttemptParams) (Attempt, error)
	CreateOrGetAttempt(ctx context.Context, p CreateAttemptParams) (CreateAttemptResult, error)
	GetAttempt(ctx context.Context, id uuid.UUID) (Attempt, error)
	ListAttemptsByAgent(ctx context.Context, agentID uuid.UUID) ([]Attempt, error)
	FinishAttempt(ctx context.Context, p FinishAttemptParams) (Attempt, error)

	AppendMessage(ctx context.Context, p AppendMessageParams) (Message, error)
	ListMessages(ctx context.Context, attemptID uuid.UUID) ([]Message, error)

	CreateSnapshot(ctx context.Context, p CreateSnapshotParams) (Snapshot, error)
	GetSnapshotByAgent(ctx context.Context, agentID uuid.UUID) (Snapshot, error)
}
