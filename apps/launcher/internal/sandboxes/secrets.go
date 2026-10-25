package sandboxes

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// KeyFile holds the HMAC key that derives every project sandbox token. Sandboxes never receive it: each container
// gets only its own derived token, so one project cannot compute another project's token.
const KeyFile = "sandbox-key"

// ControllerTokenFile holds the bearer token the web API presents to the sandbox controller.
const ControllerTokenFile = "controller-token"

// RuntimeAPITokenFile holds the token the LangGraph API requires of every caller. Only the web API and the runtime
// mount it. Sandboxes never receive it, so a command inside a sandbox cannot start or read runs.
const RuntimeAPITokenFile = "runtime-api-token"

const minSecretLen = 32

// TokenFor returns the bearer token of one project's sandbox. The web API derives the same value from the same key,
// so it can address each run to that project's sandbox and to no other.
func TokenFor(key, slug string) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte("sandbox-token:" + slug))
	return hex.EncodeToString(mac.Sum(nil))
}

// ReadSecret returns the trimmed content of a secret file, which must hold at least 32 bytes.
func ReadSecret(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read secret %s: %w", filepath.Base(path), err)
	}
	value := strings.TrimSpace(string(raw))
	if len(value) < minSecretLen {
		return "", fmt.Errorf("secret %s must be at least %d bytes", filepath.Base(path), minSecretLen)
	}
	return value, nil
}

// InitSecrets creates the sandbox key, the controller token and the runtime API token in dir with mode 0600. An existing file is kept, so a rerun
// never rotates a key that running sandboxes were started with.
func InitSecrets(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create secrets directory: %w", err)
	}
	for _, name := range []string{KeyFile, ControllerTokenFile, RuntimeAPITokenFile} {
		path := filepath.Join(dir, name)
		if _, err := os.Stat(path); err == nil {
			continue
		} else if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("check %s: %w", name, err)
		}
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			return fmt.Errorf("generate %s: %w", name, err)
		}
		if err := os.WriteFile(path, []byte(hex.EncodeToString(buf)+"\n"), 0o600); err != nil {
			return fmt.Errorf("write %s: %w", name, err)
		}
	}
	return nil
}
