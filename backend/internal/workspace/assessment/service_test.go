package assessment

import (
	"context"
	"strconv"
	"testing"

	"github.com/google/uuid"
)

type memRepo struct {
	assets       map[uuid.UUID]Asset
	observations map[uuid.UUID]Observation
	hypotheses   map[uuid.UUID]Hypothesis
	coverage     map[uuid.UUID]CoverageEntry
	next         int
}

func newMemRepo() *memRepo {
	return &memRepo{
		assets:       map[uuid.UUID]Asset{},
		observations: map[uuid.UUID]Observation{},
		hypotheses:   map[uuid.UUID]Hypothesis{},
		coverage:     map[uuid.UUID]CoverageEntry{},
	}
}

// newID returns a unique deterministic id per call so multi-entity tests do not
// silently overwrite each other.
func (m *memRepo) newID() uuid.UUID {
	m.next++
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("assessment-"+strconv.Itoa(m.next)))
}

// testID is a fixed run id used by unit tests.
var testID = uuid.MustParse("22222222-2222-2222-2222-222222222222")

func (m *memRepo) CreateAsset(ctx context.Context, p CreateAssetParams) (Asset, error) {
	a := Asset{ID: m.newID(), RunID: p.RunID, Kind: p.Kind, Name: p.Name, Properties: p.Properties}
	m.assets[a.ID] = a
	return a, nil
}

func (m *memRepo) GetAsset(ctx context.Context, id uuid.UUID) (Asset, error) {
	a, ok := m.assets[id]
	if !ok {
		return Asset{}, &ErrAssetNotFound{ID: id}
	}
	return a, nil
}

func (m *memRepo) ListAssetsByRun(ctx context.Context, runID uuid.UUID) ([]Asset, error) {
	var out []Asset
	for _, a := range m.assets {
		if a.RunID == runID {
			out = append(out, a)
		}
	}
	return out, nil
}

func (m *memRepo) CreateObservation(ctx context.Context, p CreateObservationParams) (Observation, error) {
	o := Observation{ID: m.newID(), RunID: p.RunID, AssetID: p.AssetID, Summary: p.Summary, Detail: p.Detail, EvidenceID: p.EvidenceID}
	m.observations[o.ID] = o
	return o, nil
}

func (m *memRepo) GetObservation(ctx context.Context, id uuid.UUID) (Observation, error) {
	o, ok := m.observations[id]
	if !ok {
		return Observation{}, &ErrObservationNotFound{ID: id}
	}
	return o, nil
}

func (m *memRepo) ListObservationsByRun(ctx context.Context, runID uuid.UUID) ([]Observation, error) {
	var out []Observation
	for _, o := range m.observations {
		if o.RunID == runID {
			out = append(out, o)
		}
	}
	return out, nil
}

func (m *memRepo) CreateHypothesis(ctx context.Context, p CreateHypothesisParams) (Hypothesis, error) {
	h := Hypothesis{ID: m.newID(), RunID: p.RunID, Title: p.Title, Description: p.Description, Status: HypothesisOpen}
	m.hypotheses[h.ID] = h
	return h, nil
}

func (m *memRepo) GetHypothesis(ctx context.Context, id uuid.UUID) (Hypothesis, error) {
	h, ok := m.hypotheses[id]
	if !ok {
		return Hypothesis{}, &ErrHypothesisNotFound{ID: id}
	}
	return h, nil
}

func (m *memRepo) UpdateHypothesisStatus(ctx context.Context, id uuid.UUID, status HypothesisStatus) (Hypothesis, error) {
	h, ok := m.hypotheses[id]
	if !ok {
		return Hypothesis{}, &ErrHypothesisNotFound{ID: id}
	}
	h.Status = status
	m.hypotheses[id] = h
	return h, nil
}

func (m *memRepo) CreateCoverage(ctx context.Context, p CreateCoverageParams) (CoverageEntry, error) {
	c := CoverageEntry{ID: m.newID(), RunID: p.RunID, HypothesisID: p.HypothesisID, AssetID: p.AssetID, Method: p.Method, Outcome: p.Outcome, EvidenceID: p.EvidenceID, Reason: p.Reason}
	m.coverage[c.ID] = c
	return c, nil
}

