package projects

import (
	"context"

	"github.com/google/uuid"
)

// Repository is the persistence contract owned by this module. Implementations
// (Postgres, in-memory test double) satisfy it; handlers and other modules
// never import the generated store directly.
type Repository interface {
	CreateProject(ctx context.Context, p CreateProjectParams) (Project, error)
	GetProjectByID(ctx context.Context, id uuid.UUID) (Project, error)
	GetProjectBySlug(ctx context.Context, slug string) (Project, error)
	ListProjects(ctx context.Context) ([]Project, error)
	SetProjectStatus(ctx context.Context, id uuid.UUID, status ProjectStatus) (Project, error)
	AddMember(ctx context.Context, m Membership) (Membership, error)
	ListMembers(ctx context.Context, projectID uuid.UUID) ([]Membership, error)
	GetMemberRole(ctx context.Context, projectID uuid.UUID, subject string) (MembershipRole, error)
	CreateScope(ctx context.Context, p CreateScopeParams) (Scope, error)
	GetScope(ctx context.Context, id uuid.UUID) (Scope, error)
	ListScopes(ctx context.Context, projectID uuid.UUID) ([]Scope, error)
}
