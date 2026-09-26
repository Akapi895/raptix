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

// Postgres implements Repository over pgx. Revision mutations run in their own
// transaction so the aggregate, live evidence projection, snapshot, and review
// history cannot diverge.
type Postgres struct {
	exec DBTX
	q    *storegen.Queries
}

// DBTX is the minimal query interface; *pgxpool.Pool and pgx.Tx satisfy it.
type DBTX interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
	Query(context.Context, string, ...interface{}) (pgx.Rows, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
}

type txBeginner interface {
	Begin(context.Context) (pgx.Tx, error)
}

// NewPostgres builds a repository over a query executor.
func NewPostgres(exec DBTX) *Postgres {
	return &Postgres{exec: exec, q: storegen.New(exec)}
}

func (r *Postgres) CreateFinding(ctx context.Context, p CreateFindingParams) (Finding, error) {
	var finding Finding
	err := r.withTx(ctx, func(q *storegen.Queries) error {
		row, err := q.CreateFinding(ctx, storegen.CreateFindingParams{
			RunID: uuidToPG(p.RunID), Title: p.Title, Description: p.Description,
			Severity: string(p.Severity), Confidence: string(p.Confidence), Status: string(StatusDraft),
		})
		if err != nil {
			return err
		}
		finding = toFinding(row)
		for _, evidence := range p.Evidence {
			if err := q.InsertFindingEvidence(ctx, storegen.InsertFindingEvidenceParams{
				FindingID: uuidToPG(finding.ID), EvidenceID: uuidToPG(evidence.EvidenceID), Role: evidence.Role,
			}); err != nil {
				return err
			}
		}
		_, err = q.CreateFindingRevision(ctx, revisionParams(finding, 1, p.Reason, p.Actor))
		if err != nil {
			return err
		}
		return q.SnapshotFindingEvidence(ctx, storegen.SnapshotFindingEvidenceParams{
			FindingID: uuidToPG(finding.ID), RevisionNo: 1,
		})
	})
	if err != nil {
		return Finding{}, fmt.Errorf("create finding: %w", err)
	}
	return finding, nil
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

func (r *Postgres) GetCurrentRevision(ctx context.Context, findingID uuid.UUID) (FindingRevision, error) {
	row, err := r.q.GetCurrentFindingRevision(ctx, uuidToPG(findingID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return FindingRevision{}, &ErrFindingRevisionNotFound{FindingID: findingID}
		}
		return FindingRevision{}, err
	}
	return r.revisionWithEvidence(ctx, r.q, row)
}

func (r *Postgres) GetRevision(ctx context.Context, findingID uuid.UUID, revisionNo int) (FindingRevision, error) {
	row, err := r.q.GetFindingRevision(ctx, storegen.GetFindingRevisionParams{FindingID: uuidToPG(findingID), RevisionNo: int32(revisionNo)})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return FindingRevision{}, &ErrFindingRevisionNotFound{FindingID: findingID, RevisionNo: revisionNo}
		}
		return FindingRevision{}, err
	}
	return r.revisionWithEvidence(ctx, r.q, row)
}

func (r *Postgres) ListRevisions(ctx context.Context, findingID uuid.UUID) ([]FindingRevision, error) {
	rows, err := r.q.ListFindingRevisions(ctx, uuidToPG(findingID))
	if err != nil {
		return nil, err
	}
	out := make([]FindingRevision, 0, len(rows))
	for _, row := range rows {
		revision, err := r.revisionWithEvidence(ctx, r.q, row)
		if err != nil {
			return nil, err
		}
		out = append(out, revision)
	}
	return out, nil
}

