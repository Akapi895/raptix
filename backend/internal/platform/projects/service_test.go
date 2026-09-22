package projects

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
)

// memRepo is an in-memory Repository used by unit tests (no database required).
type memRepo struct {
	projects  map[uuid.UUID]Project
	bySlug    map[string]uuid.UUID
	members   map[uuid.UUID][]Membership
	scopes    map[uuid.UUID]Scope
	byProject map[uuid.UUID][]Scope
	next      int
}

func newMemRepo() *memRepo {
	return &memRepo{
		projects:  map[uuid.UUID]Project{},
		bySlug:    map[string]uuid.UUID{},
		members:   map[uuid.UUID][]Membership{},
		scopes:    map[uuid.UUID]Scope{},
		byProject: map[uuid.UUID][]Scope{},
	}
}

func (m *memRepo) newID() uuid.UUID {
	m.next++
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("projects-"+strconv.Itoa(m.next)))
}

func (m *memRepo) CreateProject(ctx context.Context, p CreateProjectParams) (Project, error) {
	if _, ok := m.bySlug[p.Slug]; ok {
		return Project{}, errDuplicateSlug
	}
	id := m.newID()
	pr := Project{ID: id, Name: p.Name, Slug: p.Slug, Status: ProjectActive}
	m.projects[id] = pr
	m.bySlug[p.Slug] = id
	return pr, nil
}

func (m *memRepo) GetProjectByID(ctx context.Context, id uuid.UUID) (Project, error) {
	pr, ok := m.projects[id]
	if !ok {
		return Project{}, &ErrProjectNotFound{ID: id}
	}
	return pr, nil
}

func (m *memRepo) GetProjectBySlug(ctx context.Context, slug string) (Project, error) {
	id, ok := m.bySlug[slug]
	if !ok {
		return Project{}, &ErrProjectNotFound{}
	}
	return m.GetProjectByID(ctx, id)
}

func (m *memRepo) ListProjects(ctx context.Context) ([]Project, error) {
	out := make([]Project, 0, len(m.projects))
	for _, p := range m.projects {
		out = append(out, p)
	}
	return out, nil
}

func (m *memRepo) SetProjectStatus(ctx context.Context, id uuid.UUID, status ProjectStatus) (Project, error) {
	pr, ok := m.projects[id]
	if !ok {
		return Project{}, &ErrProjectNotFound{ID: id}
	}
	pr.Status = status
	m.projects[id] = pr
	return pr, nil
}

func (m *memRepo) AddMember(ctx context.Context, mem Membership) (Membership, error) {
	m.members[mem.ProjectID] = append(m.members[mem.ProjectID], mem)
	return mem, nil
}

func (m *memRepo) ListMembers(ctx context.Context, projectID uuid.UUID) ([]Membership, error) {
	return append([]Membership(nil), m.members[projectID]...), nil
}

func (m *memRepo) GetMemberRole(ctx context.Context, projectID uuid.UUID, subject string) (MembershipRole, error) {
	for _, mem := range m.members[projectID] {
		if mem.Subject == subject {
			return mem.Role, nil
		}
	}
	return "", nil
}

func (m *memRepo) CreateScope(ctx context.Context, p CreateScopeParams) (Scope, error) {
	id := m.newID()
	_, ok := m.projects[p.ProjectID]
	if !ok {
		return Scope{}, &ErrProjectNotFound{ID: p.ProjectID}
	}
	s := Scope{
		ID: id, ProjectID: p.ProjectID, Version: len(m.byProject[p.ProjectID]) + 1,
		AssetTypes: p.AssetTypes, Include: p.Include, Exclude: p.Exclude,
		ExpiresAt: p.ExpiresAt, ApprovalNote: p.ApprovalNote,
	}
	m.scopes[id] = s
	m.byProject[p.ProjectID] = append(m.byProject[p.ProjectID], s)
	return s, nil
}

func (m *memRepo) GetScope(ctx context.Context, id uuid.UUID) (Scope, error) {
	s, ok := m.scopes[id]
	if !ok {
		return Scope{}, &ErrScopeNotFound{ID: id}
	}
	return s, nil
}

