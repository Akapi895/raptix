package governance

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
)

// memRepo is an in-memory Repository used by unit tests (no database required).
type memRepo struct {
	roles       map[uuid.UUID]Role
	permissions map[uuid.UUID]Permission
	grants      map[uuid.UUID]CapabilityGrant
	approvals   map[uuid.UUID]Approval
	next        int
}

func newMemRepo() *memRepo {
	return &memRepo{
		roles:       map[uuid.UUID]Role{},
		permissions: map[uuid.UUID]Permission{},
		grants:      map[uuid.UUID]CapabilityGrant{},
		approvals:   map[uuid.UUID]Approval{},
	}
}

func (m *memRepo) newID() uuid.UUID {
	m.next++
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("governance-"+strconv.Itoa(m.next)))
}

func (m *memRepo) CreateRole(ctx context.Context, name, description string) (Role, error) {
	id := m.newID()
	r := Role{ID: id, Name: name, Description: description}
	m.roles[id] = r
	return r, nil
}

func (m *memRepo) CreatePermission(ctx context.Context, name, comment string) (Permission, error) {
	id := m.newID()
	p := Permission{ID: id, Name: name, Comment: comment}
	m.permissions[id] = p
	return p, nil
}

func (m *memRepo) GrantRolePermission(ctx context.Context, roleID, permissionID uuid.UUID) error {
	return nil
}

func (m *memRepo) RoleHasPermission(ctx context.Context, roleID, permissionID uuid.UUID) (bool, error) {
	return false, nil
}

func (m *memRepo) CreateCapabilityGrant(ctx context.Context, p CreateCapabilityGrantParams) (CapabilityGrant, error) {
	id := m.newID()
	g := CapabilityGrant{
		ID: id, Subject: p.Subject, ScopeID: p.ScopeID, Capability: p.Capability,
		GrantedBy: p.GrantedBy, ExpiresAt: p.ExpiresAt,
	}
	m.grants[id] = g
	return g, nil
}

func (m *memRepo) GetCapabilityGrant(ctx context.Context, id uuid.UUID) (CapabilityGrant, error) {
	g, ok := m.grants[id]
	if !ok {
		return CapabilityGrant{}, &ErrCapabilityGrantNotFound{ID: id}
	}
	return g, nil
}

func (m *memRepo) RevokeCapabilityGrant(ctx context.Context, id uuid.UUID) (CapabilityGrant, error) {
	g, ok := m.grants[id]
	if !ok {
		return CapabilityGrant{}, &ErrCapabilityGrantNotFound{ID: id}
	}
	now := timeNow()
	g.RevokedAt = &now
	m.grants[id] = g
	return g, nil
}

// ListActiveGrantsForSubjectScope mirrors the production SQL filter: revoked
// grants and grants past their expiry are never returned as active.
func (m *memRepo) ListActiveGrantsForSubjectScope(ctx context.Context, subject string, scopeID uuid.UUID) ([]CapabilityGrant, error) {
	out := make([]CapabilityGrant, 0)
	for _, g := range m.grants {
		if g.Subject != subject || g.ScopeID != scopeID || g.RevokedAt != nil {
			continue
		}
		if g.ExpiresAt != nil && !g.ExpiresAt.After(timeNow()) {
			continue
		}
		out = append(out, g)
	}
	return out, nil
}

func (m *memRepo) CreateApproval(ctx context.Context, p CreateApprovalParams) (Approval, error) {
	id := m.newID()
	a := Approval{
		ID: id, Subject: p.Subject, ScopeID: p.ScopeID, Action: p.Action,
		Status: ApprovalPending, ExpiresAt: p.ExpiresAt,
	}
	m.approvals[id] = a
	return a, nil
}

func (m *memRepo) GetApproval(ctx context.Context, id uuid.UUID) (Approval, error) {
	a, ok := m.approvals[id]
	if !ok {
		return Approval{}, &ErrApprovalNotFound{ID: id}
	}
	return a, nil
}

func (m *memRepo) DecideApproval(ctx context.Context, id uuid.UUID, status ApprovalStatus, decidedBy, reason string) (Approval, error) {
	a, ok := m.approvals[id]
	if !ok {
		return Approval{}, &ErrApprovalNotFound{ID: id}
	}
	if a.Status != ApprovalPending {
		return Approval{}, &ErrApprovalDecided{ID: id}
	}
	a.Status = status
	db := decidedBy
	a.DecidedBy = &db
	now := timeNow()
	a.DecidedAt = &now
	a.Reason = reason
	m.approvals[id] = a
	return a, nil
}

var timeNow = func() time.Time { return time.Now() }

// fakeAuthority is the ScopeAuthority test double: every scope is active
// unless explicitly marked inactive, which lets tests exercise the scope
// validity gate independently of grant state.
type fakeAuthority struct {
	inactive map[uuid.UUID]bool
}

func newAuthority() *fakeAuthority {
	return &fakeAuthority{inactive: map[uuid.UUID]bool{}}
}

