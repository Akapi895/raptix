// Package governance owns roles, permissions, capability grants and approvals.
// It is the only module that decides whether a subject may exercise a capability;
// profiles, personas and installed manifests do not grant execution rights.
package governance

import (
	"time"

	"github.com/google/uuid"
)

// GrantStatus is the lifecycle state of a capability grant.
type GrantStatus string

const (
	GrantActive  GrantStatus = "active"
	GrantRevoked GrantStatus = "revoked"
)

// ApprovalStatus is the lifecycle state of an approval request.
type ApprovalStatus string

const (
	ApprovalPending    ApprovalStatus = "pending"
	ApprovalApproved   ApprovalStatus = "approved"
	ApprovalDenied     ApprovalStatus = "denied"
	ApprovalSuperseded ApprovalStatus = "superseded"
)

// Role is a named set of permissions. Owner: platform/governance.
type Role struct {
	ID          uuid.UUID
	Name        string
	Description string
}

// Permission names an individual capability of the platform.
type Permission struct {
	ID      uuid.UUID
	Name    string
	Comment string
}

// CapabilityGrant authorizes a subject to use a capability within a scope.
// It is checked against the current scope at dispatch time.
type CapabilityGrant struct {
	ID         uuid.UUID
	Subject    string
	ScopeID    uuid.UUID
	Capability string
	GrantedBy  string
	CreatedAt  time.Time
	RevokedAt  *time.Time
	ExpiresAt  *time.Time
}

// CreateCapabilityGrantParams carries the fields for granting a capability.
type CreateCapabilityGrantParams struct {
	Subject    string
	ScopeID    uuid.UUID
	Capability string
	GrantedBy  string
	ExpiresAt  *time.Time
}

// Approval is a pending request to authorize an action within a scope.
type Approval struct {
	ID        uuid.UUID
	Subject   string
	ScopeID   uuid.UUID
	Action    string
	Status    ApprovalStatus
	DecidedBy *string
	DecidedAt *time.Time
	Reason    string
	CreatedAt time.Time
	ExpiresAt *time.Time
}

// CreateApprovalParams carries the fields for opening an approval request.
type CreateApprovalParams struct {
	Subject   string
	ScopeID   uuid.UUID
	Action    string
	ExpiresAt *time.Time
}

// ErrRoleNotFound reports a missing role.
type ErrRoleNotFound struct{ ID uuid.UUID }

func (e *ErrRoleNotFound) Error() string { return "role not found: " + e.ID.String() }

// ErrPermissionNotFound reports a missing permission.
type ErrPermissionNotFound struct{ ID uuid.UUID }

func (e *ErrPermissionNotFound) Error() string { return "permission not found: " + e.ID.String() }

// ErrCapabilityGrantNotFound reports a missing capability grant.
type ErrCapabilityGrantNotFound struct{ ID uuid.UUID }

func (e *ErrCapabilityGrantNotFound) Error() string {
	return "capability grant not found: " + e.ID.String()
}

// ErrApprovalNotFound reports a missing approval.
type ErrApprovalNotFound struct{ ID uuid.UUID }

func (e *ErrApprovalNotFound) Error() string { return "approval not found: " + e.ID.String() }

// ErrApprovalDecided reports an attempt to decide an approval that is no longer pending.
type ErrApprovalDecided struct{ ID uuid.UUID }

func (e *ErrApprovalDecided) Error() string {
	return "approval already decided: " + e.ID.String()
}

// ErrScopeNotActive reports a scope that cannot authorize action (missing,
// expired, or belonging to an archived project).
type ErrScopeNotActive struct{ ID uuid.UUID }

func (e *ErrScopeNotActive) Error() string {
	return "scope is not active: " + e.ID.String()
}

// ErrApprovalExpired reports an approval that passed its expiry before decision.
type ErrApprovalExpired struct{ ID uuid.UUID }

func (e *ErrApprovalExpired) Error() string {
	return "approval expired: " + e.ID.String()
}
