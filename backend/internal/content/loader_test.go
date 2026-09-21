package content

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testSchemasRoot points at the authoritative manifest schemas in the repo.
// Evaluated from backend/internal/content: ../../.. -> repo root.
const testSchemasRoot = "../../../contracts/manifests"

func writeFixture(t *testing.T, root, rel string, body string) {
	t.Helper()
	full := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func newTestLoader(t *testing.T) *Loader {
	t.Helper()
	root := t.TempDir()
	writeFixture(t, root, "agents/profiles/recon.yaml", `apiVersion: manifest/v1
kind: profile
name: recon
description: recon agent
version: 1.0.0
license: Apache-2.0
promptRefs:
  - agents/prompts/recon-system.md
requested:
  skills: [offensive-api-security]
  tools: [nmap]
model: MiniMax/MiniMax-M3-VIP
`)
	writeFixture(t, root, "agents/prompts/recon-system.md", "recon prompt\n")
	writeFixture(t, root, "skills/recon/offensive-api-security/SKILL.md", `---
name: offensive-api-security
description: test an API
metadata:
  author: usestrix
---

# API Security

API testing guidance.
`)
	writeFixture(t, root, "skills/recon/offensive-osint/SKILL.md", `# Offensive OSINT

No frontmatter here; name comes from the directory.
`)
	writeFixture(t, root, "tools/manifests/nmap.yaml", `apiVersion: manifest/v1
kind: tool
name: nmap
description: "network scanner"
version: 1.0.0
license: Apache-2.0
executor:
  type: command
  command: nmap
  args: [-sT, -sV]
input:
  type: object
  properties:
    target:
      type: string
  required: [target]
source:
  repo: CyberStrikeAI
  path: tools/nmap.yaml
`)
	writeFixture(t, root, "resources/tools-pack.yaml", `apiVersion: manifest/v1
kind: resource
name: tools-pack
description: tool pack
version: 1.0.0
digest: sha256:abc
`)
	writeFixture(t, root, "runtimes/scan.yaml", `apiVersion: manifest/v1
kind: runtime
name: scan
description: scan runtime
version: 1.0.0
image: raptix/scan:1
capabilities: [network]
`)

	l, err := NewLoader(root, testSchemasRoot)
	if err != nil {
		t.Fatalf("NewLoader: %v", err)
	}
	return l
}

func TestLoadProfile(t *testing.T) {
	l := newTestLoader(t)
	p, err := l.LoadProfile("recon")
	if err != nil {
		t.Fatalf("LoadProfile: %v", err)
	}
	if p.Name != "recon" {
		t.Errorf("name = %q, want recon", p.Name)
	}
	if p.Model != "MiniMax/MiniMax-M3-VIP" {
		t.Errorf("model = %q", p.Model)
	}
	if len(p.Requested.Tools) != 1 || p.Requested.Tools[0] != "nmap" {
		t.Errorf("requested tools = %v, want [nmap]", p.Requested.Tools)
	}
}

func TestLoadSkillWithFrontmatter(t *testing.T) {
	l := newTestLoader(t)
	s, err := l.LoadSkill("offensive-api-security")
	if err != nil {
		t.Fatalf("LoadSkill: %v", err)
	}
	if s.Name != "offensive-api-security" {
		t.Errorf("name = %q", s.Name)
	}
	if s.Description == "" {
		t.Error("description must not be empty")
	}
	if s.Metadata["author"] != "usestrix" {
		t.Errorf("author = %v, want usestrix", s.Metadata["author"])
	}
	if s.Body == "" {
		t.Error("body must not be empty")
	}
}

func TestLoadSkillFallsBackToDirName(t *testing.T) {
	l := newTestLoader(t)
	s, err := l.LoadSkill("offensive-osint")
	if err != nil {
		t.Fatalf("LoadSkill: %v", err)
	}
	if s.Name != "offensive-osint" {
		t.Errorf("name = %q, want offensive-osint", s.Name)
	}
	if !strings.Contains(s.Body, "Offensive OSINT") {
		t.Errorf("body missing expected content, got: %q", s.Body)
	}
}

func TestLoadSkillMetadataProvidesProvenanceWithoutBody(t *testing.T) {
	l := newTestLoader(t)
	first, err := l.LoadSkillMetadata("offensive-api-security")
	if err != nil {
		t.Fatalf("LoadSkillMetadata: %v", err)
	}
	if first.Identity != (Identity{Kind: KindSkill, Name: "offensive-api-security"}) {
		t.Errorf("identity = %#v", first.Identity)
	}
	if first.Version != "1.0.0" || first.Path != "skills/recon/offensive-api-security/SKILL.md" {
		t.Errorf("resolved metadata = %#v", first.ResolvedContent)
	}
	if !strings.HasPrefix(first.Hash, "sha256:") {
		t.Errorf("hash = %q, want sha256 digest", first.Hash)
	}
	if first.Metadata["author"] != "usestrix" {
		t.Errorf("metadata = %v", first.Metadata)
	}

	second, err := l.LoadSkillMetadata("offensive-api-security")
	if err != nil {
		t.Fatal(err)
	}
	if first.Hash != second.Hash {
		t.Errorf("same content hashes differ: %q != %q", first.Hash, second.Hash)
	}

	fixture := t.TempDir()
	writeFixture(t, fixture, "skills/test/demo/SKILL.md", "---\nname: demo\n---\nfirst body\n")
	loader, err := NewLoader(fixture)
	if err != nil {
		t.Fatal(err)
	}
	before, err := loader.LoadSkillMetadata("demo")
	if err != nil {
		t.Fatal(err)
	}
	writeFixture(t, fixture, "skills/test/demo/SKILL.md", "---\nname: demo\n---\nchanged body\n")
	after, err := loader.LoadSkillMetadata("demo")
	if err != nil {
		t.Fatal(err)
	}
	if before.Hash == after.Hash {
		t.Error("skill body change must change provenance hash")
	}
}

func TestLoadTool(t *testing.T) {
	l := newTestLoader(t)
	tl, err := l.LoadTool("nmap")
	if err != nil {
		t.Fatalf("LoadTool: %v", err)
	}
	if tl.Executor.Type != ExecutorCommand {
		t.Errorf("executor type = %q, want command", tl.Executor.Type)
	}
	if tl.Executor.Command != "nmap" {
		t.Errorf("command = %q, want nmap", tl.Executor.Command)
	}
	if len(tl.Executor.Args) != 2 {
		t.Errorf("args = %v, want 2 entries", tl.Executor.Args)
	}
}

func TestLoadResourceAndRuntime(t *testing.T) {
	l := newTestLoader(t)
	if _, err := l.LoadResource("tools-pack"); err != nil {
		t.Errorf("LoadResource: %v", err)
	}
	if _, err := l.LoadRuntime("scan"); err != nil {
		t.Errorf("LoadRuntime: %v", err)
	}
}

func TestLoadNotFound(t *testing.T) {
	l := newTestLoader(t)
	if _, err := l.LoadSkill("missing"); err == nil {
		t.Fatal("expected error for missing skill")
	}
}

func TestLoadRejectsKindMismatch(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "tools/manifests/skillish.yaml", `apiVersion: manifest/v1
kind: skill
name: skillish
description: declared as a skill but loaded as a tool
`)
	l, err := NewLoader(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.LoadTool("skillish"); err == nil {
		t.Error("expected kind mismatch error")
	}
}

func TestLoadRejectsSchemaViolationAndMultipleDocuments(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "tools/manifests/invalid.yaml", `apiVersion: manifest/v1
kind: tool
name: invalid
executor:
  type: unknown
`)
	writeFixture(t, root, "tools/manifests/multi.yaml", `apiVersion: manifest/v1
kind: tool
name: multi
executor:
  type: builtin
---
apiVersion: manifest/v1
kind: tool
name: ignored
executor:
  type: builtin
`)
	writeFixture(t, root, "tools/manifests/bool-schema.yaml", `apiVersion: manifest/v1
kind: tool
name: bool-schema
executor:
  type: builtin
input: true
output: false
`)
	writeFixture(t, root, "resources/negative.yaml", `apiVersion: manifest/v1
kind: resource
name: negative
size: -1
`)
	l, err := NewLoader(root, testSchemasRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.LoadTool("invalid"); err == nil {
		t.Error("expected schema validation error")
	}
	if _, err := l.LoadTool("multi"); err == nil {
		t.Error("expected multi-document error")
	}
	tool, err := l.LoadTool("bool-schema")
	if err != nil {
		t.Fatalf("boolean schemas: %v", err)
	}
	if tool.Input != true || tool.Output != false {
		t.Errorf("boolean schemas = %#v / %#v", tool.Input, tool.Output)
	}
	if _, err := l.LoadResource("negative"); err == nil {
		t.Error("expected negative resource size schema error")
	}
}

func TestLoadProfileRejectsMissingReference(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "agents/profiles/broken.yaml", `apiVersion: manifest/v1
kind: profile
name: broken
promptRefs: [agents/prompts/missing.md]
`)
	l, err := NewLoader(root, testSchemasRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.LoadProfile("broken"); err == nil {
		t.Error("expected missing prompt reference error")
	}
}

func TestLoadRejectsTraversalAndEscapingSymlink(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	writeFixture(t, outside, "escape.yaml", `apiVersion: manifest/v1
kind: tool
name: escape
executor:
  type: builtin
`)
	if err := os.MkdirAll(filepath.Join(root, "tools", "manifests"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "escape.yaml"), filepath.Join(root, "tools", "manifests", "escape.yaml")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	l, err := NewLoader(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.LoadTool("../escape"); err == nil {
		t.Error("expected traversal rejection")
	}
	if _, err := l.LoadTool("escape"); err == nil {
		t.Error("expected escaping symlink rejection")
	}
}

func TestSkillFrontmatterRejectsUnknownField(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "skills/utility/bad/SKILL.md", `---
name: bad
description: bad
unknownField: true
---
body
`)
	l, err := NewLoader(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.LoadSkill("bad"); err == nil {
		t.Error("expected strict decode error for unknown frontmatter field")
	}
}

func TestSkillUnclosedFrontmatterErrors(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "skills/utility/broken/SKILL.md", `---
name: broken
description: missing closing
body without closing delimiter
`)
	l, err := NewLoader(root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.LoadSkill("broken"); err == nil {
		t.Error("expected error for unclosed frontmatter")
	}
}

func TestSkillFrontmatterDelimitersAndIdentity(t *testing.T) {
	valid, err := parseSkill("demo", []byte("\ufeff---\r\napiVersion: manifest/v1\r\nkind: skill\r\nname: demo\r\nversion: 1.2.3\r\ndescription: demo\r\n---\r\nbody\r\n---not-a-delimiter\r\n"))
	if err != nil {
		t.Fatalf("parse CRLF frontmatter: %v", err)
	}
	if valid.Version != "1.2.3" {
		t.Errorf("version = %q, want 1.2.3", valid.Version)
	}
	if valid.Body != "body\r\n---not-a-delimiter\r\n" {
		t.Errorf("body was not preserved: %q", valid.Body)
	}
	noFrontmatter, err := parseSkill("plain", []byte("---not-a-delimiter\nbody\n"))
	if err != nil {
		t.Fatalf("parse non-delimiter prefix: %v", err)
	}
	if noFrontmatter.Name != "plain" {
		t.Errorf("name = %q, want plain", noFrontmatter.Name)
	}
	if _, err := parseSkill("dir", []byte("---\nname: other\n---\nbody\n")); err == nil {
		t.Error("expected frontmatter/directory name mismatch")
	}
}

func TestListSkillsEnumeratesDirectories(t *testing.T) {
	l := newTestLoader(t)
	names, err := l.List(KindSkill)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 2 {
		t.Fatalf("got %d skills, want 2: %v", len(names), names)
	}
	want := map[string]bool{"offensive-api-security": true, "offensive-osint": true}
	for _, n := range names {
		if !want[n] {
			t.Errorf("unexpected skill name %q", n)
		}
	}
}

func TestLoadSkillAcrossCategories(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "skills/web/x/SKILL.md", "---\nname: x\n---\nweb x\n")
	writeFixture(t, root, "skills/network/x/SKILL.md", "---\nname: x\n---\nnetwork x\n")
	l, err := NewLoader(root)
	if err != nil {
		t.Fatal(err)
	}
	names, err := l.List(KindSkill)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 1 || names[0] != "x" {
		t.Errorf("list = %v, want [x]", names)
	}
	if _, err := l.LoadSkill("web/x"); err != nil {
		t.Errorf("LoadSkill(web/x): %v", err)
	}
	if _, err := l.LoadSkill("network/x"); err != nil {
		t.Errorf("LoadSkill(network/x): %v", err)
	}
	if _, err := l.LoadSkill("x"); err == nil {
		t.Error("expected ambiguous bare skill error")
	}
}

func TestNewLoaderRequiresExistingDir(t *testing.T) {
	if _, err := NewLoader(filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Error("expected error for missing content root")
	}
}
