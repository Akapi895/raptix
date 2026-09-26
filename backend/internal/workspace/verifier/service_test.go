package verifier

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
	"github.com/Akapi895/raptix/backend/internal/workspace/findings"
)

type fakeExec struct {
	result *output.Result
	err    error
	calls  []invocation.InvokeParams
	after  func()
}

func (f *fakeExec) InvokeCapability(ctx context.Context, p invocation.InvokeParams) (invocation.Invocation, *output.Result, error) {
	f.calls = append(f.calls, p)
	if f.after != nil {
		f.after()
	}
	return invocation.Invocation{ID: uuid.New()}, f.result, f.err
}

type fakeReader struct {
	revision findings.FindingRevision
	err      error
}

func (f *fakeReader) GetCurrentRevision(ctx context.Context, id uuid.UUID) (findings.FindingRevision, error) {
	return f.revision, f.err
}

type fakeVerdict struct {
	recorded []findings.InsertVerdictParams
}

func (f *fakeVerdict) RecordVerdict(ctx context.Context, p findings.InsertVerdictParams) (findings.FindingVerdict, error) {
	f.recorded = append(f.recorded, p)
	return findings.FindingVerdict{FindingID: p.FindingID, Verdict: p.Verdict, Reason: p.Reason, ProducedBy: p.ProducedBy}, nil
}

func harness(result *output.Result) (*Service, *fakeExec, *fakeVerdict, VerifyParams) {
	exec := &fakeExec{result: result}
	reader := &fakeReader{revision: findings.FindingRevision{FindingID: uuid.New(), RevisionNo: 4, Title: "exposed"}}
	vw := &fakeVerdict{}
	svc := NewService(exec, reader, vw, "verifier")
	p := VerifyParams{
		FindingID: reader.revision.FindingID, RunID: uuid.New(), ScopeID: uuid.New(), Actor: "alice",
		Checks: []Check{{Capability: "http_probe", Args: json.RawMessage(`{"url":"http://lab"}`)}},
	}
	return svc, exec, vw, p
}

func TestVerifyConfirmedWhenReCheckSucceeds(t *testing.T) {
	svc, exec, vw, p := harness(output.Success(uuid.NewString(), "", ""))
	res, err := svc.Verify(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Verdict != findings.VerdictConfirmed {
		t.Fatalf("verdict = %s, want confirmed", res.Verdict)
	}
	if len(res.EvidenceIDs) != 1 {
		t.Errorf("evidence = %v", res.EvidenceIDs)
	}
	if len(exec.calls) != 1 || exec.calls[0].IdempotencyKey != "verify:"+p.FindingID.String()+":4:0" {
		t.Errorf("exec calls = %+v", exec.calls)
	}
	if len(vw.recorded) != 1 || vw.recorded[0].FindingID != p.FindingID {
		t.Errorf("verdicts = %+v", vw.recorded)
	}
	if vw.recorded[0].RevisionNo != 4 || res.RevisionNo != 4 {
		t.Errorf("revision binding = %+v / %+v", vw.recorded[0], res)
	}
}

func TestVerifyInconclusiveOnFailure(t *testing.T) {
	svc, _, _, p := harness(output.Error("", errors.New("connection refused")))
	res, err := svc.Verify(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Verdict != findings.VerdictInconclusive {
		t.Errorf("verdict = %s, want inconclusive (failure is not refutation)", res.Verdict)
	}
}

func TestVerifyInconclusiveOnDenied(t *testing.T) {
	svc, _, _, p := harness(output.Denied("no grant"))
	res, err := svc.Verify(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Verdict != findings.VerdictInconclusive {
		t.Errorf("verdict = %s, want inconclusive on denial", res.Verdict)
	}
}

func TestVerifyRefutedWhenCriterionRefutes(t *testing.T) {
	svc, _, _, p := harness(output.Error("", errors.New("gone")))
	p.Checks[0].RefuteOn = output.ExecutionFailed
	res, err := svc.Verify(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Verdict != findings.VerdictRefuted {
		t.Errorf("verdict = %s, want refuted", res.Verdict)
	}
}

func TestVerifyNoChecksIsInconclusive(t *testing.T) {
	svc, exec, vw, p := harness(output.Success(uuid.NewString(), "", ""))
	p.Checks = nil
	res, err := svc.Verify(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	if res.Verdict != findings.VerdictInconclusive {
		t.Errorf("verdict = %s, want inconclusive", res.Verdict)
	}
	if len(exec.calls) != 0 {
		t.Error("no checks should dispatch a tool")
	}
	if len(vw.recorded) != 1 {
		t.Error("an inconclusive verdict must still be recorded")
	}
}

func TestVerifyLateVerdictUsesRevisionReadBeforeChecks(t *testing.T) {
	reader := &fakeReader{revision: findings.FindingRevision{FindingID: uuid.New(), RevisionNo: 2}}
	exec := &fakeExec{result: output.Success("", "", ""), after: func() {
		reader.revision.RevisionNo = 3
	}}
	writer := &fakeVerdict{}
	svc := NewService(exec, reader, writer, "verifier")
	_, err := svc.Verify(context.Background(), VerifyParams{
		FindingID: reader.revision.FindingID, RunID: uuid.New(), ScopeID: uuid.New(), Actor: "alice",
		Checks: []Check{{Capability: "http_probe"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(writer.recorded) != 1 || writer.recorded[0].RevisionNo != 2 {
		t.Fatalf("late verdict bound to %+v, want revision 2", writer.recorded)
	}
}
