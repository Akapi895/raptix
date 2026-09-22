package projects

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Akapi895/raptix/backend/internal/platform/projects/storegen"
)

// Postgres implements Repository over pgx via the generated store. It is the
// only projects file that touches the store; other packages go through the
// Repository interface or the Service.
type Postgres struct {
	q *storegen.Queries
}

// NewPostgres builds a repository backed by a pgx query executor (a pool or an
// open transaction).
func NewPostgres(exec DBTX) *Postgres {
	return &Postgres{q: storegen.New(exec)}
}

// DBTX is the small query interface the repository needs; both *pgxpool.Pool
// and pgx.Tx satisfy it.
type DBTX interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
	Query(context.Context, string, ...interface{}) (pgx.Rows, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
}

func (r *Postgres) CreateProject(ctx context.Context, p CreateProjectParams) (Project, error) {
	row, err := r.q.CreateProject(ctx, storegen.CreateProjectParams{Name: p.Name, Slug: p.Slug})
	if err != nil {
		return Project{}, fmt.Errorf("create project: %w", err)
	}
	return toProject(row), nil
}

func (r *Postgres) GetProjectByID(ctx context.Context, id uuid.UUID) (Project, error) {
	row, err := r.q.GetProjectByID(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Project{}, &ErrProjectNotFound{ID: id}
		}
		return Project{}, err
	}
	return toProject(row), nil
}

func (r *Postgres) GetProjectBySlug(ctx context.Context, slug string) (Project, error) {
	row, err := r.q.GetProjectBySlug(ctx, slug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Project{}, &ErrProjectNotFound{}
		}
		return Project{}, err
	}
	return toProject(row), nil
}

func (r *Postgres) ListProjects(ctx context.Context) ([]Project, error) {
	rows, err := r.q.ListProjects(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Project, 0, len(rows))
	for _, row := range rows {
		out = append(out, toProject(row))
	}
	return out, nil
}

func (r *Postgres) SetProjectStatus(ctx context.Context, id uuid.UUID, status ProjectStatus) (Project, error) {
	row, err := r.q.SetProjectStatus(ctx, storegen.SetProjectStatusParams{ID: uuidToPG(id), Status: string(status)})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Project{}, &ErrProjectNotFound{ID: id}
		}
		return Project{}, err
	}
	return toProject(row), nil
}

func (r *Postgres) AddMember(ctx context.Context, m Membership) (Membership, error) {
	row, err := r.q.AddProjectMember(ctx, storegen.AddProjectMemberParams{
		ProjectID: uuidToPG(m.ProjectID),
		Subject:   m.Subject,
		Role:      string(m.Role),
	})
	if err != nil {
		return Membership{}, err
	}
	return toMembership(row), nil
}

func (r *Postgres) ListMembers(ctx context.Context, projectID uuid.UUID) ([]Membership, error) {
	rows, err := r.q.ListProjectMembers(ctx, uuidToPG(projectID))
	if err != nil {
		return nil, err
	}
	out := make([]Membership, 0, len(rows))
	for _, row := range rows {
		out = append(out, toMembership(row))
	}
	return out, nil
}

func (r *Postgres) GetMemberRole(ctx context.Context, projectID uuid.UUID, subject string) (MembershipRole, error) {
	role, err := r.q.GetMemberRole(ctx, storegen.GetMemberRoleParams{ProjectID: uuidToPG(projectID), Subject: subject})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	return MembershipRole(role), nil
}

func (r *Postgres) CreateScope(ctx context.Context, p CreateScopeParams) (Scope, error) {
	include := p.Include
	if include == nil {
		include = []string{}
	}
	exclude := p.Exclude
	if exclude == nil {
		exclude = []string{}
	}
	version, err := r.q.NextScopeVersion(ctx, uuidToPG(p.ProjectID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Scope{}, &ErrProjectNotFound{ID: p.ProjectID}
		}
		return Scope{}, fmt.Errorf("reserve scope version: %w", err)
	}
	row, err := r.q.CreateScope(ctx, storegen.CreateScopeParams{
		ProjectID:    uuidToPG(p.ProjectID),
		Version:      version,
		AssetTypes:   p.AssetTypes,
		Include:      include,
		Exclude:      exclude,
		ExpiresAt:    timeToPG(p.ExpiresAt),
		ApprovalNote: textToPG(p.ApprovalNote),
	})
	if err != nil {
		return Scope{}, fmt.Errorf("create scope: %w", err)
	}
	return toScope(row), nil
}

func (r *Postgres) GetScope(ctx context.Context, id uuid.UUID) (Scope, error) {
	row, err := r.q.GetScopeByID(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Scope{}, &ErrScopeNotFound{ID: id}
		}
		return Scope{}, err
	}
	return toScope(row), nil
}

func (r *Postgres) ListScopes(ctx context.Context, projectID uuid.UUID) ([]Scope, error) {
	rows, err := r.q.ListScopesByProject(ctx, uuidToPG(projectID))
	if err != nil {
		return nil, err
	}
	out := make([]Scope, 0, len(rows))
	for _, row := range rows {
		out = append(out, toScope(row))
	}
	return out, nil
}

func toProject(p storegen.Project) Project {
	return Project{
		ID:        pgToUUID(p.ID),
		Name:      p.Name,
		Slug:      p.Slug,
		Status:    ProjectStatus(p.Status),
		CreatedAt: pgToTime(p.CreatedAt),
		UpdatedAt: pgToTime(p.UpdatedAt),
	}
}

func toMembership(m storegen.ProjectMember) Membership {
	return Membership{
		ProjectID: pgToUUID(m.ProjectID),
		Subject:   m.Subject,
		Role:      MembershipRole(m.Role),
		CreatedAt: pgToTime(m.CreatedAt),
	}
}

func toScope(s storegen.Scope) Scope {
	return Scope{
		ID:           pgToUUID(s.ID),
		ProjectID:    pgToUUID(s.ProjectID),
		Version:      int(s.Version),
		AssetTypes:   s.AssetTypes,
		Include:      s.Include,
		Exclude:      s.Exclude,
		ExpiresAt:    pgToTimePtr(s.ExpiresAt),
		ApprovalNote: pgToTextPtr(s.ApprovalNote),
		CreatedAt:    pgToTime(s.CreatedAt),
	}
}

func uuidToPG(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

func pgToUUID(u pgtype.UUID) uuid.UUID {
	if !u.Valid {
		return uuid.Nil
	}
	return u.Bytes
}

func pgToTime(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}

func pgToTimePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func timeToPG(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func pgToTextPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	v := t.String
	return &v
}

func textToPG(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}
