package content

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"gopkg.in/yaml.v3"
)

// Loader reads and validates content manifests from a content root.
// Loading a manifest never loads code or runs shell; it only parses and
// validates declarative YAML against the authoritative JSON Schemas in
// contracts/manifests. All reads stay within the content root.
type Loader struct {
	root    string
	schemas map[Kind]*jsonschema.Schema
}

// NewLoader opens a loader rooted at the given directory. An optional schema
// root loads the authoritative manifest schemas (e.g. contracts/manifests) and
// enables schema-driven validation.
func NewLoader(root string, schemaRoots ...string) (*Loader, error) {
	if root == "" {
		return nil, fmt.Errorf("content root must not be empty")
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("stat content root %q: %w", root, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("content root %q is not a directory", root)
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, fmt.Errorf("resolve content root %q: %w", root, err)
	}
	l := &Loader{root: resolvedRoot}
	schemasRoot := ""
	if len(schemaRoots) > 0 {
		schemasRoot = schemaRoots[0]
	}
	if schemasRoot != "" {
		if info, err := os.Stat(schemasRoot); err != nil || !info.IsDir() {
			return nil, fmt.Errorf("schema root %q is not a directory", schemasRoot)
		}
		if err := l.loadSchemas(schemasRoot); err != nil {
			return nil, err
		}
	}
	return l, nil
}

func (l *Loader) loadSchemas(schemasRoot string) error {
	files := map[Kind]string{
		KindProfile:  "profile.schema.json",
		KindSkill:    "skill.schema.json",
		KindTool:     "tool.schema.json",
		KindResource: "resource.schema.json",
		KindRuntime:  "runtime.schema.json",
	}
	compiler := jsonschema.NewCompiler()
	l.schemas = make(map[Kind]*jsonschema.Schema, len(files))
	for kind, f := range files {
		p := filepath.Join(schemasRoot, f)
		s, err := compiler.Compile(p)
		if err != nil {
			return fmt.Errorf("compile %s schema %s: %w", kind, p, err)
		}
		l.schemas[kind] = s
	}
	return nil
}

// schema returns the compiled schema for a kind, or nil when validation is off.
func (l *Loader) schema(kind Kind) *jsonschema.Schema {
	return l.schemas[kind]
}

// ensureContained resolves existing symlinks and rejects paths outside the
// canonical content root. Lexical validation alone cannot prevent a symlink
// inside the catalog from pointing at an arbitrary host path.
func (l *Loader) ensureContained(path string) error {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(l.root, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("path %q resolves outside content root", path)
	}
	return nil
}

// LoadProfile loads a single agent profile manifest by name.
func (l *Loader) LoadProfile(name string) (*Profile, error) {
	m, err := l.load(KindProfile, name)
	if err != nil {
		return nil, err
	}
	profile := m.(*Profile)
	if err := l.validateProfileReferences(profile); err != nil {
		return nil, fmt.Errorf("profile %s: %w", name, err)
	}
	return profile, nil
}

func (l *Loader) validateProfileReferences(profile *Profile) error {
	for _, ref := range profile.PromptRefs {
		if err := l.validateContentFile(ref); err != nil {
			return fmt.Errorf("prompt reference %q: %w", ref, err)
		}
	}
	for _, name := range profile.Requested.Skills {
		if _, err := l.LoadSkill(name); err != nil {
			return fmt.Errorf("skill reference %q: %w", name, err)
		}
	}
	for _, name := range profile.Requested.Tools {
		if _, err := l.LoadTool(name); err != nil {
			return fmt.Errorf("tool reference %q: %w", name, err)
		}
	}
	for _, name := range profile.Requested.Resources {
		if _, err := l.LoadResource(name); err != nil {
			return fmt.Errorf("resource reference %q: %w", name, err)
		}
	}
	return nil
}

func (l *Loader) validateContentFile(ref string) error {
	if err := validateRel(ref); err != nil {
		return err
	}
	path := filepath.Join(l.root, filepath.FromSlash(ref))
	if err := l.ensureContained(path); err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("must reference a file")
	}
	return nil
}

