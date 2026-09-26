package content

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// ReportTemplate is declarative Markdown presentation content. The hash covers
// Body exactly, so a stored report can require the precise template revision.
type ReportTemplate struct {
	ID      string `yaml:"id"`
	Version string `yaml:"version"`
	MIME    string `yaml:"mime"`
	Hash    string `yaml:"hash"`
	Body    string `yaml:"body"`
}

var reportTemplateHash = regexp.MustCompile(`^[0-9a-f]{64}$`)

// LoadReportTemplate loads a template from templates/reports/<name>.yaml. It
// uses the same root-containment checks as manifests and only parses data; no
// template is executed while content is loaded.
func (l *Loader) LoadReportTemplate(name string) (*ReportTemplate, error) {
	if err := validateRel(name); err != nil || strings.ContainsRune(name, '/') {
		return nil, fmt.Errorf("invalid report template name %q", name)
	}
	path := filepath.Join(l.root, "templates", "reports", name+".yaml")
	if err := l.ensureContained(path); err != nil {
		return nil, fmt.Errorf("report template %s: %w", name, err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read report template %s: %w", name, err)
	}
	var tmpl ReportTemplate
	dec := yaml.NewDecoder(strings.NewReader(string(data)))
	dec.KnownFields(true)
	if err := dec.Decode(&tmpl); err != nil {
		return nil, fmt.Errorf("decode report template %s: %w", name, err)
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		if err != nil {
			return nil, fmt.Errorf("decode report template %s: %w", name, err)
		}
		return nil, fmt.Errorf("report template %s has multiple YAML documents", name)
	}
	tmpl.ID = strings.TrimSpace(tmpl.ID)
	tmpl.Version = strings.TrimSpace(tmpl.Version)
	tmpl.MIME = strings.TrimSpace(tmpl.MIME)
	tmpl.Hash = strings.ToLower(strings.TrimSpace(tmpl.Hash))
	if tmpl.ID == "" || tmpl.Version == "" || tmpl.Body == "" {
		return nil, fmt.Errorf("report template %s requires id, version, and body", name)
	}
	if tmpl.MIME != "text/markdown" {
		return nil, fmt.Errorf("report template %s MIME must be text/markdown", name)
	}
	if !reportTemplateHash.MatchString(tmpl.Hash) {
		return nil, fmt.Errorf("report template %s hash must be a lowercase SHA-256 hex string", name)
	}
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(tmpl.Body)))
	if tmpl.Hash != digest {
		return nil, fmt.Errorf("report template %s hash does not match body", name)
	}
	return &tmpl, nil
}