func (r *Postgres) ReviseFinding(ctx context.Context, p ReviseFindingParams) (Finding, error) {
	var finding Finding
	err := r.withTx(ctx, func(q *storegen.Queries) error {
		row, err := q.UpdateFindingContent(ctx, storegen.UpdateFindingContentParams{
			ID: uuidToPG(p.FindingID), Title: p.Title, Description: p.Description,
			Severity: string(p.Severity), Confidence: string(p.Confidence), Version: int32(p.ExpectedVersion),
		})
		if err != nil {
			return err
		}
		finding = toFinding(row)
		if err := q.DeleteFindingEvidence(ctx, uuidToPG(p.FindingID)); err != nil {
			return err
		}
		for _, evidence := range p.Evidence {
			if err := q.InsertFindingEvidence(ctx, storegen.InsertFindingEvidenceParams{
				FindingID: uuidToPG(p.FindingID), EvidenceID: uuidToPG(evidence.EvidenceID), Role: evidence.Role,
			}); err != nil {
				return err
			}
		}
		return r.createSnapshot(ctx, q, finding, p.Reason, p.Actor)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Finding{}, &ErrOptimisticLock{ID: p.FindingID}
	}
	return finding, err
}

func (r *Postgres) ReviewFinding(ctx context.Context, p ReviewFindingParams) (Finding, error) {
	var finding Finding
	err := r.withTx(ctx, func(q *storegen.Queries) error {
		previous, err := q.GetCurrentFindingRevision(ctx, uuidToPG(p.FindingID))
		if err != nil {
			return err
		}
		row, err := q.UpdateFindingStatus(ctx, storegen.UpdateFindingStatusParams{
			ID: uuidToPG(p.FindingID), Status: string(p.Status), Version: int32(p.ExpectedVersion),
		})
		if err != nil {
			return err
		}
		finding = toFinding(row)
		next, err := r.createSnapshotWithNo(ctx, q, finding, p.Reason, p.Reviewer)
		if err != nil {
			return err
		}
		return q.CreateReviewHistory(ctx, storegen.CreateReviewHistoryParams{
			FindingID: uuidToPG(p.FindingID), FromRevisionNo: intToPG(previous.RevisionNo), ToRevisionNo: intToPG(next),
			FromStatus: previous.Status, ToStatus: string(p.Status), Reviewer: p.Reviewer, Reason: p.Reason,
		})
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Finding{}, &ErrOptimisticLock{ID: p.FindingID}
	}
	return finding, err
}

func (r *Postgres) InsertVerdict(ctx context.Context, p InsertVerdictParams) (FindingVerdict, error) {
	if _, err := r.GetRevision(ctx, p.FindingID, p.RevisionNo); err != nil {
		return FindingVerdict{}, err
	}
	row, err := r.q.InsertVerdict(ctx, storegen.InsertVerdictParams{
		FindingID: uuidToPG(p.FindingID), RevisionNo: intToPG(int32(p.RevisionNo)), Verdict: string(p.Verdict),
		Reason: p.Reason, ProducedBy: p.ProducedBy,
	})
	if err != nil {
		return FindingVerdict{}, err
	}
	return toInsertedVerdict(row), nil
}

func (r *Postgres) ListVerdicts(ctx context.Context, findingID uuid.UUID) ([]FindingVerdict, error) {
	rows, err := r.q.ListVerdictsByFinding(ctx, uuidToPG(findingID))
	if err != nil {
		return nil, err
	}
	out := make([]FindingVerdict, 0, len(rows))
	for _, row := range rows {
		out = append(out, FindingVerdict{
			ID: pgToUUID(row.ID), FindingID: pgToUUID(row.FindingID), RevisionNo: pgToInt(row.RevisionNo),
			Verdict: Verdict(row.Verdict), Reason: row.Reason, ProducedBy: row.ProducedBy,
			CreatedAt: pgToTime(row.CreatedAt), Legacy: row.Legacy,
		})
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
		out = append(out, ReviewHistoryEntry{
			ID: pgToUUID(row.ID), FindingID: pgToUUID(row.FindingID), FromRevisionNo: pgToInt(row.FromRevisionNo), ToRevisionNo: pgToInt(row.ToRevisionNo),
			FromStatus: FindingStatus(row.FromStatus), ToStatus: FindingStatus(row.ToStatus), Reviewer: row.Reviewer,
			Reason: row.Reason, CreatedAt: pgToTime(row.CreatedAt), Legacy: row.Legacy,
		})
	}
	return out, nil
}

func (r *Postgres) createSnapshot(ctx context.Context, q *storegen.Queries, finding Finding, reason, actor string) error {
	_, err := r.createSnapshotWithNo(ctx, q, finding, reason, actor)
	return err
}

func (r *Postgres) createSnapshotWithNo(ctx context.Context, q *storegen.Queries, finding Finding, reason, actor string) (int32, error) {
	revisionNo, err := q.NextFindingRevisionNo(ctx, uuidToPG(finding.ID))
	if err != nil {
		return 0, err
	}
	if _, err := q.CreateFindingRevision(ctx, revisionParams(finding, revisionNo, reason, actor)); err != nil {
		return 0, err
	}
	if err := q.SnapshotFindingEvidence(ctx, storegen.SnapshotFindingEvidenceParams{FindingID: uuidToPG(finding.ID), RevisionNo: revisionNo}); err != nil {
		return 0, err
	}
	return revisionNo, nil
}

func (r *Postgres) revisionWithEvidence(ctx context.Context, q *storegen.Queries, row storegen.FindingRevision) (FindingRevision, error) {
	revision := toRevision(row)
	evidence, err := q.ListFindingRevisionEvidence(ctx, storegen.ListFindingRevisionEvidenceParams{
		FindingID: uuidToPG(revision.FindingID), RevisionNo: int32(revision.RevisionNo),
	})
	if err != nil {
		return FindingRevision{}, err
	}
	revision.Evidence = make([]EvidenceRef, 0, len(evidence))
	for _, item := range evidence {
		revision.Evidence = append(revision.Evidence, EvidenceRef{EvidenceID: pgToUUID(item.EvidenceID), Role: item.Role})
	}
	return revision, nil
}

func (r *Postgres) withTx(ctx context.Context, fn func(*storegen.Queries) error) error {
	if tx, ok := r.exec.(pgx.Tx); ok {
		return fn(storegen.New(tx))
	}
	beginner, ok := r.exec.(txBeginner)
	if !ok {
		return fmt.Errorf("finding revision mutation requires a transaction-capable database")
	}
	tx, err := beginner.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin finding transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()
	if err := fn(storegen.New(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit finding transaction: %w", err)
	}
	committed = true
	return nil
}

func revisionParams(f Finding, revisionNo int32, reason, actor string) storegen.CreateFindingRevisionParams {
	return storegen.CreateFindingRevisionParams{
		FindingID: uuidToPG(f.ID), RevisionNo: revisionNo, Title: f.Title, Description: f.Description,
		Severity: string(f.Severity), Confidence: string(f.Confidence), Status: string(f.Status), ChangeReason: reason, Actor: actor,
	}
}

func toFinding(f storegen.Finding) Finding {
	return Finding{ID: pgToUUID(f.ID), RunID: pgToUUID(f.RunID), Title: f.Title, Description: f.Description,
		Severity: Severity(f.Severity), Confidence: Confidence(f.Confidence), Status: FindingStatus(f.Status), Version: int(f.Version),
		CreatedAt: pgToTime(f.CreatedAt), UpdatedAt: pgToTime(f.UpdatedAt)}
}

func toRevision(r storegen.FindingRevision) FindingRevision {
	return FindingRevision{FindingID: pgToUUID(r.FindingID), RevisionNo: int(r.RevisionNo), Title: r.Title,
		Description: r.Description, Severity: Severity(r.Severity), Confidence: Confidence(r.Confidence), Status: FindingStatus(r.Status),
		ChangeReason: r.ChangeReason, Actor: r.Actor, CreatedAt: pgToTime(r.CreatedAt)}
}

func toInsertedVerdict(v storegen.InsertVerdictRow) FindingVerdict {
	return FindingVerdict{ID: pgToUUID(v.ID), FindingID: pgToUUID(v.FindingID), RevisionNo: pgToInt(v.RevisionNo),
		Verdict: Verdict(v.Verdict), Reason: v.Reason, ProducedBy: v.ProducedBy, CreatedAt: pgToTime(v.CreatedAt), Legacy: v.Legacy}
}

func uuidToPG(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func pgToUUID(u pgtype.UUID) uuid.UUID {
	if !u.Valid {
		return uuid.Nil
	}
	return u.Bytes
}

func intToPG(i int32) pgtype.Int4 { return pgtype.Int4{Int32: i, Valid: true} }

func pgToInt(i pgtype.Int4) *int {
	if !i.Valid {
		return nil
	}
	value := int(i.Int32)
	return &value
}

func pgToTime(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}
