package projects

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Service exposes project/scope operations with business rules enforced here.
type Service struct {
	repo Repository
}

// NewService wires a projects service over a repository.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// CreateProject validates and persists a new project.
func (s *Service) CreateProject(ctx context.Context, name, slug string) (Project, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Project{}, fmt.Errorf("project name must not be empty")
	}
	slug = strings.TrimSpace(strings.ToLower(slug))
	if !slugRe.MatchString(slug) {
		return Project{}, fmt.Errorf("project slug %q is invalid (lowercase letters, digits, '-' only)", slug)
	}
	return s.repo.CreateProject(ctx, CreateProjectParams{Name: name, Slug: slug})
}

// GetProjectByID returns a project or a typed not-found error.
func (s *Service) GetProjectByID(ctx context.Context, id uuid.UUID) (Project, error) {
	return s.repo.GetProjectByID(ctx, id)
}

// GetProjectBySlug returns a project by slug.
func (s *Service) GetProjectBySlug(ctx context.Context, slug string) (Project, error) {
	return s.repo.GetProjectBySlug(ctx, slug)
}

// GetScope returns a scope by id.
func (s *Service) GetScope(ctx context.Context, id uuid.UUID) (Scope, error) {
	return s.repo.GetScope(ctx, id)
}

// ListScopes returns the scopes of a project, newest version first.
func (s *Service) ListScopes(ctx context.Context, projectID uuid.UUID) ([]Scope, error) {
	return s.repo.ListScopes(ctx, projectID)
}

// GetMemberRole returns a member's role in a project or "" when not a member.
func (s *Service) GetMemberRole(ctx context.Context, projectID uuid.UUID, subject string) (MembershipRole, error) {
	return s.repo.GetMemberRole(ctx, projectID, subject)
}

// ListMembers returns the members of a project.
func (s *Service) ListMembers(ctx context.Context, projectID uuid.UUID) ([]Membership, error) {
	return s.repo.ListMembers(ctx, projectID)
}

// ListProjects returns all projects.
func (s *Service) ListProjects(ctx context.Context) ([]Project, error) {
	return s.repo.ListProjects(ctx)
}

// AddMember adds a member with a local project role.
func (s *Service) AddMember(ctx context.Context, projectID uuid.UUID, subject string, role MembershipRole) (Membership, error) {
	if subject == "" {
		return Membership{}, fmt.Errorf("member subject must not be empty")
	}
	switch role {
	case RoleOwner, RoleMember, RoleReviewer:
	default:
		return Membership{}, fmt.Errorf("invalid membership role %q", role)
	}
	return s.repo.AddMember(ctx, Membership{ProjectID: projectID, Subject: subject, Role: role})
}

// CreateScope validates that fields are non-empty and persists a scope as the
// next version for its project.
func (s *Service) CreateScope(ctx context.Context, p CreateScopeParams) (Scope, error) {
	if p.ProjectID == uuid.Nil {
		return Scope{}, fmt.Errorf("scope project id is required")
	}
	if len(p.AssetTypes) == 0 {
		return Scope{}, fmt.Errorf("scope must declare at least one asset type")
	}
	if p.ExpiresAt != nil && !p.ExpiresAt.After(time.Now()) {
		return Scope{}, fmt.Errorf("scope expiry must be in the future")
	}
	return s.repo.CreateScope(ctx, p)
}

// IsScopeActive reports whether a scope may currently authorize action: it must
// exist, belong to an active project and not have expired. This is the
// service-contract entry point other modules (governance) use instead of
// querying projects/scopes tables directly.
func (s *Service) IsScopeActive(ctx context.Context, scopeID uuid.UUID) (bool, error) {
	if scopeID == uuid.Nil {
		return false, nil
	}
	scope, err := s.repo.GetScope(ctx, scopeID)
	if err != nil {
		var notFound *ErrScopeNotFound
		if errors.As(err, &notFound) {
			return false, nil
		}
		return false, err
	}
	if scope.ExpiresAt != nil && !scope.ExpiresAt.After(time.Now()) {
		return false, nil
	}
	project, err := s.repo.GetProjectByID(ctx, scope.ProjectID)
	if err != nil {
		var notFound *ErrProjectNotFound
		if errors.As(err, &notFound) {
			return false, nil
		}
		return false, err
	}
	return project.Status == ProjectActive, nil
}
