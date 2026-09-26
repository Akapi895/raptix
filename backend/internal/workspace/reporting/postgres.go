package reporting

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Akapi895/raptix/backend/internal/workspace/reporting/storegen"
)

// Postgres implements Repository over pgx through the reporting-generated
// store. It is the only reporting file that imports storegen.
type Postgres struct {
	q *storegen.Queries
}

// DBTX is the minimal query interface implemented by both a pgx pool and tx.
type DBTX interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
	Query(context.Context, string, ...interface{}) (pgx.Rows, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
}

// NewPostgres builds a repository backed by a pgx query executor.
func NewPostgres(exec DBTX) *Postgres {
	return &Postgres{q: storegen.New(exec)}
}

func (r *Postgres) CreateOrGet(ctx context.Context, p CreateParams) (CreateResult, error) {
	row, err := r.q.CreateReport(ctx, storegen.CreateReportParams{
		RunID:           uuidToPG(p.RunID),
		TemplateID:      p.Template.ID,
		TemplateVersion: p.Template.Version,
		TemplateHash:    p.Template.Hash,
		Snapshot:        p.Snapshot,
	})
	if err != nil {
		return CreateResult{}, fmt.Errorf("create report: %w", err)
	}
	return CreateResult{Report: toCreatedReport(row), Created: row.Created}, nil
}

func (r *Postgres) Get(ctx context.Context, id uuid.UUID) (Report, error) {
	row, err := r.q.GetReport(ctx, uuidToPG(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Report{}, &ErrReportNotFound{ID: id}
		}
		return Report{}, err
	}
	return toReport(row), nil
}

func (r *Postgres) GetByRun(ctx context.Context, runID uuid.UUID) (Report, error) {
	row, err := r.q.GetReportByRun(ctx, uuidToPG(runID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Report{}, &ErrReportNotFound{}
		}
		return Report{}, err
	}
	return toReport(row), nil
}

func (r *Postgres) Claim(ctx context.Context, p ClaimParams) (Report, error) {
	row, err := r.q.ClaimReport(ctx, storegen.ClaimReportParams{
		ID: uuidToPG(p.ID), LeaseOwner: textToPG(p.Worker),
		Column3: p.LeaseDuration.Microseconds(), Version: int32(p.ExpectedVersion),
	})
	if err != nil {
		return Report{}, r.transitionError(ctx, p.ID, err)
	}
	return toReport(row), nil
}

func (r *Postgres) Complete(ctx context.Context, p CompleteParams) (Report, error) {
	row, err := r.q.CompleteReport(ctx, storegen.CompleteReportParams{
		ID: uuidToPG(p.ID), Version: int32(p.ExpectedVersion),
		OutputArtifactID: uuidToPG(p.OutputArtifactID), LeaseOwner: textToPG(p.Worker),
	})
	if err == nil {
		return toReport(row), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Report{}, err
	}
	// A duplicate delivery can lose the CAS after another worker has completed.
	// Return the sole linked output instead of attempting a second publication.
	current, getErr := r.Get(ctx, p.ID)
	if getErr != nil {
		return Report{}, getErr
	}
	if current.Status == StatusCompleted {
		return current, nil
	}
	return Report{}, &ErrOptimisticLock{ID: p.ID}
}

func (r *Postgres) Fail(ctx context.Context, p FailParams) (Report, error) {
	row, err := r.q.FailReport(ctx, storegen.FailReportParams{
		ID: uuidToPG(p.ID), Version: int32(p.ExpectedVersion), FailureCode: p.Code,
		FailureMessage: p.Message, LeaseOwner: textToPG(p.Worker),
	})
	if err != nil {
		return Report{}, r.transitionError(ctx, p.ID, err)
	}
	return toReport(row), nil
}

func (r *Postgres) Cancel(ctx context.Context, p CancelParams) (Report, error) {
	row, err := r.q.CancelReport(ctx, storegen.CancelReportParams{
		ID: uuidToPG(p.ID), Version: int32(p.ExpectedVersion),
	})
	if err != nil {
		return Report{}, r.transitionError(ctx, p.ID, err)
	}
	return toReport(row), nil
}

func (r *Postgres) transitionError(ctx context.Context, id uuid.UUID, err error) error {
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if _, getErr := r.Get(ctx, id); getErr != nil {
		return getErr
	}
	return &ErrOptimisticLock{ID: id}
}

func toCreatedReport(r storegen.CreateReportRow) Report {
	return Report{
		ID: pgToUUID(r.ID), RunID: pgToUUID(r.RunID),
		Template: Template{ID: r.TemplateID, Version: r.TemplateVersion, Hash: r.TemplateHash},
		Snapshot: append([]byte(nil), r.Snapshot...), Status: Status(r.Status), Version: int(r.Version),
		LeaseOwner: pgToText(r.LeaseOwner), LeaseExpiresAt: pgToTimePtr(r.LeaseExpiresAt),
		OutputArtifactID: pgToUUIDPtr(r.OutputArtifactID), FailureCode: r.FailureCode,
		FailureMessage: r.FailureMessage, CreatedAt: pgToTime(r.CreatedAt), UpdatedAt: pgToTime(r.UpdatedAt),
	}
}

func toReport(r storegen.ReportRequest) Report {
	return Report{
		ID: pgToUUID(r.ID), RunID: pgToUUID(r.RunID),
		Template: Template{ID: r.TemplateID, Version: r.TemplateVersion, Hash: r.TemplateHash},
		Snapshot: append([]byte(nil), r.Snapshot...), Status: Status(r.Status), Version: int(r.Version),
		LeaseOwner: pgToText(r.LeaseOwner), LeaseExpiresAt: pgToTimePtr(r.LeaseExpiresAt),
		OutputArtifactID: pgToUUIDPtr(r.OutputArtifactID), FailureCode: r.FailureCode,
		FailureMessage: r.FailureMessage, CreatedAt: pgToTime(r.CreatedAt), UpdatedAt: pgToTime(r.UpdatedAt),
	}
}

func uuidToPG(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func pgToUUID(id pgtype.UUID) uuid.UUID {
	if !id.Valid {
		return uuid.Nil
	}
	return id.Bytes
}

func pgToUUIDPtr(id pgtype.UUID) *uuid.UUID {
	if !id.Valid {
		return nil
	}
	value := uuid.UUID(id.Bytes)
	return &value
}

func textToPG(value string) pgtype.Text { return pgtype.Text{String: value, Valid: true} }

func pgToText(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func pgToTime(value pgtype.Timestamptz) time.Time {
	if !value.Valid {
		return time.Time{}
	}
	return value.Time
}

func pgToTimePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	copy := value.Time
	return &copy
}
