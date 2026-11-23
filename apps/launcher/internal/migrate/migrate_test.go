package migrate

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Akapi895/raptix/apps/launcher/internal/config"
)

func newTestCtx(t *testing.T, env map[string]string, tty bool) *Ctx {
	t.Helper()
	home := t.TempDir()
	envPath := filepath.Join(home, ".env")
	// A minimal .env so file-writing steps have something to edit.
	_ = os.WriteFile(envPath, []byte("FOO=bar\n"), 0o600)
	c := &Ctx{
		EnvPath: envPath,
		Env:     env,
		Home:    home,
		IsTTY:   tty,
		ackPath: filepath.Join(home, ackFileName),
	}
	c.loadAcks()
	return c
}

func TestRun_NonInteractiveStepAlwaysRuns(t *testing.T) {
	c := newTestCtx(t, map[string]string{}, false)
	ran := 0
	Run(c, []Step{{
		ID:          "noninteractive",
		Interactive: false,
		Apply:       func(_ *Ctx) (string, error) { ran++; return "", nil },
	}})
	if ran != 1 {
		t.Fatalf("non-interactive step ran %d times, want 1", ran)
	}
	// Non-interactive steps are never ack-recorded (they re-run each start).
	if c.Acked("noninteractive") {
		t.Error("non-interactive step should not be ack-recorded")
	}
}

func TestRun_InteractiveDeferredOnNonTTY(t *testing.T) {
	c := newTestCtx(t, map[string]string{}, false)
	ran := 0
	step := Step{
		ID:          "consent",
		Interactive: true,
		Apply:       func(_ *Ctx) (string, error) { ran++; return "", nil },
	}
	Run(c, []Step{step})
	if ran != 0 {
		t.Fatalf("interactive step ran on non-TTY (%d), want deferred", ran)
	}
	if c.Acked("consent") {
		t.Error("deferred step must not be acked")
	}
}

func TestRun_InteractiveRunsOnceThenAcked(t *testing.T) {
	c := newTestCtx(t, map[string]string{}, true)
	ran := 0
	step := Step{
		ID:          "consent",
		Interactive: true,
		Apply:       func(_ *Ctx) (string, error) { ran++; return "ok", nil },
	}
	Run(c, []Step{step})
	Run(c, []Step{step}) // second start: already acked
	if ran != 1 {
		t.Fatalf("interactive step ran %d times, want exactly 1", ran)
	}
	if !c.Acked("consent") {
		t.Error("interactive step should be acked after running")
	}
	// Ack persists across a fresh Ctx (simulating a new process).
	c2 := &Ctx{ackPath: c.ackPath}
	c2.loadAcks()
	if !c2.Acked("consent") {
		t.Error("ack did not persist to disk")
	}
}

func TestEnvBackfillStepReflectsIntoEnv(t *testing.T) {
	c := newTestCtx(t, map[string]string{}, false)
	if _, err := applyEnvBackfill(c); err != nil {
		t.Fatalf("applyEnvBackfill: %v", err)
	}
	// A template default missing from the seed should now be both on disk
	// and reflected into the in-memory env map.
	if c.Env["RAPTIX_LANGUAGE"] == "" {
		t.Error("backfilled key not reflected into in-memory env")
	}
}

// TestRunAll_ExistingUserUpgrade covers config backfill on upgrade.
func TestRunAll_ExistingUserUpgrade(t *testing.T) {
	home := t.TempDir()
	t.Setenv("RAPTIX_HOME", home)
	envPath := filepath.Join(home, ".env")
	if err := os.WriteFile(envPath, []byte("ANTHROPIC_API_KEY=sk-real\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	restoreTTY := isInteractive
	isInteractive = func() bool { return true }
	defer func() { isInteractive = restoreTTY }()

	env, err := config.LoadEnv(envPath)
	if err != nil {
		t.Fatal(err)
	}
	RunAll(env)

	got, err := config.LoadEnv(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if got["RAPTIX_LANGUAGE"] == "" {
		t.Error("template default not backfilled for existing user")
	}
	if got["ANTHROPIC_API_KEY"] != "sk-real" {
		t.Errorf("real key not preserved: %q", got["ANTHROPIC_API_KEY"])
	}
}
