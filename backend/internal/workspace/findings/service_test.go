package findings

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"testing"

	"github.com/google/uuid"
)

var testRunID = uuid.MustParse("11111111-1111-1111-1111-111111111111")

type memRepo struct {
	mu        sync.Mutex
	findings  map[uuid.UUID]Finding
	revisions map[uuid.UUID][]FindingRevision
	verdicts  map[uuid.UUID][]FindingVerdict
	history   map[uuid.UUID][]ReviewHistoryEntry
	next      int
}

func newMemRepo() *memRepo {
	return &memRepo{
		findings: map[uuid.UUID]Finding{}, revisions: map[uuid.UUID][]FindingRevision{},
		verdicts: map[uuid.UUID][]FindingVerdict{}, history: map[uuid.UUID][]ReviewHistoryEntry{},
	}
}

func (m *memRepo) newID() uuid.UUID {
	m.next++
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("findings-"+strconv.Itoa(m.next)))
}

func (m *memRepo) CreateFinding(ctx context.Context, p CreateFindingParams) (Finding, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f := Finding{ID: m.newID(), RunID: p.RunID, Title: p.Title, Description: p.Description, Severity: p.Severity, Confidence: p.Confidence, Status: StatusDraft, Version: 1}
	m.findings[f.ID] = f
	m.revisions[f.ID] = []FindingRevision{{FindingID: f.ID, RevisionNo: 1, Title: f.Title, Description: f.Description, Severity: f.Severity, Confidence: f.Confidence, Status: f.Status, ChangeReason: p.Reason, Actor: p.Actor, Evidence: append([]EvidenceRef(nil), p.Evidence...)}}
	return f, nil
}

func (m *memRepo) GetFinding(ctx context.Context, id uuid.UUID) (Finding, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, ok := m.findings[id]
	if !ok {
		return Finding{}, &ErrFindingNotFound{ID: id}
	}
	return f, nil
}

func (m *memRepo) ListFindingsByRun(ctx context.Context, runID uuid.UUID) ([]Finding, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Finding
	for _, f := range m.findings {
		if f.RunID == runID {
			out = append(out, f)
		}
	}
	return out, nil
}

func (m *memRepo) GetCurrentRevision(ctx context.Context, findingID uuid.UUID) (FindingRevision, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	revisions := m.revisions[findingID]
	if len(revisions) == 0 {
		return FindingRevision{}, &ErrFindingRevisionNotFound{FindingID: findingID}
	}
	return cloneRevision(revisions[len(revisions)-1]), nil
}

func (m *memRepo) GetRevision(ctx context.Context, findingID uuid.UUID, revisionNo int) (FindingRevision, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, revision := range m.revisions[findingID] {
		if revision.RevisionNo == revisionNo {
			return cloneRevision(revision), nil
		}
	}
	return FindingRevision{}, &ErrFindingRevisionNotFound{FindingID: findingID, RevisionNo: revisionNo}
}

func (m *memRepo) ListRevisions(ctx context.Context, findingID uuid.UUID) ([]FindingRevision, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	revisions := m.revisions[findingID]
	out := make([]FindingRevision, 0, len(revisions))
	for i := len(revisions) - 1; i >= 0; i-- {
		out = append(out, cloneRevision(revisions[i]))
	}
	return out, nil
}

func (m *memRepo) ReviseFinding(ctx context.Context, p ReviseFindingParams) (Finding, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, ok := m.findings[p.FindingID]
	if !ok {
		return Finding{}, &ErrFindingNotFound{ID: p.FindingID}
	}
	if f.Version != p.ExpectedVersion {
		return Finding{}, &ErrOptimisticLock{ID: p.FindingID}
	}
	f.Title, f.Description, f.Severity, f.Confidence = p.Title, p.Description, p.Severity, p.Confidence
	f.Version++
	m.findings[f.ID] = f
	m.appendRevision(f, p.Reason, p.Actor, p.Evidence)
	return f, nil
}

func (m *memRepo) ReviewFinding(ctx context.Context, p ReviewFindingParams) (Finding, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, ok := m.findings[p.FindingID]
	if !ok {
		return Finding{}, &ErrFindingNotFound{ID: p.FindingID}
	}
	if f.Version != p.ExpectedVersion {
		return Finding{}, &ErrOptimisticLock{ID: p.FindingID}
	}
	previous := m.revisions[f.ID][len(m.revisions[f.ID])-1]
	f.Status, f.Version = p.Status, f.Version+1
	m.findings[f.ID] = f
	next := m.appendRevision(f, p.Reason, p.Reviewer, previous.Evidence)
	fromNo, toNo := previous.RevisionNo, next.RevisionNo
	m.history[f.ID] = append(m.history[f.ID], ReviewHistoryEntry{ID: m.newID(), FindingID: f.ID, FromRevisionNo: &fromNo, ToRevisionNo: &toNo, FromStatus: previous.Status, ToStatus: p.Status, Reviewer: p.Reviewer, Reason: p.Reason})
	return f, nil
}

