package governance

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ScopeAuthority is the service contract governance uses to learn whether a
// scope may currently authorize action (exists, not expired, project active).
// It is implemented by platform/projects and wired by the composition root, so
// governance never queries the projects/scopes tables directly.
type ScopeAuthority interface {
	IsScopeActive(ctx context.Context, scopeID uuid.UUID) (bool, error)
}

// Service exposes governance operations with business rules enforced here.
type Service struct {
	repo   Repository
	scopes ScopeAuthority
}

// NewService wires a governance service over a repository and the scope
// authority it must consult before granting or checking a capability.
func NewService(repo Repository, scopes ScopeAuthority) *Service {
	return &Service{repo: repo, scopes: scopes}
}

// scopeActive reports whether the scope may currently authorize action. A nil
// authority is a wiring error, never a silent bypass: permission checks must
// not disappear because an adapter was not injected.
func (s *Service) scopeActive(ctx context.Context, scopeID uuid.UUID) (bool, error) {
	if s.scopes == nil {
		return false, fmt.Errorf("governance scope authority is not wired")
	}
	return s.scopes.IsScopeActive(ctx, scopeID)
}

// GrantCapability validates the subject, scope and capability, then persists a
// new capability grant. Grants cannot be minted into an expired scope or an
// archived project.
func (s *Service) GrantCapability(ctx context.Context, p CreateCapabilityGrantParams) (CapabilityGrant, error) {
	p.Subject = strings.TrimSpace(p.Subject)
	p.Capability = strings.TrimSpace(p.Capability)
	p.GrantedBy = strings.TrimSpace(p.GrantedBy)
	if p.Subject == "" {
		return CapabilityGrant{}, fmt.Errorf("grant subject must not be empty")
	}
	if p.Capability == "" {
		return CapabilityGrant{}, fmt.Errorf("grant capability must not be empty")
	}
	if p.GrantedBy == "" {
		return CapabilityGrant{}, fmt.Errorf("grantor must not be empty")
	}
	if p.ScopeID == uuid.Nil {
		return CapabilityGrant{}, fmt.Errorf("grant scope is required")
	}
	active, err := s.scopeActive(ctx, p.ScopeID)
	if err != nil {
		return CapabilityGrant{}, err
	}
	if !active {
		return CapabilityGrant{}, &ErrScopeNotActive{ID: p.ScopeID}
	}
	return s.repo.CreateCapabilityGrant(ctx, p)
}

// Revoke marks a capability grant as revoked.
func (s *Service) Revoke(ctx context.Context, id uuid.UUID) (CapabilityGrant, error) {
	return s.repo.RevokeCapabilityGrant(ctx, id)
}

// CheckActiveGrant reports whether the subject has an active grant for the
// capability within a scope that is still valid. Grant revocation/expiry,
// scope expiry and project archival each independently deny the check.
func (s *Service) CheckActiveGrant(ctx context.Context, subject string, scopeID uuid.UUID, capability string) (bool, error) {
	subject = strings.TrimSpace(subject)
	capability = strings.TrimSpace(capability)
	if subject == "" || capability == "" || scopeID == uuid.Nil {
		return false, nil
	}
	active, err := s.scopeActive(ctx, scopeID)
	if err != nil {
		return false, err
	}
	if !active {
		return false, nil
	}
	grants, err := s.repo.ListActiveGrantsForSubjectScope(ctx, subject, scopeID)
	if err != nil {
		return false, err
	}
	for _, g := range grants {
		if g.Capability == capability {
			if g.ExpiresAt != nil && !g.ExpiresAt.After(time.Now()) {
				continue
			}
			return true, nil
		}
	}
	return false, nil
}

// CreateApproval validates the subject, action and scope, then opens a new
// approval request.
func (s *Service) CreateApproval(ctx context.Context, p CreateApprovalParams) (Approval, error) {
	p.Subject = strings.TrimSpace(p.Subject)
	p.Action = strings.TrimSpace(p.Action)
	if p.Subject == "" {
		return Approval{}, fmt.Errorf("approval subject must not be empty")
	}
	if p.Action == "" {
		return Approval{}, fmt.Errorf("approval action must not be empty")
	}
	if p.ScopeID == uuid.Nil {
		return Approval{}, fmt.Errorf("approval scope is required")
	}
	active, err := s.scopeActive(ctx, p.ScopeID)
	if err != nil {
		return Approval{}, err
	}
	if !active {
		return Approval{}, &ErrScopeNotActive{ID: p.ScopeID}
	}
	return s.repo.CreateApproval(ctx, p)
}

// DecideApproval applies a decision to a still-pending approval. Deciding an
// approval that is no longer pending returns an error.
func (s *Service) DecideApproval(ctx context.Context, id uuid.UUID, status ApprovalStatus, decidedBy, reason string) (Approval, error) {
	switch status {
	case ApprovalApproved, ApprovalDenied, ApprovalSuperseded:
	default:
		return Approval{}, fmt.Errorf("invalid approval decision %q", status)
	}
	decidedBy = strings.TrimSpace(decidedBy)
	if decidedBy == "" {
		return Approval{}, fmt.Errorf("decider must not be empty")
	}
	approval, err := s.repo.GetApproval(ctx, id)
	if err != nil {
		return Approval{}, err
	}
	if approval.Status != ApprovalPending {
		return Approval{}, &ErrApprovalDecided{ID: id}
	}
	// An approval whose scope has expired or whose project was archived can no
	// longer authorize anything; it may still be superseded so the record can be
	// closed out.
	if status != ApprovalSuperseded {
		active, err := s.scopeActive(ctx, approval.ScopeID)
		if err != nil {
			return Approval{}, err
		}
		if !active {
			return Approval{}, &ErrScopeNotActive{ID: approval.ScopeID}
		}
	}
	// An approval that has passed its expiry can no longer be approved; it may
	// still be explicitly superseded so the record reflects why it lapsed.
	if approval.ExpiresAt != nil && !approval.ExpiresAt.After(time.Now()) && status != ApprovalSuperseded {
		return Approval{}, &ErrApprovalExpired{ID: id}
	}
	return s.repo.DecideApproval(ctx, id, status, decidedBy, reason)
}