// LoadSkill loads a skill stored as <category>/<name>/SKILL.md, parsing its
// frontmatter and markdown body. When the frontmatter lacks a name, the
// directory name is used. The name argument may be a bare skill name (searched
// across all categories) or a qualified "<category>/<name>" reference.
func (l *Loader) LoadSkill(name string) (*Skill, error) {
	_, _, _, skill, err := l.readSkill(name)
	return skill, err
}

func (l *Loader) readSkill(name string) (string, string, []byte, *Skill, error) {
	if name == "" {
		return "", "", nil, nil, fmt.Errorf("skill name must not be empty")
	}
	dir, err := l.skillDir(name)
	if err != nil {
		return "", "", nil, nil, err
	}
	dirName := filepath.Base(dir)
	full := filepath.Join(dir, "SKILL.md")
	if err := l.ensureContained(full); err != nil {
		return "", "", nil, nil, fmt.Errorf("skill %s: %w", name, err)
	}
	info, err := os.Stat(full)
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("skill %s not found: %w", name, err)
	}
	if info.IsDir() {
		return "", "", nil, nil, fmt.Errorf("skill %s path is a directory: %v", name, full)
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("read skill %s: %w", name, err)
	}
	s, err := parseSkill(dirName, data)
	if err != nil {
		return "", "", nil, nil, fmt.Errorf("skill %s: %w", name, err)
	}
	if err := l.validateSkill(s); err != nil {
		return "", "", nil, nil, fmt.Errorf("skill %s: %w", name, err)
	}
	return dir, full, data, s, nil
}

// LoadSkillMetadata resolves a skill's identity and provenance without
// returning its markdown body. The hash covers the complete SKILL.md source,
// so a body change creates a distinct resolved skill revision.
func (l *Loader) LoadSkillMetadata(name string) (*SkillMetadata, error) {
	_, full, data, skill, err := l.readSkill(name)
	if err != nil {
		return nil, err
	}
	return skillMetadata(full, data, skill, l.root), nil
}

func skillMetadata(full string, data []byte, skill *Skill, root string) *SkillMetadata {
	rel, err := filepath.Rel(root, full)
	if err != nil {
		rel = full
	}
	digest := sha256.Sum256(data)
	version := skill.Version
	if version == "" {
		version = "1.0.0"
	}
	return &SkillMetadata{
		ResolvedContent: ResolvedContent{
			Identity: Identity{Kind: KindSkill, Name: skill.Name},
			Version:  version,
			Hash:     fmt.Sprintf("sha256:%x", digest),
			Path:     filepath.ToSlash(rel),
		},
		Description: skill.Description,
		License:     skill.License,
		Metadata:    cloneMetadata(skill.Metadata),
	}
}

// cloneMetadata deep-copies a metadata map, preserving a nil value.
func cloneMetadata(metadata map[string]interface{}) map[string]interface{} {
	if metadata == nil {
		return nil
	}
	return DeepClone(metadata).(map[string]interface{})
}

// DeepClone returns a deep copy of manifest data so callers cannot mutate a
// loader-owned document by editing a returned map or slice.
func DeepClone(value interface{}) interface{} {
	switch v := value.(type) {
	case map[string]interface{}:
		cloned := make(map[string]interface{}, len(v))
		for key, item := range v {
			cloned[key] = DeepClone(item)
		}
		return cloned
	case []interface{}:
		cloned := make([]interface{}, len(v))
		for i, item := range v {
			cloned[i] = DeepClone(item)
		}
		return cloned
	default:
		return value
	}
}

func (l *Loader) validateSkill(skill *Skill) error {
	schema := l.schema(KindSkill)
	if schema == nil {
		return nil
	}
	document := map[string]any{"name": skill.Name}
	if skill.APIVersion != "" {
		document["apiVersion"] = skill.APIVersion
	}
	if skill.Kind != "" {
		document["kind"] = skill.Kind
	}
	if skill.Version != "" {
		document["version"] = skill.Version
	}
	if skill.Description != "" {
		document["description"] = skill.Description
	}
	if skill.License != "" {
		document["license"] = skill.License
	}
	if len(skill.Metadata) > 0 {
		document["metadata"] = skill.Metadata
	}
	if err := schema.Validate(document); err != nil {
		return fmt.Errorf("schema validation failed: %w", err)
	}
	return nil
}