func (m *memRepo) appendRevision(f Finding, reason, actor string, evidence []EvidenceRef) FindingRevision {
	revision := FindingRevision{FindingID: f.ID, RevisionNo: len(m.revisions[f.ID]) + 1, Title: f.Title, Description: f.Description, Severity: f.Severity, Confidence: f.Confidence, Status: f.Status, ChangeReason: reason, Actor: actor, Evidence: append([]EvidenceRef(nil), evidence...)}
	m.revisions[f.ID] = append(m.revisions[f.ID], revision)
	return revision
}

func (m *memRepo) InsertVerdict(ctx context.Context, p InsertVerdictParams) (FindingVerdict, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for _, revision := range m.revisions[p.FindingID] {
		found = found || revision.RevisionNo == p.RevisionNo
	}
	if !found {
		return FindingVerdict{}, &ErrFindingRevisionNotFound{FindingID: p.FindingID, RevisionNo: p.RevisionNo}
	}
	revisionNo := p.RevisionNo
	v := FindingVerdict{ID: m.newID(), FindingID: p.FindingID, RevisionNo: &revisionNo, Verdict: p.Verdict, Reason: p.Reason, ProducedBy: p.ProducedBy}
	m.verdicts[p.FindingID] = append(m.verdicts[p.FindingID], v)
	return v, nil
}

func (m *memRepo) ListVerdicts(ctx context.Context, findingID uuid.UUID) ([]FindingVerdict, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]FindingVerdict(nil), m.verdicts[findingID]...), nil
}

func (m *memRepo) ListReviewHistory(ctx context.Context, findingID uuid.UUID) ([]ReviewHistoryEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]ReviewHistoryEntry(nil), m.history[findingID]...), nil
}

func cloneRevision(revision FindingRevision) FindingRevision {
	revision.Evidence = append([]EvidenceRef(nil), revision.Evidence...)
	return revision
}

func TestCreateFindingCreatesInitialRevision(t *testing.T) {
	svc := NewService(newMemRepo())
	f, err := svc.CreateFinding(context.Background(), CreateFindingParams{RunID: testRunID, Title: "SQLi", Severity: SeverityHigh, Confidence: ConfidenceHigh})
	if err != nil {
		t.Fatal(err)
	}
	revision, err := svc.GetCurrentRevision(context.Background(), f.ID)
	if err != nil {
		t.Fatal(err)
	}
	if f.Status != StatusDraft || f.Version != 1 || revision.RevisionNo != 1 || revision.Actor != "system" {
		t.Errorf("finding/revision = %+v / %+v", f, revision)
	}
}

func TestReviseFindingSnapshotsEvidence(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "XSS", Severity: SeverityHigh, Confidence: ConfidenceMedium})
	evidence := uuid.New()
	updated, err := svc.ReviseFinding(ctx, ReviseFindingParams{FindingID: f.ID, ExpectedVersion: f.Version, Title: "Stored XSS", Severity: SeverityHigh, Confidence: ConfidenceHigh, Evidence: []EvidenceRef{{EvidenceID: evidence, Role: "supporting"}}, Reason: "added reproduction", Actor: "alice"})
	if err != nil {
		t.Fatal(err)
	}
	baseline, _ := svc.GetRevision(ctx, f.ID, 1)
	current, _ := svc.GetCurrentRevision(ctx, f.ID)
	if updated.Version != 2 || current.RevisionNo != 2 || len(current.Evidence) != 1 || len(baseline.Evidence) != 0 {
		t.Errorf("baseline/current = %+v / %+v", baseline, current)
	}
}

