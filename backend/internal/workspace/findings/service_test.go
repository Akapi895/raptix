package findings

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"github.com/google/uuid"
)

// testRunID is a fixed run id used by unit tests; row ids come from newID.
var testRunID = uuid.MustParse("11111111-1111-1111-1111-111111111111")

// memRepo is an in-memory Repository for unit tests.
type memRepo struct {
	findings map[uuid.UUID]Finding
	verdicts map[uuid.UUID][]FindingVerdict
	history  map[uuid.UUID][]ReviewHistoryEntry
	links    []EvidenceLink
	next     int
}

func newMemRepo() *memRepo {
	return &memRepo{
		findings: map[uuid.UUID]Finding{},
		verdicts: map[uuid.UUID][]FindingVerdict{},
		history:  map[uuid.UUID][]ReviewHistoryEntry{},
	}
}

// newID returns a unique deterministic id per call so multi-entity tests do not
// silently overwrite each other.
func (m *memRepo) newID() uuid.UUID {
	m.next++
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("findings-"+strconv.Itoa(m.next)))
}

func (m *memRepo) CreateFinding(ctx context.Context, p CreateFindingParams) (Finding, error) {
	f := Finding{
		ID: m.newID(), RunID: p.RunID, Title: p.Title, Description: p.Description,
		Severity: p.Severity, Confidence: p.Confidence, Status: StatusDraft, Version: 1,
	}
	m.findings[f.ID] = f
	return f, nil
}

func (m *memRepo) GetFinding(ctx context.Context, id uuid.UUID) (Finding, error) {
	f, ok := m.findings[id]
	if !ok {
		return Finding{}, &ErrFindingNotFound{ID: id}
	}
	return f, nil
}

func (m *memRepo) ListFindingsByRun(ctx context.Context, runID uuid.UUID) ([]Finding, error) {
	var out []Finding
	for _, f := range m.findings {
		if f.RunID == runID {
			out = append(out, f)
		}
	}
	return out, nil
}

func (m *memRepo) TransitionFindingWithHistory(ctx context.Context, id uuid.UUID, version int, to FindingStatus, reviewer, reason string) (Finding, error) {
	f, ok := m.findings[id]
	if !ok {
		return Finding{}, &ErrFindingNotFound{ID: id}
	}
	if f.Version != version {
		return Finding{}, &ErrOptimisticLock{ID: id}
	}
	from := f.Status
	f.Status = to
	f.Version++
	m.findings[id] = f
	m.history[id] = append(m.history[id], ReviewHistoryEntry{
		ID: m.newID(), FindingID: id, FromStatus: from, ToStatus: to, Reviewer: reviewer, Reason: reason,
	})
	return f, nil
}

func (m *memRepo) LinkEvidence(ctx context.Context, link EvidenceLink) error {
	m.links = append(m.links, link)
	return nil
}

func (m *memRepo) InsertVerdict(ctx context.Context, p InsertVerdictParams) (FindingVerdict, error) {
	// Deliberately does NOT touch findings[id].Status: verifiers must not flip status.
	v := FindingVerdict{ID: m.newID(), FindingID: p.FindingID, Verdict: p.Verdict, Reason: p.Reason, ProducedBy: p.ProducedBy}
	m.verdicts[p.FindingID] = append(m.verdicts[p.FindingID], v)
	return v, nil
}

func (m *memRepo) ListVerdicts(ctx context.Context, findingID uuid.UUID) ([]FindingVerdict, error) {
	return append([]FindingVerdict(nil), m.verdicts[findingID]...), nil
}

func (m *memRepo) ListReviewHistory(ctx context.Context, findingID uuid.UUID) ([]ReviewHistoryEntry, error) {
	return append([]ReviewHistoryEntry(nil), m.history[findingID]...), nil
}

func TestCreateFindingValidates(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	run := testRunID
	if _, err := svc.CreateFinding(ctx, CreateFindingParams{RunID: run, Title: "  ", Severity: SeverityMedium, Confidence: ConfidenceLow}); err == nil {
		t.Error("expected empty-title error")
	}
	if _, err := svc.CreateFinding(ctx, CreateFindingParams{RunID: run, Title: "x", Severity: "extreme", Confidence: ConfidenceLow}); err == nil {
		t.Error("expected invalid-severity error")
	}
	f, err := svc.CreateFinding(ctx, CreateFindingParams{RunID: run, Title: "SQLi", Severity: SeverityHigh, Confidence: ConfidenceHigh})
	if err != nil {
		t.Fatal(err)
	}
	if f.Status != StatusDraft || f.Version != 1 {
		t.Errorf("finding = %+v", f)
	}
}

