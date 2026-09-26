package reporting

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRepositoryClaimRequiresCurrentVersionAndAllowsExpiredLeaseTakeover(t *testing.T) {
	ctx := context.Background()
	repo := newMemRepo()
	created, err := repo.CreateOrGet(ctx, CreateParams{RunID: uuid.New(), Template: Template{ID: "default", Version: "1", Hash: testTemplateHash}, Snapshot: []byte(`{}`)})
	if err != nil || !created.Created {
		t.Fatalf("create=%+v err=%v", created, err)
	}
	claimed, err := repo.Claim(ctx, ClaimParams{ID: created.Report.ID, ExpectedVersion: 1, Worker: "one", LeaseDuration: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Claim(ctx, ClaimParams{ID: claimed.ID, ExpectedVersion: 1, Worker: "two", LeaseDuration: time.Minute}); err == nil {
		t.Fatal("expected stale optimistic version to fail")
	}

	repo.mu.Lock()
	expired := time.Now().Add(-time.Second)
	report := repo.byID[claimed.ID]
	report.LeaseExpiresAt = &expired
	repo.byID[claimed.ID] = report
	repo.mu.Unlock()
	taken, err := repo.Claim(ctx, ClaimParams{ID: claimed.ID, ExpectedVersion: claimed.Version, Worker: "two", LeaseDuration: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	if taken.LeaseOwner != "two" || taken.Version != claimed.Version+1 || taken.Status != StatusRendering {
		t.Fatalf("taken=%+v", taken)
	}
}

func TestRepositoryCompleteCASLinksAtMostOneArtifact(t *testing.T) {
	ctx := context.Background()
	repo := newMemRepo()
	created, _ := repo.CreateOrGet(ctx, CreateParams{RunID: uuid.New(), Template: Template{ID: "default", Version: "1", Hash: testTemplateHash}, Snapshot: []byte(`{}`)})
	claimed, err := repo.Claim(ctx, ClaimParams{ID: created.Report.ID, ExpectedVersion: created.Report.Version, Worker: "worker", LeaseDuration: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	artifacts := []uuid.UUID{uuid.New(), uuid.New()}
	results := make(chan Report, len(artifacts))
	errs := make(chan error, len(artifacts))
	var wg sync.WaitGroup
	for _, artifactID := range artifacts {
		wg.Add(1)
		go func(artifactID uuid.UUID) {
			defer wg.Done()
			report, err := repo.Complete(ctx, CompleteParams{ID: claimed.ID, ExpectedVersion: claimed.Version, Worker: "worker", OutputArtifactID: artifactID})
			results <- report
			errs <- err
		}(artifactID)
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var linked uuid.UUID
	for report := range results {
		if report.Status != StatusCompleted || report.OutputArtifactID == nil {
			t.Fatalf("report=%+v", report)
		}
		if linked != uuid.Nil && linked != *report.OutputArtifactID {
			t.Fatalf("conflicting linked artifacts: %s and %s", linked, *report.OutputArtifactID)
		}
		linked = *report.OutputArtifactID
	}
}

func TestRepositoryCancelAndFailureAreLeaseAndVersionBound(t *testing.T) {
	ctx := context.Background()
	repo := newMemRepo()
	created, _ := repo.CreateOrGet(ctx, CreateParams{RunID: uuid.New(), Template: Template{ID: "default", Version: "1", Hash: testTemplateHash}, Snapshot: []byte(`{}`)})
	cancelled, err := repo.Cancel(ctx, CancelParams{ID: created.Report.ID, ExpectedVersion: created.Report.Version})
	if err != nil || cancelled.Status != StatusCancelled {
		t.Fatalf("cancelled=%+v err=%v", cancelled, err)
	}
	if _, err := repo.Cancel(ctx, CancelParams{ID: cancelled.ID, ExpectedVersion: cancelled.Version}); err == nil {
		t.Fatal("expected terminal report cancellation to fail")
	} else {
		var lock *ErrOptimisticLock
		if !errors.As(err, &lock) {
			t.Fatalf("err=%v, want ErrOptimisticLock", err)
		}
	}

	failedRequest, _ := repo.CreateOrGet(ctx, CreateParams{RunID: uuid.New(), Template: Template{ID: "default", Version: "1", Hash: testTemplateHash}, Snapshot: []byte(`{}`)})
	claimed, err := repo.Claim(ctx, ClaimParams{ID: failedRequest.Report.ID, ExpectedVersion: 1, Worker: "worker-a", LeaseDuration: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Fail(ctx, FailParams{ID: claimed.ID, ExpectedVersion: claimed.Version, Worker: "worker-b", Code: "render_error"}); err == nil {
		t.Fatal("expected a non-owner failure to fail")
	}
	failed, err := repo.Fail(ctx, FailParams{ID: claimed.ID, ExpectedVersion: claimed.Version, Worker: "worker-a", Code: "render_error", Message: "template data mismatch"})
	if err != nil || failed.Status != StatusFailed || failed.FailureCode != "render_error" || failed.LeaseExpiresAt != nil {
		t.Fatalf("failed=%+v err=%v", failed, err)
	}
}
