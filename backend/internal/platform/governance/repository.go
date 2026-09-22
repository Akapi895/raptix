package governance

import (
	"context"

	"github.com/google/uuid"
)

// Repository is the persistence contract owned by this module. Implementations
// (Postgres, in-memory test double) satisfy it; handlers and other modules
// never import the generated store directly.
type Repository interface {
	CreateRole(ctx context.Context, name, description string) (Role, error)
	CreatePermission(ctx context.Context, name, comment string) (Permission, error)
	GrantRolePermission(ctx context.Context, roleID, permissionID uuid.UUID) error
	RoleHasPermission(ctx context.Context, roleID, permissionID uuid.UUID) (bool, error)

	CreateCapabilityGrant(ctx context.Context, p CreateCapabilityGrantParams) (CapabilityGrant, error)
	GetCapabilityGrant(ctx context.Context, id uuid.UUID) (CapabilityGrant, error)
	RevokeCapabilityGrant(ctx context.Context, id uuid.UUID) (CapabilityGrant, error)
	ListActiveGrantsForSubjectScope(ctx context.Context, subject string, scopeID uuid.UUID) ([]CapabilityGrant, error)

	CreateApproval(ctx context.Context, p CreateApprovalParams) (Approval, error)
	GetApproval(ctx context.Context, id uuid.UUID) (Approval, error)
	DecideApproval(ctx context.Context, id uuid.UUID, status ApprovalStatus, decidedBy, reason string) (Approval, error)
}