func (a *fakeAuthority) IsScopeActive(ctx context.Context, scopeID uuid.UUID) (bool, error) {
	return scopeID != uuid.Nil && !a.inactive[scopeID], nil
}

func newTestService() (*Service, *fakeAuthority) {
	authority := newAuthority()
	return NewService(newMemRepo(), authority), authority
}

func TestGrantThenCheckActive(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	scope := uuid.New()
	g, err := svc.GrantCapability(ctx, CreateCapabilityGrantParams{
		Subject: "alice", ScopeID: scope, Capability: "run.start", GrantedBy: "admin",
	})
	if err != nil {
		t.Fatal(err)
	}
	if g.Capability != "run.start" {
		t.Errorf("capability = %q", g.Capability)
	}
	ok, err := svc.CheckActiveGrant(ctx, "alice", scope, "run.start")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Error("expected active grant after creation")
	}
}

func TestRevokeMakesGrantInactive(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	scope := uuid.New()
	g, err := svc.GrantCapability(ctx, CreateCapabilityGrantParams{
		Subject: "alice", ScopeID: scope, Capability: "finding.review", GrantedBy: "admin",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Revoke(ctx, g.ID); err != nil {
		t.Fatal(err)
	}
	ok, err := svc.CheckActiveGrant(ctx, "alice", scope, "finding.review")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Error("expected no active grant after revoke")
	}
}

func TestDecideApprovalTwiceFails(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	scope := uuid.New()
	a, err := svc.CreateApproval(ctx, CreateApprovalParams{
		Subject: "alice", ScopeID: scope, Action: "run.high_risk",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.DecideApproval(ctx, a.ID, ApprovalApproved, "reviewer", "ok"); err != nil {
		t.Fatal(err)
	}
	_, err = svc.DecideApproval(ctx, a.ID, ApprovalDenied, "reviewer", "no")
	if err == nil {
		t.Fatal("expected error when deciding an already-decided approval")
	}
	var decided *ErrApprovalDecided
	if !errors.As(err, &decided) {
		t.Errorf("expected ErrApprovalDecided, got %v", err)
	}
}

func TestGrantRejectsEmptyCapability(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	_, err := svc.GrantCapability(ctx, CreateCapabilityGrantParams{
		Subject: "alice", ScopeID: uuid.New(), Capability: "   ", GrantedBy: "admin",
	})
	if err == nil {
		t.Fatal("expected error for empty capability")
	}
}

func TestExpiredScopeDeniesGrantAndCheck(t *testing.T) {
	svc, authority := newTestService()
	ctx := context.Background()
	scope := uuid.New()
	authority.inactive[scope] = true

	if _, err := svc.GrantCapability(ctx, CreateCapabilityGrantParams{
		Subject: "alice", ScopeID: scope, Capability: "run.start", GrantedBy: "admin",
	}); err == nil {
		t.Fatal("expected grant into inactive scope to be denied")
	} else {
		var target *ErrScopeNotActive
		if !errors.As(err, &target) {
			t.Fatalf("err = %v, want ErrScopeNotActive", err)
		}
	}
	ok, err := svc.CheckActiveGrant(ctx, "alice", scope, "run.start")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Error("inactive scope must deny an otherwise valid grant")
	}
}

func TestExpiredGrantDeniedEvenWithActiveScope(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	scope := uuid.New()
	past := time.Now().Add(-time.Minute)
	if _, err := svc.GrantCapability(ctx, CreateCapabilityGrantParams{
		Subject: "alice", ScopeID: scope, Capability: "nmap", GrantedBy: "admin", ExpiresAt: &past,
	}); err != nil {
		t.Fatal(err)
	}
	ok, err := svc.CheckActiveGrant(ctx, "alice", scope, "nmap")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Error("expired grant must not be active")
	}
}

func TestGrantRequiresGrantor(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	_, err := svc.GrantCapability(ctx, CreateCapabilityGrantParams{
		Subject: "alice", ScopeID: uuid.New(), Capability: "nmap", GrantedBy: "  ",
	})
	if err == nil {
		t.Fatal("expected error for empty grantor")
	}
}

func TestDecideExpiredApprovalRejected(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	past := time.Now().Add(-time.Minute)
	a, err := svc.CreateApproval(ctx, CreateApprovalParams{
		Subject: "alice", ScopeID: uuid.New(), Action: "run.high_risk", ExpiresAt: &past,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.DecideApproval(ctx, a.ID, ApprovalApproved, "reviewer", "ok"); err == nil {
		t.Fatal("expected approving an expired approval to fail")
	} else {
		var target *ErrApprovalExpired
		if !errors.As(err, &target) {
			t.Fatalf("err = %v, want ErrApprovalExpired", err)
		}
	}
	// Superseding an expired approval is still allowed so it can be closed out.
	if _, err := svc.DecideApproval(ctx, a.ID, ApprovalSuperseded, "reviewer", "lapsed"); err != nil {
		t.Fatalf("supersede expired: %v", err)
	}
}
