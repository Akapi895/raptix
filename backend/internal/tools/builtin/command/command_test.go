package command

import (
	"context"
	"encoding/json"
	"io"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/Akapi895/raptix/backend/internal/execution/artifact"
	"github.com/Akapi895/raptix/backend/internal/execution/sandbox"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
)

type fakeRunner struct {
	res  sandbox.Result
	err  error
	spec sandbox.Spec
	call int
}

func (f *fakeRunner) Run(ctx context.Context, spec sandbox.Spec, stdin io.Reader) (sandbox.Result, error) {
	f.call++
	f.spec = spec
	return f.res, f.err
}

type fakeEvidence struct {
	body string
	got  evidence.RegisterParams
}

func (f *fakeEvidence) Register(ctx context.Context, p evidence.RegisterParams, r io.Reader) (evidence.Artifact, error) {
	b, _ := io.ReadAll(r)
	f.body = string(b)
	f.got = p
	return evidence.Artifact{ID: uuid.New()}, nil
}

func newCommand(runner sandbox.Runner, ev *fakeEvidence) *Command {
	return New("nmap", Options{
		Base:         "nmap",
		BaseArgs:     []string{"-oX", "-"},
		AllowedFlags: []string{"-sV", "-Pn", "-T4"},
		MaxOutput:    1 << 20,
	}, runner, artifact.NewWriter(ev))
}

func TestCommandSuccessRecordsRawEvidence(t *testing.T) {
	fr := &fakeRunner{res: sandbox.Result{ExitCode: 0, Stdout: []byte("PORT 80 open\n"), Duration: 12 * time.Millisecond}}
	fe := &fakeEvidence{}
	res, err := newCommand(fr, fe).Invoke(context.Background(), json.RawMessage(`{"target":"10.0.0.1","ports":"80,443","flags":["-sV"]}`))
	if err != nil {
		t.Fatal(err)
	}
	if res.Execution != output.ExecutionSuccess {
		t.Errorf("execution = %s, want success", res.Execution)
	}
	if res.RawRef == "" {
		t.Error("expected raw ref")
	}
	if res.ExitCode == nil || *res.ExitCode != 0 {
		t.Errorf("exit code = %v, want 0", res.ExitCode)
	}
	if fe.body != "PORT 80 open\n" {
		t.Errorf("evidence body = %q", fe.body)
	}
	if fe.got.Kind != evidence.KindRaw {
		t.Errorf("evidence kind = %s, want raw", fe.got.Kind)
	}
	// The base args, allowed flag, ports and target must all be present, with
	// the target last so it cannot be mistaken for a flag.
	wantArgs := []string{"-oX", "-", "-sV", "-p", "80,443", "10.0.0.1"}
	if got := fr.spec.Args; !equal(got, wantArgs) {
		t.Errorf("args = %v, want %v", got, wantArgs)
	}
}

func TestCommandNonZeroExitStillRecordsEvidence(t *testing.T) {
	fr := &fakeRunner{res: sandbox.Result{ExitCode: 2, Stdout: []byte("partial"), Stderr: []byte("boom")}}
	fe := &fakeEvidence{}
	res, err := newCommand(fr, fe).Invoke(context.Background(), json.RawMessage(`{"target":"10.0.0.1"}`))
	if err != nil {
		t.Fatal(err)
	}
	if res.Execution != output.ExecutionFailed {
		t.Errorf("execution = %s, want failed", res.Execution)
	}
	if res.RawRef == "" {
		t.Error("failed run must still record raw evidence")
	}
	if res.ExitCode == nil || *res.ExitCode != 2 {
		t.Errorf("exit code = %v, want 2", res.ExitCode)
	}
}

func TestCommandTimeout(t *testing.T) {
	fr := &fakeRunner{res: sandbox.Result{TimedOut: true, Stdout: []byte("partial")}}
	fe := &fakeEvidence{}
	res, err := newCommand(fr, fe).Invoke(context.Background(), json.RawMessage(`{"target":"10.0.0.1"}`))
	if err != nil {
		t.Fatal(err)
	}
	if res.Execution != output.ExecutionTimedOut {
		t.Errorf("execution = %s, want timed_out", res.Execution)
	}
}

func TestCommandRejectsDisallowedFlag(t *testing.T) {
	fr := &fakeRunner{}
	fe := &fakeEvidence{}
	res, err := newCommand(fr, fe).Invoke(context.Background(), json.RawMessage(`{"target":"10.0.0.1","flags":["--script=evil"]}`))
	if err != nil {
		t.Fatal(err)
	}
	if res.Execution != output.ExecutionFailed {
		t.Errorf("execution = %s, want failed", res.Execution)
	}
	if fr.call != 0 {
		t.Error("runner must not run when args are rejected")
	}
}

func TestCommandRejectsBadTargetAndPorts(t *testing.T) {
	for _, raw := range []string{
		`{"target":"-sV"}`,
		`{"target":"a b"}`,
		`{"target":""}`,
		`{"target":"10.0.0.1","ports":"80;rm"}`,
	} {
		fr := &fakeRunner{}
		res, err := newCommand(fr, &fakeEvidence{}).Invoke(context.Background(), json.RawMessage(raw))
		if err != nil {
			t.Fatal(err)
		}
		if res.Execution != output.ExecutionFailed {
			t.Errorf("%s: execution = %s, want failed", raw, res.Execution)
		}
		if fr.call != 0 {
			t.Errorf("%s: runner must not run", raw)
		}
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
