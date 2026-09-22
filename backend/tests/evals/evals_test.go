// Package evals drives the declarative capability cases under evals/cases
// through the real capability implementation and compares the observed result
// against the recorded baseline. It is the minimal Phase 4 eval runner: no
// database or sandbox is required because the first capability is a builtin.
//
// The agent-level evaluation harness (Phase 5) will build on this shape: a case
// names a capability and an input, and the runner records an immutable result
// that later phases diff against the baseline.
package evals

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"gopkg.in/yaml.v3"

	"github.com/Akapi895/raptix/backend/internal/tools/builtin"
	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
)

const labPlaceholder = "${LAB_HTTP_URL}"

type evalCase struct {
	APIVersion  string `yaml:"apiVersion"`
	Kind        string `yaml:"kind"`
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	Capability  string `yaml:"capability"`
	Input       struct {
		URL string `yaml:"url"`
	} `yaml:"input"`
	Expect struct {
		Execution      string `yaml:"execution"`
		HasRawEvidence bool   `yaml:"has_raw_evidence"`
	} `yaml:"expect"`
}

type baseline struct {
	Name           string `json:"name"`
	Capability     string `json:"capability"`
	Execution      string `json:"execution"`
	Parse          string `json:"parse"`
	HasRawEvidence bool   `json:"has_raw_evidence"`
}

// memoryWriter is a minimal evidence sink; evals never touch the real store.
type memoryWriter struct {
	n int
}

func (m *memoryWriter) Register(ctx context.Context, p evidence.RegisterParams, r io.Reader) (evidence.Artifact, error) {
	_, _ = io.Copy(io.Discard, r)
	m.n++
	return evidence.Artifact{ID: uuid.New()}, nil
}

func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func TestHTTPProbeCasesMatchBaselines(t *testing.T) {
	root := repoRoot(t)
	casesDir := filepath.Join(root, "evals", "cases")
	baselinesDir := filepath.Join(root, "evals", "baselines")

	entries, err := os.ReadDir(casesDir)
	if err != nil {
		t.Fatalf("read cases: %v", err)
	}

	// The lab endpoint the success case targets.
	lab := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("lab-ok"))
	}))
	defer lab.Close()

	probe := builtin.NewHTTPProbe(&memoryWriter{}, 5*time.Second, 1<<20)

	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".yaml" {
			continue
		}
		t.Run(e.Name(), func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(casesDir, e.Name()))
			if err != nil {
				t.Fatal(err)
			}
			var c evalCase
			if err := yaml.Unmarshal(raw, &c); err != nil {
				t.Fatalf("parse case: %v", err)
			}
			url := c.Input.URL
			if url == labPlaceholder {
				url = lab.URL
			}
			args, _ := json.Marshal(map[string]string{"url": url})
			res, err := probe.Invoke(context.Background(), args)
			if err != nil {
				t.Fatalf("invoke: %v", err)
			}

			baseRaw, err := os.ReadFile(filepath.Join(baselinesDir, c.Name+".json"))
			if err != nil {
				t.Fatalf("read baseline: %v", err)
			}
			var want baseline
			if err := json.Unmarshal(baseRaw, &want); err != nil {
				t.Fatalf("parse baseline: %v", err)
			}

			if string(res.Execution) != want.Execution {
				t.Errorf("execution = %s, want %s", res.Execution, want.Execution)
			}
			if string(res.Parse) != want.Parse {
				t.Errorf("parse = %s, want %s", res.Parse, want.Parse)
			}
			if got := res.RawRef != ""; got != want.HasRawEvidence {
				t.Errorf("has_raw_evidence = %v, want %v", got, want.HasRawEvidence)
			}
			// The case's own expectation must agree with the recorded baseline.
			if c.Expect.Execution != want.Execution || c.Expect.HasRawEvidence != want.HasRawEvidence {
				t.Errorf("case expectation %+v disagrees with baseline %+v", c.Expect, want)
			}
		})
	}
}
