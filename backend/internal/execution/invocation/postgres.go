package invocation

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Akapi895/raptix/backend/internal/execution/invocation/storegen"
)

// Postgres implements Repository over pgx via the generated store. It is the
// only invocation file that touches the store; callers go through the
// Repository interface or the Service.
type Postgres struct {
	q *storegen.Queries
}

// NewPostgres builds a repository backed by a pgx query executor.
func NewPostgres(exec DBTX) *Postgres {
	return &Postgres{q: storegen.New(exec)}
}

// DBTX is the minimal query interface; *pgxpool.Pool and pgx.Tx satisfy it.
type DBTX interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
	Query(context.Context, string, ...interface{}) (pgx.Rows, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
}

func (r *Postgres) CreateInvocation(ctx context.Context, p CreateParams) (Invocation, error) {
	row, err := r.q.CreateInvocation(ctx, storegen.CreateInvocationParams{
		RunID:             uuidToPG(p.RunID),
		TaskID:            uuidPtrToPG(p.TaskID),
		ScopeID:           uuidToPG(p.ScopeID),
		Actor:             p.Actor,
		Capability:        p.Capability,
		CapabilityVersion: p.CapabilityVersion,
		Request:           []byte(p.Request),
		IdempotencyKey:    p.IdempotencyKey,
	})
	if err != nil {
		return Invocation{}, fmt.Errorf("create invocation: %w", err)
	}
	return toInvocation(row), nil
}

func (r *Postgres) GetInvocation(ctx context.Context, id uuid.UUID) (Invocation, error) {
	row, err := r.q.GetInvocation(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Invocation{}, &ErrInvocationNotFound{ID: id}
		}
		return Invocation{}, err
	}
	return toInvocation(row), nil
}

func (r *Postgres) GetByRunAndIdempotencyKey(ctx context.Context, runID uuid.UUID, key string) (Invocation, error) {
	row, err := r.q.GetInvocationByRunAndKey(ctx, storegen.GetInvocationByRunAndKeyParams{
		RunID:          uuidToPG(runID),
		IdempotencyKey: key,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Invocation{}, &ErrInvocationNotFound{}
		}
		return Invocation{}, err
	}
	return toInvocation(row), nil
}

func (r *Postgres) UpdateResult(ctx context.Context, u ResultUpdate) (Invocation, error) {
	row, err := r.q.UpdateInvocationResult(ctx, storegen.UpdateInvocationResultParams{
		ID:                   uuidToPG(u.ID),
		Status:               string(u.Status),
		RawArtifactID:        uuidPtrToPG(u.RawArtifactID),
		StructuredArtifactID: uuidPtrToPG(u.StructuredArtifactID),
		ResultExecution:      u.ResultExecution,
		ResultParse:          u.ResultParse,
		ExitCode:             intPtrToPG(u.ExitCode),
		ErrorCode:            u.ErrorCode,
		ErrorMessage:         u.ErrorMessage,
		FinishedAt:           timeToPG(&u.FinishedAt),
		Version:              int32(u.Version),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Invocation{}, &ErrOptimisticLock{ID: u.ID}
		}
		return Invocation{}, err
	}
	return toInvocation(row), nil
}

func (r *Postgres) CountByRun(ctx context.Context, runID uuid.UUID) (int64, error) {
	return r.q.CountInvocationsByRun(ctx, uuidToPG(runID))
}

func (r *Postgres) ListByRun(ctx context.Context, runID uuid.UUID) ([]Invocation, error) {
	rows, err := r.q.ListInvocationsByRun(ctx, uuidToPG(runID))
	if err != nil {
		return nil, err
	}
	out := make([]Invocation, 0, len(rows))
	for _, row := range rows {
		out = append(out, toInvocation(row))
	}
	return out, nil
}

func toInvocation(r storegen.ToolInvocation) Invocation {
	return Invocation{
		ID:                   pgToUUID(r.ID),
		RunID:                pgToUUID(r.RunID),
		TaskID:               pgToUUIDPtr(r.TaskID),
		ScopeID:              pgToUUID(r.ScopeID),
		Actor:                r.Actor,
		Capability:           r.Capability,
		CapabilityVersion:    r.CapabilityVersion,
		Status:               Status(r.Status),
		Request:              r.Request,
		RawArtifactID:        pgToUUIDPtr(r.RawArtifactID),
		StructuredArtifactID: pgToUUIDPtr(r.StructuredArtifactID),
		ResultExecution:      r.ResultExecution,
		ResultParse:          r.ResultParse,
		ExitCode:             pgToIntPtr(r.ExitCode),
		ErrorCode:            r.ErrorCode,
		ErrorMessage:         r.ErrorMessage,
		IdempotencyKey:       r.IdempotencyKey,
		Version:              int(r.Version),
		StartedAt:            pgToTimePtr(r.StartedAt),
		FinishedAt:           pgToTimePtr(r.FinishedAt),
		CreatedAt:            pgToTime(r.CreatedAt),
		UpdatedAt:            pgToTime(r.UpdatedAt),
	}
}

func uuidToPG(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

func uuidPtrToPG(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *id, Valid: true}
}

func pgToUUID(u pgtype.UUID) uuid.UUID {
	if !u.Valid {
		return uuid.Nil
	}
	return u.Bytes
}

func pgToUUIDPtr(u pgtype.UUID) *uuid.UUID {
	if !u.Valid {
		return nil
	}
	v := uuid.UUID(u.Bytes)
	return &v
}

func intPtrToPG(v *int) pgtype.Int4 {
	if v == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: int32(*v), Valid: true}
}

func pgToIntPtr(v pgtype.Int4) *int {
	if !v.Valid {
		return nil
	}
	i := int(v.Int32)
	return &i
}

func timeToPG(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
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
