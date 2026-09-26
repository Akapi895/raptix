package reporting

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

type memRepo struct {
	mu    sync.Mutex
	byID  map[uuid.UUID]Report
	byRun map[uuid.UUID]uuid.UUID
}

func newMemRepo() *memRepo {
	return &memRepo{byID: map[uuid.UUID]Report{}, byRun: map[uuid.UUID]uuid.UUID{}}
}

func (m *memRepo) CreateOrGet(ctx context.Context, p CreateParams) (CreateResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.byRun[p.RunID]; ok {
		return CreateResult{Report: cloneReport(m.byID[id])}, nil
	}
	now := time.Now().UTC()
	report := Report{
		ID: uuid.New(), RunID: p.RunID, Template: p.Template, Snapshot: append([]byte(nil), p.Snapshot...),
		Status: StatusQueued, Version: 1, CreatedAt: now, UpdatedAt: now,
	}
	m.byID[report.ID], m.byRun[report.RunID] = report, report.ID
	return CreateResult{Report: cloneReport(report), Created: true}, nil
}

func (m *memRepo) Get(ctx context.Context, id uuid.UUID) (Report, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	report, ok := m.byID[id]
	if !ok {
		return Report{}, &ErrReportNotFound{ID: id}
	}
	return cloneReport(report), nil
}

func (m *memRepo) GetByRun(ctx context.Context, runID uuid.UUID) (Report, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.byRun[runID]
	if !ok {
		return Report{}, &ErrReportNotFound{}
	}
	return cloneReport(m.byID[id]), nil
}

func (m *memRepo) Claim(ctx context.Context, p ClaimParams) (Report, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	report, ok := m.byID[p.ID]
	if !ok {
		return Report{}, &ErrReportNotFound{ID: p.ID}
	}
	canClaim := report.Status == StatusQueued || (report.Status == StatusRendering && report.LeaseExpiresAt != nil && !report.LeaseExpiresAt.After(time.Now()))
	if report.Version != p.ExpectedVersion || !canClaim {
		return Report{}, &ErrOptimisticLock{ID: p.ID}
	}
	expires := time.Now().UTC().Add(p.LeaseDuration)
	report.Status, report.LeaseOwner, report.LeaseExpiresAt = StatusRendering, p.Worker, &expires
	report.Version++
	report.UpdatedAt = time.Now().UTC()
	m.byID[p.ID] = report
	return cloneReport(report), nil
}

func (m *memRepo) Complete(ctx context.Context, p CompleteParams) (Report, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	report, ok := m.byID[p.ID]
	if !ok {
		return Report{}, &ErrReportNotFound{ID: p.ID}
	}
	if report.Status == StatusCompleted {
		return cloneReport(report), nil
	}
	if report.Version != p.ExpectedVersion || report.Status != StatusRendering || report.LeaseOwner != p.Worker || report.LeaseExpiresAt == nil || !report.LeaseExpiresAt.After(time.Now()) || report.OutputArtifactID != nil {
		return Report{}, &ErrOptimisticLock{ID: p.ID}
	}
	artifactID := p.OutputArtifactID
	report.Status, report.OutputArtifactID = StatusCompleted, &artifactID
	report.LeaseOwner, report.LeaseExpiresAt = "", nil
	report.Version++
	report.UpdatedAt = time.Now().UTC()
	m.byID[p.ID] = report
	return cloneReport(report), nil
}

func (m *memRepo) Fail(ctx context.Context, p FailParams) (Report, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	report, ok := m.byID[p.ID]
	if !ok {
		return Report{}, &ErrReportNotFound{ID: p.ID}
	}
	if report.Version != p.ExpectedVersion || report.Status != StatusRendering || report.LeaseOwner != p.Worker || report.LeaseExpiresAt == nil || !report.LeaseExpiresAt.After(time.Now()) {
		return Report{}, &ErrOptimisticLock{ID: p.ID}
	}
	report.Status, report.FailureCode, report.FailureMessage = StatusFailed, p.Code, p.Message
	report.LeaseOwner, report.LeaseExpiresAt = "", nil
	report.Version++
	report.UpdatedAt = time.Now().UTC()
	m.byID[p.ID] = report
	return cloneReport(report), nil
}

func (m *memRepo) Cancel(ctx context.Context, p CancelParams) (Report, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	report, ok := m.byID[p.ID]
	if !ok {
		return Report{}, &ErrReportNotFound{ID: p.ID}
	}
	if report.Version != p.ExpectedVersion || (report.Status != StatusQueued && report.Status != StatusRendering) {
		return Report{}, &ErrOptimisticLock{ID: p.ID}
	}
	report.Status, report.LeaseOwner, report.LeaseExpiresAt = StatusCancelled, "", nil
	report.Version++
	report.UpdatedAt = time.Now().UTC()
	m.byID[p.ID] = report
	return cloneReport(report), nil
}

func cloneReport(report Report) Report {
	report.Snapshot = append([]byte(nil), report.Snapshot...)
	if report.LeaseExpiresAt != nil {
		value := *report.LeaseExpiresAt
		report.LeaseExpiresAt = &value
	}
	if report.OutputArtifactID != nil {
		value := *report.OutputArtifactID
		report.OutputArtifactID = &value
	}
	return report
}
