package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
)

type stubImpl struct {
	msg string
}

func (s stubImpl) Invoke(ctx context.Context, args json.RawMessage) (*output.Result, error) {
	return output.Success("raw/1", "struct/1", "stub.v1"), nil
}

func writeFixture(t *testing.T, root, rel, body string) {
	t.Helper()
	full := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func newManifestLoader(t *testing.T) *content.Loader {
	t.Helper()
	root := t.TempDir()
	contentRoot := filepath.Join(root, "content")
	writeFixture(t, contentRoot, "tools/manifests/nmap.yaml", `apiVersion: manifest/v1
kind: tool
name: nmap
description: "network scanner"
version: 1.0.0
executor:
  type: command
  command: nmap
input:
  type: object
source:
  repo: CyberStrikeAI
  path: tools/nmap.yaml
`)
	l, err := content.NewLoader(contentRoot)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func TestRegisterAndGet(t *testing.T) {
	r := New()
	impl := stubImpl{msg: "nmap"}
	if err := r.Register("nmap", "1.0.0", content.ExecutorCommand, impl, "CyberStrikeAI/tools/nmap.yaml"); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if !r.Available("nmap") {
		t.Error("nmap should be available")
	}
	got, descriptor, err := r.Get("nmap")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if descriptor.Executor != content.ExecutorCommand {
		t.Errorf("executor = %q, want command", descriptor.Executor)
	}
	if _, ok := got.(stubImpl); !ok {
		t.Errorf("impl = %T, want stubImpl", got)
	}
}

func TestRegisterDuplicateVersion(t *testing.T) {
	r := New()
	if err := r.Register("nmap", "1.0.0", content.ExecutorCommand, stubImpl{}, "s"); err != nil {
		t.Fatal(err)
	}
	if err := r.Register("nmap", "1.0.0", content.ExecutorCommand, stubImpl{}, "s"); err == nil {
		t.Error("expected duplicate version error")
	}
}

func TestDeclaredWithoutImplementationNotAvailable(t *testing.T) {
	r := New()
	if err := r.Register("nmap", "1.0.0", content.ExecutorCommand, nil, "CyberStrikeAI/tools/nmap.yaml"); err != nil {
		t.Fatal(err)
	}
	if r.Available("nmap") {
		t.Error("declared-only tool must not be available")
	}
	if _, _, err := r.Get("nmap"); err == nil {
		t.Error("Get should error for declared-only tool")
	}
}

func TestCompatChecksExecutorKind(t *testing.T) {
	r := New()
	r.Register("nmap", "1.0.0", content.ExecutorCommand, nil, "s")
	if !r.Compat("nmap", content.ExecutorCommand) {
		t.Error("nmap should be compatible with command executor")
	}
	if r.Compat("nmap", content.ExecutorMCP) {
		t.Error("nmap must not be compatible with mcp executor")
	}
	if r.Compat("missing", content.ExecutorCommand) {
		t.Error("missing tool must not be compatible")
	}
}

func TestGetVersion(t *testing.T) {
	r := New()
	r.Register("nmap", "1.0.0", content.ExecutorCommand, stubImpl{msg: "v1"}, "s")
	r.Register("nmap", "2.0.0", content.ExecutorCommand, stubImpl{msg: "v2"}, "s")
	// latest version wins for Get
	_, _, err := r.Get("nmap")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if _, _, err := r.GetVersion("nmap", "1.0.0"); err != nil {
		t.Errorf("GetVersion 1.0.0: %v", err)
	}
	if _, _, err := r.GetVersion("nmap", "9.9.9"); err == nil {
		t.Error("expected not-found for unknown version")
	}
}

func TestRegisterFromManifest(t *testing.T) {
	l := newManifestLoader(t)
	r := New()
	if err := r.RegisterFromManifest(l, "nmap", stubImpl{msg: "nmap"}); err != nil {
		t.Fatalf("RegisterFromManifest: %v", err)
	}
	if !r.Available("nmap") {
		t.Error("nmap should be available")
	}
	if !r.Compat("nmap", content.ExecutorCommand) {
		t.Error("nmap should be compatible with command executor")
	}
	if r.Compat("nmap", content.ExecutorBuiltin) {
		t.Error("nmap must not be compatible with builtin executor")
	}
}

func TestRegisterFromManifestDeclaredOnly(t *testing.T) {
	l := newManifestLoader(t)
	r := New()
	// no implementation: declares the capability from manifest only
	if err := r.RegisterFromManifest(l, "nmap", nil); err != nil {
		t.Fatalf("RegisterFromManifest: %v", err)
	}
	if r.Available("nmap") {
		t.Error("declared-only nmap must not be available")
	}
	if !r.Compat("nmap", content.ExecutorCommand) {
		t.Error("declared-only nmap should still report compatibility")
	}
}

func TestList(t *testing.T) {
	r := New()
	r.Register("nmap", "1.0.0", content.ExecutorCommand, nil, "s")
	r.Register("curl", "1.0.0", content.ExecutorCommand, nil, "s")
	got := r.List()
	if len(got) != 2 {
		t.Fatalf("List = %d, want 2", len(got))
	}
	if got["nmap"].Executor != content.ExecutorCommand {
		t.Errorf("nmap descriptor = %#v", got["nmap"])
	}
}

func TestDescriptorCarriesManifestMetadataAndIsImmutable(t *testing.T) {
	l := newManifestLoader(t)
	r := New()
	if err := r.RegisterFromManifest(l, "nmap", nil); err != nil {
		t.Fatal(err)
	}
	d, err := r.Describe("nmap")
	if err != nil {
		t.Fatalf("Describe: %v", err)
	}
	if d.ID != "nmap" || d.Version != "1.0.0" || d.Executor != content.ExecutorCommand || !d.Declared || d.Bound || d.Ready {
		t.Errorf("descriptor = %#v", d)
	}
	if d.Source != "CyberStrikeAI/tools/nmap.yaml" {
		t.Errorf("source = %q", d.Source)
	}
	if d.Runtime.Container || d.Runtime.Network {
		t.Errorf("runtime = %#v", d.Runtime)
	}

	d.Input.(map[string]interface{})["type"] = "altered"
	again, err := r.DescribeVersion("nmap", "1.0.0")
	if err != nil {
		t.Fatal(err)
	}
	if again.Input.(map[string]interface{})["type"] != "object" {
		t.Errorf("registry descriptor was mutated: %#v", again.Input)
	}

	if err := r.Register("nmap", "1.0.0", content.ExecutorCommand, stubImpl{}, "ignored"); err != nil {
		t.Fatalf("bind declared tool: %v", err)
	}
	bound, err := r.Describe("nmap")
	if err != nil {
		t.Fatal(err)
	}
	if !bound.Bound || !bound.Ready {
		t.Errorf("bound descriptor = %#v", bound)
	}
}

func TestImplementationReturnsResult(t *testing.T) {
	impl := stubImpl{msg: "ok"}
	res, err := impl.Invoke(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK() {
		t.Error("stub result should be OK")
	}
	if res.Execution != output.ExecutionSuccess {
		t.Errorf("execution = %q", res.Execution)
	}
}

func TestSemverLatest(t *testing.T) {
	r := New()
	r.Register("nmap", "1.9.0", content.ExecutorCommand, stubImpl{msg: "v1.9"}, "s")
	r.Register("nmap", "1.10.0", content.ExecutorCommand, stubImpl{msg: "v1.10"}, "s")
	impl, _, err := r.Get("nmap")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if s, ok := impl.(stubImpl); !ok || s.msg != "v1.10" {
		t.Errorf("latest should be 1.10.0, got %v", impl)
	}
}

func TestConcurrentRegisterAndLookup(t *testing.T) {
	r := New()
	const goroutines = 8
	const versionsPer = 20
	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(seed int) {
			defer wg.Done()
			for i := 0; i < versionsPer; i++ {
				v := fmt.Sprintf("1.%d.%d", seed, i)
				_ = r.Register("nmap", v, content.ExecutorCommand, stubImpl{msg: v}, "s")
				_, _, _ = r.Get("nmap")
				_, _, _ = r.GetVersion("nmap", v)
				_ = r.Available("nmap")
				_ = r.Compat("nmap", content.ExecutorCommand)
				_ = r.List()
			}
		}(g)
	}
	wg.Wait()
	if !r.Available("nmap") {
		t.Error("nmap should be available after concurrent registration")
	}
}
