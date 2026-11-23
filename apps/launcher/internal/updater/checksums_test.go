package updater

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Cover text and binary-mode sha256sum entries and blank lines.
func TestParseChecksumManifest(t *testing.T) {
	in := strings.NewReader(strings.Join([]string{
		"",                                                                       // blank line — must be skipped
		"abc123  raptix-linux-amd64",                                         // standard
		"deadbeef *config-checksums.txt",                                         // sha256sum binary-mode marker
		"  feedface  docker-compose.yml  ",                                       // leading/trailing whitespace
		"cafebabec0ffee deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", // single-space sep
	}, "\n"))

	m, err := parseChecksumManifest(in)
	if err != nil {
		t.Fatalf("parseChecksumManifest returned error: %v", err)
	}

	cases := map[string]string{
		"raptix-linux-amd64": "abc123",
		"config-checksums.txt":   "deadbeef",
		"docker-compose.yml":     "feedface",
	}
	for path, want := range cases {
		got, ok := m[path]
		if !ok {
			t.Errorf("missing entry for %q", path)
			continue
		}
		if got != want {
			t.Errorf("entry %q: got %q, want %q", path, got, want)
		}
	}
}

func TestParseChecksumManifestRejectsMalformed(t *testing.T) {
	_, err := parseChecksumManifest(strings.NewReader("only-one-field"))
	if err == nil {
		t.Fatal("expected error for malformed line, got nil")
	}
}

func TestSha256FileAndVerify(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "payload")
	if err := os.WriteFile(target, []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// SHA-256 of hello followed by a newline.
	const wantHash = "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03"

	got, err := sha256File(target)
	if err != nil {
		t.Fatalf("sha256File: %v", err)
	}
	if got != wantHash {
		t.Fatalf("sha256File: got %q, want %q", got, wantHash)
	}

	manifest := map[string]string{"payload": wantHash}
	if err := verifyAgainstManifest(target, "payload", manifest); err != nil {
		t.Errorf("verifyAgainstManifest happy path: %v", err)
	}

	bad := map[string]string{"payload": "0000000000000000000000000000000000000000000000000000000000000000"}
	if err := verifyAgainstManifest(target, "payload", bad); err == nil {
		t.Error("verifyAgainstManifest: expected mismatch error, got nil")
	}

	missing := map[string]string{}
	if err := verifyAgainstManifest(target, "payload", missing); err == nil {
		t.Error("verifyAgainstManifest: expected missing-entry error, got nil")
	}
}