func TestLegalTransitionAndHistory(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "XSS", Severity: SeverityHigh, Confidence: ConfidenceMedium})
	updated, err := svc.TransitionStatus(ctx, f.ID, 1, StatusReviewed, "bob", "reviewed")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != StatusReviewed || updated.Version != 2 {
		t.Errorf("updated = %+v", updated)
	}
	history, err := svc.ListReviewHistory(ctx, f.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0].FromStatus != StatusDraft || history[0].ToStatus != StatusReviewed {
		t.Errorf("history = %+v", history)
	}
}

func TestIllegalTransitionRejected(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "RCE", Severity: SeverityCritical, Confidence: ConfidenceHigh})
	if _, err := svc.TransitionStatus(ctx, f.ID, 1, StatusCancelledLike, "bob", ""); err == nil {
		t.Error("expected illegal transition error")
	}
	// A version that does not match the stored version must be rejected even if
	// the requested status is otherwise legal (guards against a stale view).
	if _, err := svc.TransitionStatus(ctx, f.ID, -1, StatusConfirmed, "bob", ""); err == nil {
		t.Error("expected optimistic-lock error for mismatched version")
	} else {
		var lock *ErrOptimisticLock
		if !errors.As(err, &lock) {
			t.Errorf("err = %v, want ErrOptimisticLock", err)
		}
	}
}

func TestTransitionRequiresReviewer(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "X", Severity: SeverityLow, Confidence: ConfidenceLow})
	if _, err := svc.TransitionStatus(ctx, f.ID, 1, StatusReviewed, "  ", ""); err == nil {
		t.Error("expected empty-reviewer error")
	}
}

func TestLinkEvidenceValidatesRole(t *testing.T) {
	repo := newMemRepo()
	svc := NewService(repo)
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "X", Severity: SeverityLow, Confidence: ConfidenceLow})
	ev := uuid.New()

	if err := svc.LinkEvidence(ctx, f.ID, ev, "bogus"); err == nil {
		t.Error("expected invalid-role error")
	}
	if err := svc.LinkEvidence(ctx, f.ID, uuid.Nil, "supporting"); err == nil {
		t.Error("expected nil-evidence error")
	}
	// Empty role defaults to supporting.
	if err := svc.LinkEvidence(ctx, f.ID, ev, ""); err != nil {
		t.Fatalf("default role link: %v", err)
	}
	if len(repo.links) != 1 || repo.links[0].Role != "supporting" {
		t.Errorf("links = %+v", repo.links)
	}
}

func TestOptimisticLockConflict(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "SSRF", Severity: SeverityHigh, Confidence: ConfidenceLow})
	if _, err := svc.TransitionStatus(ctx, f.ID, 99, StatusReviewed, "bob", ""); err == nil {
		t.Error("expected optimistic-lock error on stale version")
	}
}

func TestRecordVerdictDoesNotChangeStatus(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	f, _ := svc.CreateFinding(ctx, CreateFindingParams{RunID: testRunID, Title: "IDOR", Severity: SeverityMedium, Confidence: ConfidenceLow})

	// Advance to reviewed so we can observe that a verdict leaves status untouched.
	if _, err := svc.TransitionStatus(ctx, f.ID, 1, StatusReviewed, "bob", "ok"); err != nil {
		t.Fatal(err)
	}

	before, _ := svc.GetFinding(ctx, f.ID)
	if _, err := svc.RecordVerdict(ctx, InsertVerdictParams{FindingID: f.ID, Verdict: VerdictRefuted, Reason: "manual", ProducedBy: "verifier-a"}); err != nil {
		t.Fatal(err)
	}
	after, _ := svc.GetFinding(ctx, f.ID)
	if after.Status != before.Status {
		t.Fatalf("RecordVerdict changed status: before=%s after=%s (verifier must not flip status)", before.Status, after.Status)
	}
	if after.Version != before.Version {
		t.Errorf("RecordVerdict changed version: %d -> %d", before.Version, after.Version)
	}
	verdicts, _ := svc.ListVerdicts(ctx, f.ID)
	if len(verdicts) != 1 || verdicts[0].Verdict != VerdictRefuted {
		t.Errorf("verdicts = %+v", verdicts)
	}
}

// StatusCancelledLike is a deliberately invalid status used in tests.
const StatusCancelledLike FindingStatus = "cancelled"
