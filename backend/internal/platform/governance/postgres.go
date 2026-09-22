package governance

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Akapi895/raptix/backend/internal/platform/governance/storegen"
)

// Postgres implements Repository over pgx via the generated store. It is the
// only governance file that touches the store; other packages go through the
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

func (r *Postgres) CreateRole(ctx context.Context, name, description string) (Role, error) {
	row, err := r.q.CreateRole(ctx, storegen.CreateRoleParams{Name: name, Description: description})
	if err != nil {
		return Role{}, fmt.Errorf("create role: %w", err)
	}
	return toRole(row), nil
}

func (r *Postgres) CreatePermission(ctx context.Context, name, comment string) (Permission, error) {
	row, err := r.q.CreatePermission(ctx, storegen.CreatePermissionParams{Name: name, Comment: comment})
	if err != nil {
		return Permission{}, fmt.Errorf("create permission: %w", err)
	}
	return toPermission(row), nil
}

func (r *Postgres) GrantRolePermission(ctx context.Context, roleID, permissionID uuid.UUID) error {
	err := r.q.GrantRolePermission(ctx, storegen.GrantRolePermissionParams{
		RoleID:       uuidToPG(roleID),
		PermissionID: uuidToPG(permissionID),
	})
	if err != nil {
		return fmt.Errorf("grant role permission: %w", err)
	}
	return nil
}

func (r *Postgres) RoleHasPermission(ctx context.Context, roleID, permissionID uuid.UUID) (bool, error) {
	count, err := r.q.RoleHasPermission(ctx, storegen.RoleHasPermissionParams{
		RoleID:       uuidToPG(roleID),
		PermissionID: uuidToPG(permissionID),
	})
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *Postgres) CreateCapabilityGrant(ctx context.Context, p CreateCapabilityGrantParams) (CapabilityGrant, error) {
	row, err := r.q.CreateCapabilityGrant(ctx, storegen.CreateCapabilityGrantParams{
		Subject:    p.Subject,
		ScopeID:    uuidToPG(p.ScopeID),
		Capability: p.Capability,
		GrantedBy:  p.GrantedBy,
		ExpiresAt:  timeToPG(p.ExpiresAt),
	})
	if err != nil {
		return CapabilityGrant{}, err
	}
	return toCapabilityGrant(row), nil
}

func (r *Postgres) GetCapabilityGrant(ctx context.Context, id uuid.UUID) (CapabilityGrant, error) {
	row, err := r.q.GetCapabilityGrant(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CapabilityGrant{}, &ErrCapabilityGrantNotFound{ID: id}
		}
		return CapabilityGrant{}, err
	}
	return toCapabilityGrant(row), nil
}

func (r *Postgres) RevokeCapabilityGrant(ctx context.Context, id uuid.UUID) (CapabilityGrant, error) {
	row, err := r.q.RevokeCapabilityGrant(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CapabilityGrant{}, &ErrCapabilityGrantNotFound{ID: id}
		}
		return CapabilityGrant{}, err
	}
	return toCapabilityGrant(row), nil
}

func (r *Postgres) ListActiveGrantsForSubjectScope(ctx context.Context, subject string, scopeID uuid.UUID) ([]CapabilityGrant, error) {
	rows, err := r.q.ListActiveGrantsForSubjectScope(ctx, storegen.ListActiveGrantsForSubjectScopeParams{
		Subject: subject,
		ScopeID: uuidToPG(scopeID),
	})
	if err != nil {
		return nil, err
	}
	out := make([]CapabilityGrant, 0, len(rows))
	for _, row := range rows {
		out = append(out, toCapabilityGrant(row))
	}
	return out, nil
}

func (r *Postgres) CreateApproval(ctx context.Context, p CreateApprovalParams) (Approval, error) {
	row, err := r.q.CreateApproval(ctx, storegen.CreateApprovalParams{
		Subject:   p.Subject,
		ScopeID:   uuidToPG(p.ScopeID),
		Action:    p.Action,
		ExpiresAt: timeToPG(p.ExpiresAt),
	})
	if err != nil {
		return Approval{}, err
	}
	return toApproval(row), nil
}

func (r *Postgres) GetApproval(ctx context.Context, id uuid.UUID) (Approval, error) {
	row, err := r.q.GetApproval(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Approval{}, &ErrApprovalNotFound{ID: id}
		}
		return Approval{}, err
	}
	return toApproval(row), nil
}

func (r *Postgres) DecideApproval(ctx context.Context, id uuid.UUID, status ApprovalStatus, decidedBy, reason string) (Approval, error) {
	row, err := r.q.DecideApproval(ctx, storegen.DecideApprovalParams{
		ID:        uuidToPG(id),
		Status:    string(status),
		DecidedBy: textToPG(&decidedBy),
		Reason:    reason,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Approval{}, &ErrApprovalDecided{ID: id}
		}
		return Approval{}, err
	}
	return toApproval(row), nil
}

func toRole(role storegen.Role) Role {
	return Role{
		ID:          pgToUUID(role.ID),
		Name:        role.Name,
		Description: role.Description,
	}
}

func toPermission(p storegen.Permission) Permission {
	return Permission{
		ID:      pgToUUID(p.ID),
		Name:    p.Name,
		Comment: p.Comment,
	}
}

func toCapabilityGrant(g storegen.CapabilityGrant) CapabilityGrant {
	return CapabilityGrant{
		ID:         pgToUUID(g.ID),
		Subject:    g.Subject,
		ScopeID:    pgToUUID(g.ScopeID),
		Capability: g.Capability,
		GrantedBy:  g.GrantedBy,
		CreatedAt:  pgToTime(g.CreatedAt),
		RevokedAt:  pgToTimePtr(g.RevokedAt),
		ExpiresAt:  pgToTimePtr(g.ExpiresAt),
	}
}

func toApproval(a storegen.Approval) Approval {
	return Approval{
		ID:        pgToUUID(a.ID),
		Subject:   a.Subject,
		ScopeID:   pgToUUID(a.ScopeID),
		Action:    a.Action,
		Status:    ApprovalStatus(a.Status),
		DecidedBy: pgToTextPtr(a.DecidedBy),
		DecidedAt: pgToTimePtr(a.DecidedAt),
		Reason:    a.Reason,
		CreatedAt: pgToTime(a.CreatedAt),
		ExpiresAt: pgToTimePtr(a.ExpiresAt),
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
