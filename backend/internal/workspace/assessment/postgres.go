package assessment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Akapi895/raptix/backend/internal/workspace/assessment/storegen"
)

// Postgres implements Repository over pgx via the generated store. It is the
// only assessment file that touches the store; other packages go through the
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

func (r *Postgres) CreateAsset(ctx context.Context, p CreateAssetParams) (Asset, error) {
	props := p.Properties
	if props == nil {
		props = map[string]interface{}{}
	}
	raw, err := json.Marshal(props)
	if err != nil {
		return Asset{}, fmt.Errorf("marshal asset properties: %w", err)
	}
	row, err := r.q.CreateAsset(ctx, storegen.CreateAssetParams{
		RunID:      uuidToPG(p.RunID),
		Kind:       p.Kind,
		Name:       p.Name,
		Properties: raw,
	})
	if err != nil {
		return Asset{}, fmt.Errorf("create asset: %w", err)
	}
	return toAsset(row)
}

func (r *Postgres) GetAsset(ctx context.Context, id uuid.UUID) (Asset, error) {
	row, err := r.q.GetAsset(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Asset{}, &ErrAssetNotFound{ID: id}
		}
		return Asset{}, err
	}
	return toAsset(row)
}

func (r *Postgres) ListAssetsByRun(ctx context.Context, runID uuid.UUID) ([]Asset, error) {
	rows, err := r.q.ListAssetsByRun(ctx, uuidToPG(runID))
	if err != nil {
		return nil, err
	}
	out := make([]Asset, 0, len(rows))
	for _, row := range rows {
		a, err := toAsset(row)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

func (r *Postgres) CreateObservation(ctx context.Context, p CreateObservationParams) (Observation, error) {
	row, err := r.q.CreateObservation(ctx, storegen.CreateObservationParams{
		RunID:      uuidToPG(p.RunID),
		AssetID:    uuidPtrToPG(p.AssetID),
		Summary:    p.Summary,
		Detail:     p.Detail,
		EvidenceID: uuidPtrToPG(p.EvidenceID),
	})
	if err != nil {
		return Observation{}, fmt.Errorf("create observation: %w", err)
	}
	return toObservation(row), nil
}

func (r *Postgres) GetObservation(ctx context.Context, id uuid.UUID) (Observation, error) {
	row, err := r.q.GetObservation(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Observation{}, &ErrObservationNotFound{ID: id}
		}
		return Observation{}, err
	}
	return toObservation(row), nil
}

func (r *Postgres) ListObservationsByRun(ctx context.Context, runID uuid.UUID) ([]Observation, error) {
	rows, err := r.q.ListObservationsByRun(ctx, uuidToPG(runID))
	if err != nil {
		return nil, err
	}
	out := make([]Observation, 0, len(rows))
	for _, row := range rows {
		out = append(out, toObservation(row))
	}
	return out, nil
}

func (r *Postgres) CreateHypothesis(ctx context.Context, p CreateHypothesisParams) (Hypothesis, error) {
	row, err := r.q.CreateHypothesis(ctx, storegen.CreateHypothesisParams{
		RunID:       uuidToPG(p.RunID),
		Title:       p.Title,
		Description: p.Description,
		Status:      string(HypothesisOpen),
	})
	if err != nil {
		return Hypothesis{}, fmt.Errorf("create hypothesis: %w", err)
	}
	return toHypothesis(row), nil
}

func (r *Postgres) GetHypothesis(ctx context.Context, id uuid.UUID) (Hypothesis, error) {
	row, err := r.q.GetHypothesis(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Hypothesis{}, &ErrHypothesisNotFound{ID: id}
		}
		return Hypothesis{}, err
	}
	return toHypothesis(row), nil
}

func (r *Postgres) UpdateHypothesisStatus(ctx context.Context, id uuid.UUID, status HypothesisStatus) (Hypothesis, error) {
	row, err := r.q.UpdateHypothesisStatus(ctx, storegen.UpdateHypothesisStatusParams{
		ID:     uuidToPG(id),
		Status: string(status),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Hypothesis{}, &ErrHypothesisNotFound{ID: id}
		}
		return Hypothesis{}, err
	}
	return toHypothesis(row), nil
}

func (r *Postgres) CreateCoverage(ctx context.Context, p CreateCoverageParams) (CoverageEntry, error) {
	row, err := r.q.CreateCoverageEntry(ctx, storegen.CreateCoverageEntryParams{
		RunID:        uuidToPG(p.RunID),
		HypothesisID: uuidPtrToPG(p.HypothesisID),
		AssetID:      uuidPtrToPG(p.AssetID),
		Method:       p.Method,
		Outcome:      string(p.Outcome),
		EvidenceID:   uuidPtrToPG(p.EvidenceID),
		Reason:       p.Reason,
	})
	if err != nil {
		return CoverageEntry{}, fmt.Errorf("create coverage entry: %w", err)
	}
	return toCoverage(row), nil
}

func (r *Postgres) GetCoverage(ctx context.Context, id uuid.UUID) (CoverageEntry, error) {
	row, err := r.q.GetCoverageEntry(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CoverageEntry{}, &ErrCoverageNotFound{ID: id}
		}
		return CoverageEntry{}, err
	}
	return toCoverage(row), nil
}

func (r *Postgres) ListCoverageByRun(ctx context.Context, runID uuid.UUID) ([]CoverageEntry, error) {
	rows, err := r.q.ListCoverageByRun(ctx, uuidToPG(runID))
	if err != nil {
		return nil, err
	}
	out := make([]CoverageEntry, 0, len(rows))
	for _, row := range rows {
		out = append(out, toCoverage(row))
	}
	return out, nil
}

func toAsset(a storegen.Asset) (Asset, error) {
	props := map[string]interface{}{}
	if len(a.Properties) > 0 {
		if err := json.Unmarshal(a.Properties, &props); err != nil {
			return Asset{}, fmt.Errorf("unmarshal asset properties: %w", err)
		}
	}
	return Asset{
		ID:         pgToUUID(a.ID),
		RunID:      pgToUUID(a.RunID),
		Kind:       a.Kind,
		Name:       a.Name,
		Properties: props,
		CreatedAt:  pgToTime(a.CreatedAt),
	}, nil
}

func toObservation(o storegen.Observation) Observation {
	return Observation{
		ID:         pgToUUID(o.ID),
		RunID:      pgToUUID(o.RunID),
		AssetID:    pgToUUIDPtr(o.AssetID),
		Summary:    o.Summary,
		Detail:     o.Detail,
		EvidenceID: pgToUUIDPtr(o.EvidenceID),
		CreatedAt:  pgToTime(o.CreatedAt),
	}
}

func toHypothesis(h storegen.Hypothesis) Hypothesis {
	return Hypothesis{
		ID:          pgToUUID(h.ID),
		RunID:       pgToUUID(h.RunID),
		Title:       h.Title,
		Description: h.Description,
		Status:      HypothesisStatus(h.Status),
		CreatedAt:   pgToTime(h.CreatedAt),
	}
}

func toCoverage(c storegen.CoverageEntry) CoverageEntry {
	return CoverageEntry{
		ID:           pgToUUID(c.ID),
		RunID:        pgToUUID(c.RunID),
		HypothesisID: pgToUUIDPtr(c.HypothesisID),
		AssetID:      pgToUUIDPtr(c.AssetID),
		Method:       c.Method,
		Outcome:      Outcome(c.Outcome),
		EvidenceID:   pgToUUIDPtr(c.EvidenceID),
		Reason:       c.Reason,
		CreatedAt:    pgToTime(c.CreatedAt),
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

func pgToTime(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}
