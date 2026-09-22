package agents

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Akapi895/raptix/backend/internal/engine/agents/storegen"
)

// Postgres implements Repository over pgx via the generated store. It is the
// only agents file that touches the store; callers go through the Repository
// interface or the Service.
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

func (r *Postgres) CreateAttempt(ctx context.Context, p CreateAttemptParams) (Attempt, error) {
	row, err := r.q.CreateAttempt(ctx, uuidToPG(p.AgentID))
	if err != nil {
		return Attempt{}, fmt.Errorf("create attempt: %w", err)
	}
	return toAttempt(row), nil
}

func (r *Postgres) GetAttempt(ctx context.Context, id uuid.UUID) (Attempt, error) {
	row, err := r.q.GetAttempt(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Attempt{}, &ErrAttemptNotFound{ID: id}
		}
		return Attempt{}, err
	}
	return toAttempt(row), nil
}

func (r *Postgres) ListAttemptsByAgent(ctx context.Context, agentID uuid.UUID) ([]Attempt, error) {
	rows, err := r.q.ListAttemptsByAgent(ctx, uuidToPG(agentID))
	if err != nil {
		return nil, err
	}
	out := make([]Attempt, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAttempt(row))
	}
	return out, nil
}

func (r *Postgres) FinishAttempt(ctx context.Context, p FinishAttemptParams) (Attempt, error) {
	row, err := r.q.FinishAttempt(ctx, storegen.FinishAttemptParams{
		ID:         uuidToPG(p.ID),
		Status:     string(p.Status),
		FinishedAt: timeToPG(&p.FinishedAt),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Attempt{}, &ErrAttemptNotFound{ID: p.ID}
		}
		return Attempt{}, err
	}
	return toAttempt(row), nil
}

func (r *Postgres) AppendMessage(ctx context.Context, p AppendMessageParams) (Message, error) {
	row, err := r.q.AppendMessage(ctx, storegen.AppendMessageParams{
		AttemptID:    uuidToPG(p.AttemptID),
		Seq:          int32(p.Seq),
		Role:         string(p.Role),
		Content:      p.Content,
		InvocationID: uuidPtrToPG(p.InvocationID),
	})
	if err != nil {
		return Message{}, fmt.Errorf("append message: %w", err)
	}
	return toMessage(row), nil
}

func (r *Postgres) ListMessages(ctx context.Context, attemptID uuid.UUID) ([]Message, error) {
	rows, err := r.q.ListMessages(ctx, uuidToPG(attemptID))
	if err != nil {
		return nil, err
	}
	out := make([]Message, 0, len(rows))
	for _, row := range rows {
		out = append(out, toMessage(row))
	}
	return out, nil
}

func (r *Postgres) CreateSnapshot(ctx context.Context, p CreateSnapshotParams) (Snapshot, error) {
	row, err := r.q.CreateSnapshot(ctx, storegen.CreateSnapshotParams{
		AgentID:     uuidToPG(p.AgentID),
		ProfileRef:  p.ProfileRef,
		ContentHash: p.ContentHash,
		Requested:   []byte(p.Requested),
		Granted:     []byte(p.Granted),
	})
	if err != nil {
		return Snapshot{}, fmt.Errorf("create snapshot: %w", err)
	}
	return toSnapshot(row), nil
}

func (r *Postgres) GetSnapshotByAgent(ctx context.Context, agentID uuid.UUID) (Snapshot, error) {
	row, err := r.q.GetSnapshotByAgent(ctx, uuidToPG(agentID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Snapshot{}, &ErrSnapshotNotFound{AgentID: agentID}
		}
		return Snapshot{}, err
	}
	return toSnapshot(row), nil
}

func toAttempt(r storegen.AgentAttempt) Attempt {
	return Attempt{
		ID:         pgToUUID(r.ID),
		AgentID:    pgToUUID(r.AgentID),
		AttemptNo:  int(r.AttemptNo),
		Status:     AttemptStatus(r.Status),
		StartedAt:  pgToTimePtr(r.StartedAt),
		FinishedAt: pgToTimePtr(r.FinishedAt),
		CreatedAt:  pgToTime(r.CreatedAt),
		UpdatedAt:  pgToTime(r.UpdatedAt),
	}
}

func toMessage(r storegen.AgentMessage) Message {
	return Message{
		ID:           pgToUUID(r.ID),
		AttemptID:    pgToUUID(r.AttemptID),
		Seq:          int(r.Seq),
		Role:         MessageRole(r.Role),
		Content:      r.Content,
		InvocationID: pgToUUIDPtr(r.InvocationID),
		CreatedAt:    pgToTime(r.CreatedAt),
	}
}

func toSnapshot(r storegen.AgentSnapshot) Snapshot {
	return Snapshot{
		ID:          pgToUUID(r.ID),
		AgentID:     pgToUUID(r.AgentID),
		ProfileRef:  r.ProfileRef,
		ContentHash: r.ContentHash,
		Requested:   r.Requested,
		Granted:     r.Granted,
		CreatedAt:   pgToTime(r.CreatedAt),
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
