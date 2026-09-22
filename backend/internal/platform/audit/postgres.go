package audit

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Akapi895/raptix/backend/internal/platform/audit/storegen"
)

// Postgres implements Repository over pgx via the generated store. It is the
// only audit file that touches the store; other packages go through the
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

// ErrNotFound reports a missing audit record.
type ErrNotFound struct{ ID uuid.UUID }

func (e *ErrNotFound) Error() string { return "audit record not found: " + e.ID.String() }

func (r *Postgres) Insert(ctx context.Context, rec Record) (AuditRecord, error) {
	row, err := r.q.InsertAuditRecord(ctx, storegen.InsertAuditRecordParams{
		Actor:       rec.Actor,
		Action:      rec.Action,
		Resource:    rec.Resource,
		Outcome:     string(rec.Outcome),
		Reason:      rec.Reason,
		Correlation: rec.Correlation,
	})
	if err != nil {
		return AuditRecord{}, fmt.Errorf("insert audit record: %w", err)
	}
	return toAuditRecord(row), nil
}

func (r *Postgres) GetByID(ctx context.Context, id uuid.UUID) (AuditRecord, error) {
	row, err := r.q.GetAuditRecord(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AuditRecord{}, &ErrNotFound{ID: id}
		}
		return AuditRecord{}, err
	}
	return toAuditRecord(row), nil
}

func (r *Postgres) ListByActor(ctx context.Context, actor string) ([]AuditRecord, error) {
	rows, err := r.q.ListAuditByActor(ctx, actor)
	if err != nil {
		return nil, err
	}
	return toAuditRecords(rows), nil
}

func (r *Postgres) ListByCorrelation(ctx context.Context, correlation string) ([]AuditRecord, error) {
	rows, err := r.q.ListAuditByCorrelation(ctx, correlation)
	if err != nil {
		return nil, err
	}
	return toAuditRecords(rows), nil
}

func toAuditRecords(rows []storegen.AuditRecord) []AuditRecord {
	out := make([]AuditRecord, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAuditRecord(row))
	}
	return out
}

func toAuditRecord(a storegen.AuditRecord) AuditRecord {
	return AuditRecord{
		ID:          pgToUUID(a.ID),
		Actor:       a.Actor,
		Action:      a.Action,
		Resource:    a.Resource,
		Outcome:     Outcome(a.Outcome),
		Reason:      a.Reason,
		Correlation: a.Correlation,
		CreatedAt:   pgToTime(a.CreatedAt),
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