func (m *memRepo) GetCoverage(ctx context.Context, id uuid.UUID) (CoverageEntry, error) {
	c, ok := m.coverage[id]
	if !ok {
		return CoverageEntry{}, &ErrCoverageNotFound{ID: id}
	}
	return c, nil
}

func (m *memRepo) ListCoverageByRun(ctx context.Context, runID uuid.UUID) ([]CoverageEntry, error) {
	var out []CoverageEntry
	for _, c := range m.coverage {
		if c.RunID == runID {
			out = append(out, c)
		}
	}
	return out, nil
}

func TestRecordAssetValidatesAndRoundTrips(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	if _, err := svc.RecordAsset(ctx, CreateAssetParams{RunID: testID, Kind: "", Name: "a"}); err == nil {
		t.Error("expected empty-kind error")
	}
	if _, err := svc.RecordAsset(ctx, CreateAssetParams{RunID: testID, Kind: "host", Name: ""}); err == nil {
		t.Error("expected empty-name error")
	}
	a, err := svc.RecordAsset(ctx, CreateAssetParams{RunID: testID, Kind: "host", Name: "db-1", Properties: map[string]interface{}{"os": "linux"}})
	if err != nil {
		t.Fatal(err)
	}
	if a.Properties["os"] != "linux" {
		t.Errorf("properties = %v", a.Properties)
	}
	got, err := svc.repo.GetAsset(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "db-1" {
		t.Errorf("name = %q", got.Name)
	}
}

func TestObservationLinkedToAsset(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	aid := testID
	o, err := svc.RecordObservation(ctx, CreateObservationParams{RunID: testID, AssetID: &aid, Summary: "banner observed"})
	if err != nil {
		t.Fatal(err)
	}
	if o.AssetID == nil || *o.AssetID != aid {
		t.Errorf("asset link = %v", o.AssetID)
	}
}

func TestHypothesisStatusUpdate(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	if _, err := svc.RecordHypothesis(ctx, CreateHypothesisParams{RunID: testID, Title: "  "}); err == nil {
		t.Error("expected empty-title error")
	}
	h, err := svc.RecordHypothesis(ctx, CreateHypothesisParams{RunID: testID, Title: "test title"})
	if err != nil {
		t.Fatal(err)
	}
	if h.Status != HypothesisOpen {
		t.Errorf("status = %q, want open", h.Status)
	}
	if _, err := svc.SetHypothesisStatus(ctx, h.ID, HypothesisStatus("bogus")); err == nil {
		t.Error("expected invalid status error")
	}
	updated, err := svc.SetHypothesisStatus(ctx, h.ID, HypothesisConfirmed)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != HypothesisConfirmed {
		t.Errorf("status = %q", updated.Status)
	}
}

func TestCoverageInvalidOutcomeRejected(t *testing.T) {
	svc := NewService(newMemRepo())
	ctx := context.Background()
	if _, err := svc.RecordCoverage(ctx, CreateCoverageParams{RunID: testID, Method: "nmap", Outcome: "nope"}); err == nil {
		t.Error("expected invalid-outcome error")
	}
	if _, err := svc.RecordCoverage(ctx, CreateCoverageParams{RunID: testID, Method: "", Outcome: OutcomeAttempted}); err == nil {
		t.Error("expected empty-method error")
	}
	// verified_negative without evidence must be rejected.
	if _, err := svc.RecordCoverage(ctx, CreateCoverageParams{RunID: testID, Method: "nmap -sV", Outcome: OutcomeVerifiedNegative}); err == nil {
		t.Error("expected verified_negative-without-evidence error")
	}
	ev := testID
	c, err := svc.RecordCoverage(ctx, CreateCoverageParams{RunID: testID, Method: "nmap -sV", Outcome: OutcomeVerifiedNegative, EvidenceID: &ev})
	if err != nil {
		t.Fatal(err)
	}
	if c.Outcome != OutcomeVerifiedNegative {
		t.Errorf("outcome = %q", c.Outcome)
	}
}
