package sandboxes

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The same vector is asserted by apps/web/server/tests/sandbox-token.test.ts, so the launcher and the web API derive
// identical project tokens.
func TestTokenForMatchesTheWebServerDerivation(t *testing.T) {
	const want = "3b5d7e4b801cb8f017ef2e4d1037d3d8780b6675e37baac28ba6bf9be04f50a3"
	if got := TokenFor("0123456789abcdef0123456789abcdef", "lab-a"); got != want {
		t.Fatalf("TokenFor = %s, want %s", got, want)
	}
}

func TestTokenForIsDistinctPerProject(t *testing.T) {
	key := "0123456789abcdef0123456789abcdef"
	if TokenFor(key, "lab-a") == TokenFor(key, "lab-b") {
		t.Fatal("two projects share a sandbox token")
	}
}

func TestInitSecretsCreatesOnceAndNeverRotates(t *testing.T) {
	dir := t.TempDir()
	if err := InitSecrets(dir); err != nil {
		t.Fatal(err)
	}
	first, err := ReadSecret(filepath.Join(dir, KeyFile))
	if err != nil {
		t.Fatal(err)
	}
	if err := InitSecrets(dir); err != nil {
		t.Fatal(err)
	}
	second, err := ReadSecret(filepath.Join(dir, KeyFile))
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatal("a rerun rotated the sandbox key, which would orphan every running sandbox")
	}
	// Windows does not apply POSIX mode bits to files; there the file is protected by its ACL instead.
	if runtime.GOOS == "windows" {
		return
	}
	info, err := os.Stat(filepath.Join(dir, ControllerTokenFile))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		t.Errorf("controller token is readable by others: %v", info.Mode().Perm())
	}
}

func TestReadSecretRejectsShortValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), KeyFile)
	if err := os.WriteFile(path, []byte("short\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadSecret(path); err == nil || strings.Contains(err.Error(), "short") {
		t.Fatalf("ReadSecret = %v, want a length error that does not echo the secret", err)
	}
}