func TestConcurrentReviewsOnlyOneVersionWins(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "RCE", Severity: SeverityCritical, Confidence: ConfidenceHigh})
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, reviewer := range []string{"alice", "bob"} {
		wg.Add(1)
		go func(reviewer string) {
			defer wg.Done()
			_, err := svc.ReviewFinding(ctx, ReviewFindingParams{FindingID: f.ID, ExpectedVersion: 1, Status: StatusReviewed, Reviewer: reviewer, Reason: "review"})
			errs <- err
		}(reviewer)
	}
	wg.Wait()
	close(errs)
	successes, conflicts := 0, 0
	for err := range errs {
		if err == nil {
			successes++
			continue
		}
		var conflict *ErrOptimisticLock
		if errors.As(err, &conflict) {
			conflicts++
		}
	}
	history, _ := svc.ListReviewHistory(ctx, f.ID)
	if successes != 1 || conflicts != 1 || len(history) != 1 || history[0].FromRevisionNo == nil || history[0].ToRevisionNo == nil {
		t.Fatalf("successes=%d conflicts=%d history=%+v", successes, conflicts, history)
	}
}

func TestLateVerdictRemainsBoundToVerifiedRevision(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "SSRF", Severity: SeverityHigh, Confidence: ConfidenceLow})
	verified, _ := svc.GetCurrentRevision(ctx, f.ID)
	updated, err := svc.ReviseFinding(ctx, ReviseFindingParams{FindingID: f.ID, ExpectedVersion: f.Version, Title: "SSRF via callback", Severity: SeverityHigh, Confidence: ConfidenceMedium, Reason: "clarified impact", Actor: "alice"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RecordVerdict(ctx, InsertVerdictParams{FindingID: f.ID, RevisionNo: verified.RevisionNo, Verdict: VerdictConfirmed, ProducedBy: "verifier"}); err != nil {
		t.Fatal(err)
	}
	verdicts, _ := svc.ListVerdicts(ctx, f.ID)
	if len(verdicts) != 1 || verdicts[0].RevisionNo == nil || *verdicts[0].RevisionNo != 1 || updated.Status != StatusDraft {
		t.Fatalf("verdicts=%+v updated=%+v", verdicts, updated)
	}
}

func TestReportInputUsesCurrentRevisionOnly(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "Open redirect", Severity: SeverityLow, Confidence: ConfidenceMedium})
	if _, err := svc.RecordVerdict(ctx, InsertVerdictParams{FindingID: f.ID, RevisionNo: 1, Verdict: VerdictConfirmed, ProducedBy: "verifier"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReviseFinding(ctx, ReviseFindingParams{FindingID: f.ID, ExpectedVersion: 1, Title: "Open redirect", Severity: SeverityMedium, Confidence: ConfidenceMedium, Reason: "impact updated", Actor: "alice"}); err != nil {
		t.Fatal(err)
	}
	input, err := svc.GetReportInput(ctx, f.ID)
	if err != nil {
		t.Fatal(err)
	}
	if input.Revision.RevisionNo != 2 || len(input.Verdicts) != 0 {
		t.Fatalf("report input = %+v", input)
	}
}

func TestLegacyHistoryAndVerdictsRemainReadableWithoutRevision(t *testing.T) {
	repo := newMemRepo()
	svc := NewService(repo)
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "Legacy", Severity: SeverityLow, Confidence: ConfidenceLow})
	repo.mu.Lock()
	repo.verdicts[f.ID] = append(repo.verdicts[f.ID], FindingVerdict{ID: repo.newID(), FindingID: f.ID, Verdict: VerdictInconclusive, ProducedBy: "legacy", Legacy: true})
	repo.history[f.ID] = append(repo.history[f.ID], ReviewHistoryEntry{ID: repo.newID(), FindingID: f.ID, FromStatus: StatusDraft, ToStatus: StatusReviewed, Reviewer: "legacy", Legacy: true})
	repo.mu.Unlock()
	verdicts, err := svc.ListVerdicts(ctx, f.ID)
	if err != nil {
		t.Fatal(err)
	}
	history, err := svc.ListReviewHistory(ctx, f.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(verdicts) != 1 || !verdicts[0].Legacy || verdicts[0].RevisionNo != nil || len(history) != 1 || !history[0].Legacy || history[0].FromRevisionNo != nil || history[0].ToRevisionNo != nil {
		t.Fatalf("legacy rows were not preserved: verdicts=%+v history=%+v", verdicts, history)
	}
}

func TestReviewRejectsIllegalTransitionAndUnversionedEvidence(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "IDOR", Severity: SeverityMedium, Confidence: ConfidenceLow})
	if _, err := svc.ReviewFinding(ctx, ReviewFindingParams{FindingID: f.ID, ExpectedVersion: f.Version, Status: StatusConfirmed, Reviewer: "bob", Reason: "review"}); err == nil {
		t.Fatal("expected illegal transition")
	}
	if err := svc.LinkEvidence(ctx, f.ID, uuid.New(), "supporting"); err == nil {
		t.Fatal("expected unversioned evidence error")
	}
}
