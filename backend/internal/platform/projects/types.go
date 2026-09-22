// Package projects owns project metadata, membership and engagement scope.
// A project scope describes what is authorized to be tested; it does not by
// itself grant execution rights (that is platform/governance + execution).
package projects

import (
	"time"

	"github.com/google/uuid"
)

// ProjectStatus is the lifecycle state of a project.
type ProjectStatus string

const (
	ProjectActive   ProjectStatus = "active"
	ProjectArchived ProjectStatus = "archived"
)

// MembershipRole is a member's role within a project. It is a project-local
// role; an agent persona with the same name is not a substitute principal.
type MembershipRole string

const (
	RoleOwner    MembershipRole = "owner"
	RoleMember   MembershipRole = "member"
	RoleReviewer MembershipRole = "reviewer"
)

// Project is an engagement container. Owner: platform/projects.
type Project struct {
	ID        uuid.UUID
	Name      string
	Slug      string
	Status    ProjectStatus
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Membership links a subject to a project with a local role.
type Membership struct {
	ProjectID uuid.UUID
	Subject   string
	Role      MembershipRole
	CreatedAt time.Time
}

// CreateProjectParams carries the fields for creating a project.
type CreateProjectParams struct {
	Name string
	Slug string
}

// Scope is a versioned engagement boundary. New assets must not extend scope.
type Scope struct {
	ID           uuid.UUID
	ProjectID    uuid.UUID
	Version      int
	AssetTypes   []string
	Include      []string
	Exclude      []string
	ExpiresAt    *time.Time
	ApprovalNote *string
	CreatedAt    time.Time
}

// CreateScopeParams carries the fields for creating a scope version.
type CreateScopeParams struct {
	ProjectID    uuid.UUID
	AssetTypes   []string
	Include      []string
	Exclude      []string
	ExpiresAt    *time.Time
	ApprovalNote *string
}

// ErrNotFound reports a missing project/scope/membership.
type ErrProjectNotFound struct{ ID uuid.UUID }

func (e *ErrProjectNotFound) Error() string { return "project not found: " + e.ID.String() }

// ErrScopeNotFound reports a missing scope.
type ErrScopeNotFound struct{ ID uuid.UUID }

func (e *ErrScopeNotFound) Error() string { return "scope not found: " + e.ID.String() }
