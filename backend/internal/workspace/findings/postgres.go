package findings

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Akapi895/raptix/backend/internal/workspace/findings/storegen"
)

// Postgres implements Repository over pgx. It is the only file that touches the
// generated store; everything else goes through the Repository or Service.
type Postgres struct {
	q *storegen.Queries
}

// DBTX is the minimal query interface; *pgxpool.Pool and pgx.Tx satisfy it.
type DBTX interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
	Query(context.Context, string, ...interface{}) (pgx.Rows, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
}

// NewPostgres builds a repository over a query executor.
func NewPostgres(exec DBTX) *Postgres {
	return &Postgres{q: storegen.New(exec)}
}

func (r *Postgres) CreateFinding(ctx context.Context, p CreateFindingParams) (Finding, error) {
	row, err := r.q.CreateFinding(ctx, storegen.CreateFindingParams{
		RunID:       uuidToPG(p.RunID),
		Title:       p.Title,
		Description: p.Description,
		Severity:    string(p.Severity),
		Confidence:  string(p.Confidence),
		Status:      string(StatusDraft),
	})
	if err != nil {
		return Finding{}, fmt.Errorf("create finding: %w", err)
	}
	return toFinding(row), nil
}

func (r *Postgres) GetFinding(ctx context.Context, id uuid.UUID) (Finding, error) {
	row, err := r.q.GetFinding(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Finding{}, &ErrFindingNotFound{ID: id}
		}
		return Finding{}, err
	}
	return toFinding(row), nil
}

func (r *Postgres) ListFindingsByRun(ctx context.Context, runID uuid.UUID) ([]Finding, error) {
	rows, err := r.q.ListFindingsByRun(ctx, uuidToPG(runID))
	if err != nil {
		return nil, err
	}
	out := make([]Finding, 0, len(rows))
	for _, row := range rows {
		out = append(out, toFinding(row))
	}
	return out, nil
}

func (r *Postgres) TransitionFindingWithHistory(ctx context.Context, id uuid.UUID, version int, to FindingStatus, reviewer, reason string) (Finding, error) {
	row, err := r.q.TransitionFindingWithHistory(ctx, storegen.TransitionFindingWithHistoryParams{
		ID:       uuidToPG(id),
		Status:   string(to),
		Version:  int32(version),
		Reviewer: reviewer,
		Reason:   reason,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Finding{}, &ErrOptimisticLock{ID: id}
		}
		return Finding{}, err
	}
	return Finding{
		ID:          pgToUUID(row.ID),
		RunID:       pgToUUID(row.RunID),
		Title:       row.Title,
		Description: row.Description,
		Severity:    Severity(row.Severity),
		Confidence:  Confidence(row.Confidence),
		Status:      FindingStatus(row.Status),
		Version:     int(row.Version),
		CreatedAt:   pgToTime(row.CreatedAt),
		UpdatedAt:   pgToTime(row.UpdatedAt),
	}, nil
}

func (r *Postgres) LinkEvidence(ctx context.Context, link EvidenceLink) error {
	return r.q.LinkFindingEvidence(ctx, storegen.LinkFindingEvidenceParams{
		FindingID:  uuidToPG(link.FindingID),
		EvidenceID: uuidToPG(link.EvidenceID),
		Role:       link.Role,
	})
}

func (r *Postgres) InsertVerdict(ctx context.Context, p InsertVerdictParams) (FindingVerdict, error) {
	row, err := r.q.InsertVerdict(ctx, storegen.InsertVerdictParams{
		FindingID:  uuidToPG(p.FindingID),
		Verdict:    string(p.Verdict),
		Reason:     p.Reason,
		ProducedBy: p.ProducedBy,
	})
	if err != nil {
		return FindingVerdict{}, err
	}
	return toVerdict(row), nil
}

func (r *Postgres) ListVerdicts(ctx context.Context, findingID uuid.UUID) ([]FindingVerdict, error) {
	rows, err := r.q.ListVerdictsByFinding(ctx, uuidToPG(findingID))
	if err != nil {
		return nil, err
	}
	out := make([]FindingVerdict, 0, len(rows))
	for _, row := range rows {
		out = append(out, toVerdict(row))
	}
	return out, nil
}

func (r *Postgres) ListReviewHistory(ctx context.Context, findingID uuid.UUID) ([]ReviewHistoryEntry, error) {
	rows, err := r.q.ListReviewHistory(ctx, uuidToPG(findingID))
	if err != nil {
		return nil, err
	}
	out := make([]ReviewHistoryEntry, 0, len(rows))
	for _, row := range rows {
		out = append(out, toReviewHistory(row))
	}
	return out, nil
}

func toFinding(f storegen.Finding) Finding {
	return Finding{
		ID:          pgToUUID(f.ID),
		RunID:       pgToUUID(f.RunID),
		Title:       f.Title,
		Description: f.Description,
		Severity:    Severity(f.Severity),
		Confidence:  Confidence(f.Confidence),
		Status:      FindingStatus(f.Status),
		Version:     int(f.Version),
		CreatedAt:   pgToTime(f.CreatedAt),
		UpdatedAt:   pgToTime(f.UpdatedAt),
	}
}

func toVerdict(v storegen.FindingVerdict) FindingVerdict {
	return FindingVerdict{
		ID:         pgToUUID(v.ID),
		FindingID:  pgToUUID(v.FindingID),
		Verdict:    Verdict(v.Verdict),
		Reason:     v.Reason,
		ProducedBy: v.ProducedBy,
		CreatedAt:  pgToTime(v.CreatedAt),
	}
}

func toReviewHistory(h storegen.FindingReviewHistory) ReviewHistoryEntry {
	return ReviewHistoryEntry{
		ID:         pgToUUID(h.ID),
		FindingID:  pgToUUID(h.FindingID),
		FromStatus: FindingStatus(h.FromStatus),
		ToStatus:   FindingStatus(h.ToStatus),
		Reviewer:   h.Reviewer,
		Reason:     h.Reason,
		CreatedAt:  pgToTime(h.CreatedAt),
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