// validateRel rejects references that could escape the content root: empty,
// absolute, or containing "." or ".." path components.
func validateRel(ref string) error {
	if ref == "" {
		return fmt.Errorf("manifest reference must not be empty")
	}
	name := filepath.FromSlash(ref)
	if filepath.IsAbs(name) || strings.HasPrefix(ref, "/") || strings.HasPrefix(ref, "\\") {
		return fmt.Errorf("manifest reference %q must be relative", ref)
	}
	for _, part := range strings.FieldsFunc(ref, func(r rune) bool { return r == '/' || r == '\\' }) {
		if part == ".." || part == "." {
			return fmt.Errorf("manifest reference %q must not contain %q component", ref, part)
		}
	}
	return nil
}

// validateRelFormat allows only a bare name (profile/skill/tool/resource/runtime)
// or, for skills, an optional "<category>/<name>" with simple segments.
var relSegment = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// skillDir resolves a skill name to its directory under skills/. A qualified
// "<category>/<name>" reference is used directly; a bare name is searched across
// categories and errors if multiple categories contain it (callers qualify to
// disambiguate).
func (l *Loader) skillDir(name string) (string, error) {
	if err := validateRel(name); err != nil {
		return "", err
	}
	if strings.ContainsRune(name, '/') {
		for _, seg := range strings.Split(name, "/") {
			if !relSegment.MatchString(seg) {
				return "", fmt.Errorf("invalid skill reference %q", name)
			}
		}
		return filepath.Join(l.path(KindSkill, ""), filepath.FromSlash(name)), nil
	}
	if !relSegment.MatchString(name) {
		return "", fmt.Errorf("invalid skill name %q", name)
	}
	base := l.path(KindSkill, "")
	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("skill %s not found: skills directory missing", name)
		}
		return "", fmt.Errorf("list skills: %w", err)
	}
	var matches []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		cand := filepath.Join(base, e.Name(), name)
		if info, err := os.Stat(filepath.Join(cand, "SKILL.md")); err == nil && !info.IsDir() {
			if err := l.ensureContained(filepath.Join(cand, "SKILL.md")); err != nil {
				return "", err
			}
			matches = append(matches, cand)
		}
	}
	switch len(matches) {
	case 0:
		return "", fmt.Errorf("skill %s not found under any category", name)
	case 1:
		return matches[0], nil
	default:
		return "", fmt.Errorf("skill %q is ambiguous; use <category>/%s", name, name)
	}
}

// LoadTool loads a single tool manifest by name.
func (l *Loader) LoadTool(name string) (*Tool, error) {
	m, err := l.load(KindTool, name)
	if err != nil {
		return nil, err
	}
	return m.(*Tool), nil
}

// LoadResource loads a single resource manifest by name.
func (l *Loader) LoadResource(name string) (*Resource, error) {
	m, err := l.load(KindResource, name)
	if err != nil {
		return nil, err
	}
	return m.(*Resource), nil
}

// LoadRuntime loads a single runtime manifest by name.
func (l *Loader) LoadRuntime(name string) (*Runtime, error) {
	m, err := l.load(KindRuntime, name)
	if err != nil {
		return nil, err
	}
	return m.(*Runtime), nil
}

func (l *Loader) load(kind Kind, name string) (interface{}, error) {
	full, err := l.resolve(kind, name)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	m, err := l.decode(kind, data)
	if err != nil {
		return nil, fmt.Errorf("manifest %s %s: %w", kind, name, err)
	}
	return m, nil
}