func (m *memRepo) ListScopes(ctx context.Context, projectID uuid.UUID) ([]Scope, error) {
	return append([]Scope(nil), m.byProject[projectID]...), nil
}

var errDuplicateSlug = &ErrDuplicateSlug{}

// ErrDuplicateSlug reports a slug already in use.
type ErrDuplicateSlug struct{}

func (e *ErrDuplicateSlug) Error() string { return "project slug already in use" }

func TestCreateProjectValidatesSlug(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	if _, err := svc.CreateProject(ctx, "A Team", "A Team!"); err == nil {
		t.Error("expected slug validation error")
	}
	if _, err := svc.CreateProject(ctx, "", "teama"); err == nil {
		t.Error("expected empty-name error")
	}
	p, err := svc.CreateProject(ctx, "A Team", "team-a")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if p.Slug != "team-a" || p.Status != ProjectActive {
		t.Errorf("project = %+v", p)
	}
	got, err := svc.GetProjectByID(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "A Team" {
		t.Errorf("name = %q", got.Name)
	}
}

func TestAddMemberRejectsInvalidRole(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	p, _ := svc.CreateProject(ctx, "Team", "team-a")
	if _, err := svc.AddMember(ctx, p.ID, "alice", "superadmin"); err == nil {
		t.Error("expected invalid-role error")
	}
	_, err := svc.AddMember(ctx, p.ID, "alice", RoleReviewer)
	if err != nil {
		t.Fatal(err)
	}
}

func TestCreateScopeRequiresAssetTypes(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	p, _ := svc.CreateProject(ctx, "Team", "team-a")
	if _, err := svc.CreateScope(ctx, CreateScopeParams{ProjectID: p.ID}); err == nil {
		t.Error("expected missing asset-type error")
	}
	s, err := svc.CreateScope(ctx, CreateScopeParams{ProjectID: p.ID, AssetTypes: []string{"host"}})
	if err != nil {
		t.Fatal(err)
	}
	if s.Version != 1 {
		t.Errorf("version = %d, want 1", s.Version)
	}
}

func TestIsScopeActive(t *testing.T) {
	repo := newMemRepo()
	svc := NewService(repo)
	ctx := context.Background()
	p, err := svc.CreateProject(ctx, "Team", "team-a")
	if err != nil {
		t.Fatal(err)
	}
	active, err := svc.CreateScope(ctx, CreateScopeParams{ProjectID: p.ID, AssetTypes: []string{"host"}})
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := svc.IsScopeActive(ctx, active.ID); err != nil || !ok {
		t.Fatalf("active scope: ok=%v err=%v", ok, err)
	}
	// Missing scope is inactive, not an error.
	if ok, err := svc.IsScopeActive(ctx, uuid.New()); err != nil || ok {
		t.Fatalf("missing scope: ok=%v err=%v", ok, err)
	}
	// Expired scope is inactive (created through the repo to bypass the service
	// guard, mirroring a scope that expired after creation).
	past := time.Now().Add(-time.Hour)
	expired, err := repo.CreateScope(ctx, CreateScopeParams{ProjectID: p.ID, AssetTypes: []string{"host"}, ExpiresAt: &past})
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := svc.IsScopeActive(ctx, expired.ID); err != nil || ok {
		t.Fatalf("expired scope: ok=%v err=%v", ok, err)
	}
	// Archiving the project deactivates its scopes.
	if _, err := repo.SetProjectStatus(ctx, p.ID, ProjectArchived); err != nil {
		t.Fatal(err)
	}
	if ok, err := svc.IsScopeActive(ctx, active.ID); err != nil || ok {
		t.Fatalf("archived project scope: ok=%v err=%v", ok, err)
	}
}

func TestCreateScopeRejectsPastExpiry(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	p, _ := svc.CreateProject(ctx, "Team", "team-a")
	past := time.Now().Add(-time.Minute)
	if _, err := svc.CreateScope(ctx, CreateScopeParams{ProjectID: p.ID, AssetTypes: []string{"host"}, ExpiresAt: &past}); err == nil {
		t.Error("expected past-expiry rejection")
	}
}
