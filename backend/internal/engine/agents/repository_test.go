package agents

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAttemptNumberingAndFinish(t *testing.T) {
	repo := newMemRepo()
	ctx := context.Background()
	agentID := uuid.New()

	first, err := repo.CreateAttempt(ctx, CreateAttemptParams{AgentID: agentID})
	if err != nil {
		t.Fatal(err)
	}
	if first.AttemptNo != 1 || first.Status != AttemptRunning {
		t.Fatalf("first = %+v", first)
	}
	second, err := repo.CreateAttempt(ctx, CreateAttemptParams{AgentID: agentID})
	if err != nil {
		t.Fatal(err)
	}
	if second.AttemptNo != 2 {
		t.Fatalf("second attempt_no = %d, want 2", second.AttemptNo)
	}

	finished, err := repo.FinishAttempt(ctx, FinishAttemptParams{ID: first.ID, Status: AttemptSucceeded, FinishedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	if finished.Status != AttemptSucceeded || finished.FinishedAt == nil {
		t.Fatalf("finished = %+v", finished)
	}
	if _, err := repo.GetAttempt(ctx, uuid.New()); err == nil {
		t.Error("expected not-found for unknown attempt")
	} else {
		var nf *ErrAttemptNotFound
		if !errors.As(err, &nf) {
			t.Errorf("err = %v, want ErrAttemptNotFound", err)
		}
	}
}

func TestAppendAndListMessages(t *testing.T) {
	repo := newMemRepo()
	ctx := context.Background()
	a, err := repo.CreateAttempt(ctx, CreateAttemptParams{AgentID: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	invID := uuid.New()
	if _, err := repo.AppendMessage(ctx, AppendMessageParams{AttemptID: a.ID, Seq: 0, Role: RoleSystem, Content: "sys"}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AppendMessage(ctx, AppendMessageParams{AttemptID: a.ID, Seq: 1, Role: RoleTool, Content: "result", InvocationID: &invID}); err != nil {
		t.Fatal(err)
	}
	msgs, err := repo.ListMessages(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 2 || msgs[1].Role != RoleTool || msgs[1].InvocationID == nil || *msgs[1].InvocationID != invID {
		t.Fatalf("messages = %+v", msgs)
	}
}

func TestSnapshotDedupByContentHash(t *testing.T) {
	repo := newMemRepo()
	ctx := context.Background()
	agentID := uuid.New()
	p := CreateSnapshotParams{
		AgentID: agentID, ProfileRef: "recon@1.0.0", ContentHash: "sha256:abc",
		Requested: json.RawMessage(`["http_probe"]`), Granted: json.RawMessage(`{"http_probe":true}`),
	}
	first, err := repo.CreateSnapshot(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.CreateSnapshot(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Errorf("snapshot dedup failed: %s != %s", first.ID, second.ID)
	}
	got, err := repo.GetSnapshotByAgent(ctx, agentID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ContentHash != "sha256:abc" {
		t.Errorf("snapshot = %+v", got)
	}
}
