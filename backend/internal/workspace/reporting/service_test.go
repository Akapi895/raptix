package reporting

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

const testTemplateHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

type snapshotter struct {
	calls int
	data  []byte
}

func (s *snapshotter) SnapshotReportInputs(ctx context.Context, runID uuid.UUID) (json.RawMessage, error) {
	s.calls++
	return append([]byte(nil), s.data...), nil
}

type outputEvidence struct {
	valid map[uuid.UUID]bool
	calls int
}

func (e *outputEvidence) ValidateReportOutput(ctx context.Context, runID, artifactID uuid.UUID) error {
	e.calls++
	if !e.valid[artifactID] {
		return errors.New("artifact is unavailable")
	}
	return nil
}

func TestRequestIsIdempotentAndCapturesOneImmutableSnapshot(t *testing.T) {
	inputs := &snapshotter{data: []byte(`{"findings":[{"revision":2}],"evidence":[]}`)}
	svc := NewService(newMemRepo(), inputs, &outputEvidence{})
	p := RequestParams{RunID: uuid.New(), Template: Template{ID: "default", Version: "1", Hash: testTemplateHash}}

	first, err := svc.Request(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	inputs.data[0] = '['
	second, err := svc.Request(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || inputs.calls != 1 || string(second.Snapshot) != `{"evidence":[],"findings":[{"revision":2}]}` {
		t.Fatalf("first=%+v second=%+v snapshot calls=%d", first, second, inputs.calls)
	}

	_, err = svc.Request(context.Background(), RequestParams{RunID: p.RunID, Template: Template{ID: "other", Version: "1", Hash: testTemplateHash}})
	var exists *ErrReportAlreadyRequested
	if !errors.As(err, &exists) {
		t.Fatalf("err=%v, want ErrReportAlreadyRequested", err)
	}
}

func TestCompleteValidatesEvidenceAndReplayReturnsSingleOutput(t *testing.T) {
	ctx := context.Background()
	artifactID := uuid.New()
	evidence := &outputEvidence{valid: map[uuid.UUID]bool{artifactID: true}}
	svc := NewService(newMemRepo(), &snapshotter{data: []byte(`{"findings":[]}`)}, evidence)
	report, err := svc.Request(ctx, RequestParams{RunID: uuid.New(), Template: Template{ID: "default", Version: "1", Hash: testTemplateHash}})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := svc.Claim(ctx, ClaimParams{ID: report.ID, ExpectedVersion: report.Version, Worker: "worker-a", LeaseDuration: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	completed, err := svc.Complete(ctx, CompleteParams{ID: report.ID, ExpectedVersion: claimed.Version, Worker: "worker-a", OutputArtifactID: artifactID})
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != StatusCompleted || completed.OutputArtifactID == nil || *completed.OutputArtifactID != artifactID {
		t.Fatalf("completed=%+v", completed)
	}
	replayed, err := svc.Complete(ctx, CompleteParams{ID: report.ID, ExpectedVersion: claimed.Version, Worker: "worker-a", OutputArtifactID: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	if replayed.OutputArtifactID == nil || *replayed.OutputArtifactID != artifactID || evidence.calls != 1 {
		t.Fatalf("replayed=%+v evidence calls=%d", replayed, evidence.calls)
	}
}