// List returns the manifest names of a kind under the content root, or nil
// when the kind directory does not exist. Skills are nested as
// <category>/<name>/SKILL.md; the returned list contains unique skill names
// across all categories.
func (l *Loader) List(kind Kind) ([]string, error) {
	dir := l.path(kind, "")
	if err := l.ensureContained(dir); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("list %s: %w", kind, err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("list %s: %w", kind, err)
	}
	seen := map[string]bool{}
	var names []string
	for _, e := range entries {
		if kind == KindSkill {
			if !e.IsDir() {
				continue
			}
			categoryDir := filepath.Join(dir, e.Name())
			if err := l.ensureContained(categoryDir); err != nil {
				return nil, fmt.Errorf("list skills: %w", err)
			}
			for _, s := range l.listSkillNames(categoryDir) {
				if !seen[s] {
					seen[s] = true
					names = append(names, s)
				}
			}
			continue
		}
		if e.IsDir() {
			continue
		}
		switch filepath.Ext(e.Name()) {
		case ".yaml", ".yml":
			names = append(names, trimExt(e.Name()))
		}
	}
	return names, nil
}

// listSkillNames returns the skill names inside a single category directory.
func (l *Loader) listSkillNames(catDir string) []string {
	entries, err := os.ReadDir(catDir)
	if err != nil {
		return nil
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		skillPath := filepath.Join(catDir, e.Name(), "SKILL.md")
		if info, err := os.Stat(skillPath); err == nil && !info.IsDir() {
			if err := l.ensureContained(skillPath); err != nil {
				continue
			}
			names = append(names, e.Name())
		}
	}
	return names
}

func (l *Loader) path(kind Kind, name string) string {
	var dir string
	switch kind {
	case KindProfile:
		dir = "agents/profiles"
	case KindSkill:
		dir = "skills"
	case KindTool:
		dir = "tools/manifests"
	case KindResource:
		dir = "resources"
	case KindRuntime:
		dir = "runtimes"
	default:
		dir = "."
	}
	return filepath.Join(l.root, dir, name)
}

// resolve maps a name to a file under the kind directory, trying the path as
// given and then with .yaml and .yml extensions appended. Traversal and
// absolute references are rejected to keep reads inside the content root.
func (l *Loader) resolve(kind Kind, name string) (string, error) {
	if err := validateRel(name); err != nil {
		return "", err
	}
	base := l.path(kind, name)
	for _, cand := range []string{base, base + ".yaml", base + ".yml"} {
		if info, err := os.Stat(cand); err == nil && !info.IsDir() {
			if err := l.ensureContained(cand); err != nil {
				return "", err
			}
			return cand, nil
		}
	}
	return "", fmt.Errorf("manifest %s %s not found under %s", kind, name, l.root)
}

func trimExt(name string) string {
	return name[:len(name)-len(filepath.Ext(name))]
}

// decode parses raw bytes into the kind's manifest struct using strict decoding
// so unknown YAML fields are rejected, then validates required fields and, when
// configured, validates the document against the authoritative JSON Schema.
// Multiple YAML documents in a single manifest are rejected.
func (l *Loader) decode(kind Kind, data []byte) (interface{}, error) {
	var v interface{}
	switch kind {
	case KindProfile:
		v = new(Profile)
	case KindTool:
		v = new(Tool)
	case KindResource:
		v = new(Resource)
	case KindRuntime:
		v = new(Runtime)
	default:
		return nil, fmt.Errorf("unknown manifest kind %q", kind)
	}

	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(v); err != nil {
		if err == io.EOF {
			return nil, fmt.Errorf("decode: empty manifest")
		}
		return nil, fmt.Errorf("decode: %w", err)
	}
	var extra interface{}
	if err := dec.Decode(&extra); err != io.EOF {
		if err != nil {
			return nil, fmt.Errorf("decode: %w", err)
		}
		return nil, fmt.Errorf("decode: multiple YAML documents in one manifest")
	}
	if err := l.validate(kind, v); err != nil {
		return nil, err
	}
	return v, nil
}

