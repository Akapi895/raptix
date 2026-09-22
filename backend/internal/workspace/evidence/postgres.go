package evidence

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Akapi895/raptix/backend/internal/workspace/evidence/storegen"
)

// Postgres implements Repository over pgx via the generated store. It is the
// only evidence file that touches the store; other packages go through the
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

func (r *Postgres) CreateArtifact(ctx context.Context, p CreateArtifactParams) (Artifact, error) {
	row, err := r.q.CreateArtifact(ctx, storegen.CreateArtifactParams{
		RunID:         uuidToPGPtr(p.RunID),
		Kind:          string(p.Kind),
		Mime:          p.MIME,
		Size:          p.Size,
		Sha256:        p.SHA256,
		SchemaVersion: p.SchemaVersion,
		ParserVersion: p.ParserVersion,
		Sensitivity:   string(p.Sensitivity),
		StorageKey:    p.StorageKey,
		RelType:       p.RelType,
		ParentID:      uuidToPGPtr(p.ParentID),
	})
	if err != nil {
		return Artifact{}, fmt.Errorf("create artifact: %w", err)
	}
	return toArtifact(row), nil
}

func (r *Postgres) GetArtifact(ctx context.Context, id uuid.UUID) (Artifact, error) {
	row, err := r.q.GetArtifact(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Artifact{}, &ErrArtifactNotFound{ID: id}
		}
		return Artifact{}, err
	}
	return toArtifact(row), nil
}

func (r *Postgres) GetArtifactBySHA256(ctx context.Context, sha256 string) (Artifact, error) {
	row, err := r.q.GetArtifactBySHA256(ctx, sha256)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Artifact{}, &ErrArtifactNotFound{}
		}
		return Artifact{}, err
	}
	return toArtifact(row), nil
}

func (r *Postgres) GetArtifactBySHA256InRun(ctx context.Context, runID uuid.UUID, sha256 string) (Artifact, error) {
	row, err := r.q.GetArtifactBySHA256InRun(ctx, storegen.GetArtifactBySHA256InRunParams{
		RunID:  uuidToPG(runID),
		Sha256: sha256,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Artifact{}, &ErrArtifactNotFound{}
		}
		return Artifact{}, err
	}
	return toArtifact(row), nil
}

func (r *Postgres) ListArtifactsByRun(ctx context.Context, runID uuid.UUID) ([]Artifact, error) {
	rows, err := r.q.ListArtifactsByRun(ctx, uuidToPG(runID))
	if err != nil {
		return nil, err
	}
	out := make([]Artifact, 0, len(rows))
	for _, row := range rows {
		out = append(out, toArtifact(row))
	}
	return out, nil
}

func (r *Postgres) ListDerived(ctx context.Context, parentID uuid.UUID) ([]Artifact, error) {
	rows, err := r.q.ListDerivedArtifacts(ctx, uuidToPG(parentID))
	if err != nil {
		return nil, err
	}
	out := make([]Artifact, 0, len(rows))
	for _, row := range rows {
		out = append(out, toArtifact(row))
	}
	return out, nil
}

func toArtifact(a storegen.Artifact) Artifact {
	return Artifact{
		ID:            pgToUUID(a.ID),
		RunID:         pgToUUIDPtr(a.RunID),
		Kind:          Kind(a.Kind),
		MIME:          a.Mime,
		Size:          a.Size,
		SHA256:        a.Sha256,
		SchemaVersion: a.SchemaVersion,
		ParserVersion: a.ParserVersion,
		Sensitivity:   Sensitivity(a.Sensitivity),
		StorageKey:    a.StorageKey,
		RelType:       a.RelType,
		ParentID:      pgToUUIDPtr(a.ParentID),
		CreatedAt:     pgToTime(a.CreatedAt),
	}
}

func uuidToPG(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

func uuidToPGPtr(id *uuid.UUID) pgtype.UUID {
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
	v := pgToUUID(u)
	return &v
}

func pgToTime(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}
