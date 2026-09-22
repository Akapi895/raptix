package app

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
	"github.com/google/uuid"
)

// TestPhase3MilestoneWiresCompositionRoot verifies app.New attaches all seven
// Phase 3 services to the shared pool. The pool is lazy, so this runs without a
// reachable database; it proves the composition-root wiring is complete.
func TestPhase3MilestoneWiresCompositionRoot(t *testing.T) {
	root := t.TempDir()
	cfg := defaults()
	cfg.Artifact.Root = filepath.Join(root, "artifacts")
	cfg.Content.Root = filepath.Join(root, "content")
	cfg.Database.URL = "postgres://raptix:raptix@127.0.0.1:1/raptix?sslmode=disable"

	a, err := New(cfg, NewLogger("error"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(a.closeStorage)

	if a.services == nil {
		t.Fatal("services were not wired")
	}
	if a.services.Projects == nil {
		t.Error("projects service not wired")
	}
	if a.services.Governance == nil {
		t.Error("governance service not wired")
	}
	if a.services.Audit == nil {
		t.Error("audit service not wired")
	}
	if a.services.Runs == nil {
		t.Error("runs service not wired")
	}
	if a.services.Evidence == nil {
		t.Error("evidence service not wired")
	}
	if a.services.Assessment == nil {
		t.Error("assessment service not wired")
	}
	if a.services.Findings == nil {
		t.Error("findings service not wired")
	}

	// The services are backed by the (lazy) pool, so a DB query returns a
	// connectivity error rather than a nil-pointer panic. This confirms the
	// repos are constructed and wired to the real store, not nil stubs.
	if _, err := a.services.Projects.ListProjects(context.Background()); err == nil {
		t.Fatal("expected connectivity error from unstarted pool, got nil (repo not wired to store)")
	}

	// Cross-module adapters must actually be wired, not nil: a nil blob store or
	// nil scope authority would otherwise only surface as a "not wired" error
	// here, while a DB connectivity error proves the adapter is present.
	ctx := context.Background()
	if _, err := a.services.Evidence.Register(ctx, evidence.RegisterParams{
		Kind: evidence.KindRaw,
	}, strings.NewReader("x")); err == nil {
		t.Fatal("expected a database error from the unstarted pool")
	} else if strings.Contains(err.Error(), "blob store is not wired") {
		t.Fatal("evidence blob store was not wired into the service")
	}
	if _, err := a.services.Governance.CheckActiveGrant(ctx, "alice", uuid.New(), "run.start"); err == nil {
		t.Fatal("expected a database error from the unstarted pool")
	} else if strings.Contains(err.Error(), "scope authority is not wired") {
		t.Fatal("governance scope authority was not wired into the service")
	}
}
