// Package architecture enforces the Phase 3 import boundaries from
// docs/repository_structure_v1.md by inspecting the direct import graph.
package architecture

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const base = "github.com/Akapi895/raptix/backend/internal/"

type pkgInfo struct {
	ImportPath   string
	Dir          string
	Imports      []string
	TestImports  []string
	XTestImports []string
}

type pkg struct {
	path    string
	imports []string
}

// listPackages shells to go list -json and decodes each emitted object to
// collect the direct imports of every internal package.
func listPackages(t *testing.T) []pkg {
	t.Helper()
	cmd := exec.Command("go", "list", "-json", "./internal/...")
	cmd.Dir = moduleRoot(t)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	if err := cmd.Run(); err != nil {
		t.Fatalf("go list: %v", err)
	}
	var pkgs []pkg
	dec := json.NewDecoder(&buf)
	for {
		var info pkgInfo
		err := dec.Decode(&info)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("decode go list output: %v", err)
		}
		if info.ImportPath != "" {
			// Include test-file imports so a boundary violation hidden in a
			// _test.go file is still caught.
			imports := append([]string{}, info.Imports...)
			imports = append(imports, info.TestImports...)
			imports = append(imports, info.XTestImports...)
			pkgs = append(pkgs, pkg{path: info.ImportPath, imports: imports})
		}
	}
	return pkgs
}

func moduleRoot(t *testing.T) string {
	t.Helper()
	dir, _ := filepath.Abs(".")
	for !fileExists(filepath.Join(dir, "go.mod")) {
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not locate module root")
		}
		dir = parent
	}
	return dir
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// isStoregen reports whether p is, or lies under, a generated store package.
// Matching a path segment (not a bare suffix) also catches nested generated
// packages such as ".../storegen/models".
func isStoregen(p string) bool {
	return strings.HasSuffix(p, "/"+storegenSegment) ||
		strings.Contains(p, "/"+storegenSegment+"/")
}

const storegenSegment = "storegen"

func isInternal(p string) bool {
	return strings.HasPrefix(p, base) && !isStoregen(p)
}

// inDir reports whether p is inside the bounded-context directory named
// segment (e.g. "workspace"). Package paths use "/" separators, so this must
// be an exact directory boundary: "internal/workspace" itself or anything
// under "internal/workspace/". A "."-suffixed Contains match would classify
// nothing and let every boundary test pass vacuously.
func inDir(p, segment string) bool {
	return p == base+segment || strings.HasPrefix(p, base+segment+"/")
}

func importsPrefix(p pkg, prefix string) bool {
	for _, im := range p.imports {
		if strings.HasPrefix(im, prefix) {
			return true
		}
	}
	return false
}

// assertInspected fails the test when a boundary rule matched no package at
// all, so a broken path matcher cannot turn the rule into a silent pass.
func assertInspected(t *testing.T, rule string, n int) {
	t.Helper()
	if n == 0 {
		t.Errorf("architecture rule %q inspected 0 packages; the path matcher is broken and the rule is vacuous", rule)
	}
}

func TestWorkspaceDoesNotImportEngine(t *testing.T) {
	inspected := 0
	for _, p := range listPackages(t) {
		if isInternal(p.path) && inDir(p.path, "workspace") {
			inspected++
			if importsPrefix(p, base+"engine") {
				t.Errorf("%s must not import engine", p.path)
			}
		}
	}
	assertInspected(t, "workspace↛engine", inspected)
}

func TestEngineDoesNotImportWorkspaceOrPlatform(t *testing.T) {
	inspected := 0
	for _, p := range listPackages(t) {
		if isInternal(p.path) && inDir(p.path, "engine") {
			inspected++
			if importsPrefix(p, base+"workspace") {
				t.Errorf("%s must not import workspace", p.path)
			}
			if importsPrefix(p, base+"platform") {
				t.Errorf("%s must not import platform", p.path)
			}
		}
	}
	assertInspected(t, "engine↛{workspace,platform}", inspected)
}

func TestPlatformDoesNotImportEngineOrWorkspace(t *testing.T) {
	inspected := 0
	for _, p := range listPackages(t) {
		if isInternal(p.path) && inDir(p.path, "platform") {
			inspected++
			if importsPrefix(p, base+"engine") {
				t.Errorf("%s must not import engine", p.path)
			}
			if importsPrefix(p, base+"workspace") {
				t.Errorf("%s must not import workspace", p.path)
			}
		}
	}
	assertInspected(t, "platform↛{engine,workspace}", inspected)
}

func TestNoModuleImportsTheCompositionRoot(t *testing.T) {
	inspected := 0
	for _, p := range listPackages(t) {
		if isInternal(p.path) && !strings.HasPrefix(p.path, base+"app") {
			inspected++
			if importsPrefix(p, base+"app") {
				t.Errorf("%s must not import the composition root", p.path)
			}
		}
	}
	assertInspected(t, "module↛app", inspected)
}

// TestModuleImportsOnlyItsOwnStoregen asserts a package may only reach the
// generated store that lives in its own module directory. The composition
// root, handlers and other modules must go through the owning Repository or
// Service instead. Ownership is computed by stripping the storegen segment,
// so a nested ".../storegen/models" import is attributed to the same module.
func TestModuleImportsOnlyItsOwnStoregen(t *testing.T) {
	inspected := 0
	for _, p := range listPackages(t) {
		if !isInternal(p.path) {
			continue
		}
		for _, im := range p.imports {
			if !strings.Contains(im, "/internal/") || !isStoregen(im) {
				continue
			}
			inspected++
			owner := strings.SplitN(im, "/"+storegenSegment, 2)[0]
			if p.path != owner && !strings.HasPrefix(p.path, owner+"/") {
				t.Errorf("%s imports foreign storegen %s (owner %s)", p.path, im, owner)
			}
		}
	}
	assertInspected(t, "module→own storegen", inspected)
}
