package evidence

import (
	"context"

	"github.com/google/uuid"
)

// Repository is the persistence contract owned by this module. Implementations
// (Postgres, in-memory test double) satisfy it; handlers and other modules
// never import the generated store directly.
type Repository interface {
	CreateArtifact(ctx context.Context, p CreateArtifactParams) (Artifact, error)
	GetArtifact(ctx context.Context, id uuid.UUID) (Artifact, error)
	GetArtifactBySHA256(ctx context.Context, sha256 string) (Artifact, error)
	GetArtifactBySHA256InRun(ctx context.Context, runID uuid.UUID, sha256 string) (Artifact, error)
	ListArtifactsByRun(ctx context.Context, runID uuid.UUID) ([]Artifact, error)
	ListDerived(ctx context.Context, parentID uuid.UUID) ([]Artifact, error)
}