func (l *Loader) validate(kind Kind, v interface{}) error {
	b, ok := v.(interface{ kindAndName() (string, string) })
	if !ok {
		return fmt.Errorf("manifest %s has no base", kind)
	}
	k, name := b.kindAndName()
	if k != string(kind) {
		return fmt.Errorf("kind mismatch: file %s declares %s", kind, k)
	}
	if name == "" {
		return fmt.Errorf("manifest %s has empty name", kind)
	}
	s := l.schema(kind)
	if s == nil {
		return nil
	}
	asJSON, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal manifest for schema check: %w", err)
	}
	var document any
	if err := json.Unmarshal(asJSON, &document); err != nil {
		return fmt.Errorf("decode manifest JSON for schema check: %w", err)
	}
	if err := s.Validate(document); err != nil {
		return fmt.Errorf("schema validation failed: %w", err)
	}
	return nil
}

func (b manifestBase) kindAndName() (string, string) { return b.Kind, b.Name }

// skillFrontmatter holds the optional YAML block at the top of a SKILL.md.
type skillFrontmatter struct {
	manifestBase `yaml:",inline"`
	Metadata     map[string]interface{} `yaml:"metadata"`
}

// parseSkill parses a SKILL.md with an optional frontmatter block delimited by
// lines containing exactly "---". Files without frontmatter retain the directory
// name as their identity.
func parseSkill(dirName string, data []byte) (*Skill, error) {
	s := &Skill{Metadata: map[string]interface{}{}}
	text := strings.TrimLeft(string(data), "\ufeff")
	frontmatter, body, hasFrontmatter, err := splitSkillFrontmatter(text)
	if err != nil {
		return nil, err
	}
	if !hasFrontmatter {
		s.Name = dirName
		s.Body = text
		return s, nil
	}

	var fm skillFrontmatter
	dec := yaml.NewDecoder(strings.NewReader(frontmatter))
	dec.KnownFields(true)
	if err := dec.Decode(&fm); err != nil && err != io.EOF {
		return nil, fmt.Errorf("decode skill frontmatter: %w", err)
	}
	var extra interface{}
	if err := dec.Decode(&extra); err != io.EOF {
		if err != nil {
			return nil, fmt.Errorf("decode skill frontmatter: %w", err)
		}
		return nil, fmt.Errorf("skill frontmatter has multiple YAML documents")
	}
	if fm.Name != "" && fm.Name != dirName {
		return nil, fmt.Errorf("frontmatter name %q does not match directory %q", fm.Name, dirName)
	}
	if fm.APIVersion != "" && fm.APIVersion != "manifest/v1" {
		return nil, fmt.Errorf("unsupported skill apiVersion %q", fm.APIVersion)
	}
	if fm.Kind != "" && fm.Kind != string(KindSkill) {
		return nil, fmt.Errorf("skill frontmatter kind %q must be %q", fm.Kind, KindSkill)
	}
	s.manifestBase = fm.manifestBase
	s.Metadata = fm.Metadata
	s.Description = fm.Description
	s.License = fm.License
	s.Name = fm.Name
	if s.Name == "" {
		s.Name = dirName
	}
	s.Body = body
	return s, nil
}

// splitSkillFrontmatter finds a frontmatter block without treating markdown
// horizontal rules or strings such as "---note" as delimiters. It preserves the
// original body bytes after the closing delimiter, including its line endings.
func splitSkillFrontmatter(text string) (frontmatter, body string, hasFrontmatter bool, err error) {
	first, rest, ok := nextLine(text)
	if !ok || first != "---" {
		return "", text, false, nil
	}
	var block strings.Builder
	for {
		line, remaining, ok := nextLine(rest)
		if !ok {
			return "", "", false, fmt.Errorf("frontmatter block not closed")
		}
		if line == "---" {
			return block.String(), remaining, true, nil
		}
		block.WriteString(line)
		if len(rest) > len(remaining)+len(line) {
			block.WriteByte('\n')
		}
		rest = remaining
	}
}

// nextLine returns one logical line without its line ending and the remaining
// text. It accepts LF and CRLF while preserving the remainder unchanged.
func nextLine(text string) (line, rest string, ok bool) {
	if text == "" {
		return "", "", false
	}
	idx := strings.IndexByte(text, '\n')
	if idx < 0 {
		return strings.TrimSuffix(text, "\r"), "", true
	}
	line = strings.TrimSuffix(text[:idx], "\r")
	return line, text[idx+1:], true
}
