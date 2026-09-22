package local

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Akapi895/raptix/backend/internal/execution/sandbox"
)

// The test binary re-executes itself as a helper process so the runner can be
// exercised against a real executable without depending on external tools.
const helperEnv = "RAP_SANDBOX_HELPER"

func TestMain(m *testing.M) {
	if os.Getenv(helperEnv) == "1" {
		helperMain(os.Args[1:])
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func helperMain(args []string) {
	if len(args) == 0 {
		return
	}
	switch args[0] {
	case "echo":
		fmt.Println(strings.Join(args[1:], " "))
	case "fail":
		fmt.Fprintln(os.Stderr, "boom")
		os.Exit(3)
	case "sleep":
		time.Sleep(5 * time.Second)
	case "spam":
		chunk := strings.Repeat("x", 4096)
		for i := 0; i < 1000; i++ {
			fmt.Print(chunk)
		}
	}
}

func helperSpec(args ...string) sandbox.Spec {
	return sandbox.Spec{Command: os.Args[0], Args: args, Env: []string{helperEnv + "=1"}}
}

func TestLocalRunnerCapturesStdoutAndExitZero(t *testing.T) {
	r := New(0, nil)
	res, err := r.Run(context.Background(), helperSpec("echo", "hello", "world"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.ExitCode != 0 {
		t.Errorf("exit = %d, want 0", res.ExitCode)
	}
	if got := strings.TrimSpace(string(res.Stdout)); got != "hello world" {
		t.Errorf("stdout = %q, want %q", got, "hello world")
	}
	if res.TimedOut {
		t.Error("did not expect timeout")
	}
}

func TestLocalRunnerNonZeroExitIsNotAnError(t *testing.T) {
	r := New(0, nil)
	res, err := r.Run(context.Background(), helperSpec("fail"), nil)
	if err != nil {
		t.Fatalf("non-zero exit must not surface as error: %v", err)
	}
	if res.ExitCode != 3 {
		t.Errorf("exit = %d, want 3", res.ExitCode)
	}
	if !strings.Contains(string(res.Stderr), "boom") {
		t.Errorf("stderr = %q, want to contain boom", res.Stderr)
	}
}

func TestLocalRunnerTimeout(t *testing.T) {
	r := New(0, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	res, err := r.Run(ctx, helperSpec("sleep"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !res.TimedOut {
		t.Error("expected TimedOut on context deadline")
	}
}

func TestLocalRunnerCapsOutput(t *testing.T) {
	r := New(0, nil)
	spec := helperSpec("spam")
	spec.MaxOutput = 1024
	res, err := r.Run(context.Background(), spec, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Truncated {
		t.Error("expected Truncated when output exceeds cap")
	}
	if len(res.Stdout) > 1024 {
		t.Errorf("stdout len = %d, want <= 1024", len(res.Stdout))
	}
}

func TestLocalRunnerRejectsEmptyCommand(t *testing.T) {
	r := New(0, nil)
	if _, err := r.Run(context.Background(), sandbox.Spec{}, nil); err == nil {
		t.Error("expected error for empty command")
	}
}
