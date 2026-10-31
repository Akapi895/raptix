package cmd

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/Akapi895/raptix/apps/launcher/internal/config"
)

func writeTestEnvFile(t *testing.T, home string, lines ...string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(home, ".env"), []byte(joinLines(lines)), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}
}

func joinLines(lines []string) string {
	out := ""
	for i, l := range lines {
		if i > 0 {
			out += "\n"
		}
		out += l
	}
	return out
}

func TestResolveControllerSettingsDefaults(t *testing.T) {
	home := t.TempDir()
	t.Setenv("RAPTIX_HOME", home)
	os.Unsetenv("RAPTIX_SANDBOX_SECRETS_DIR")
	os.Unsetenv("RAPTIX_STACK_SANDBOX_NETWORK")
	os.Unsetenv("RAPTIX_VERSION")

	s, err := resolveControllerSettings(controllerFlags{})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if s.secretsDir != filepath.Join(home, "sandbox-secrets") {
		t.Errorf("secretsDir = %q", s.secretsDir)
	}
	if s.home != home {
		t.Errorf("home = %q, want parent of secrets dir %q", s.home, home)
	}
	if s.network != "raptix_sandbox-net" {
		t.Errorf("network = %q", s.network)
	}
	if s.image != "ghcr.io/akapi895/raptix-sandbox:stable" {
		t.Errorf("image = %q", s.image)
	}
	if s.listen != "127.0.0.1:9200" {
		t.Errorf("listen = %q", s.listen)
	}
}

func TestResolveControllerSettingsDotEnvAndFlags(t *testing.T) {
	home := t.TempDir()
	t.Setenv("RAPTIX_HOME", home)
	os.Unsetenv("RAPTIX_SANDBOX_SECRETS_DIR")
	os.Unsetenv("RAPTIX_STACK_SANDBOX_NETWORK")
	os.Unsetenv("RAPTIX_VERSION")
	writeTestEnvFile(t, home,
		"RAPTIX_SANDBOX_SECRETS_DIR=D:/deploy/.raptix/sandbox-secrets",
		"RAPTIX_STACK_SANDBOX_NETWORK=raptix_lab_sandbox-net",
		"RAPTIX_VERSION=dev",
	)

	// .env wins over defaults when no flag and no process env is set.
	s, err := resolveControllerSettings(controllerFlags{})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if s.secretsDir != "D:/deploy/.raptix/sandbox-secrets" {
		t.Errorf("secretsDir = %q", s.secretsDir)
	}
	if s.home != filepath.Dir("D:/deploy/.raptix/sandbox-secrets") {
		t.Errorf("home = %q", s.home)
	}
	if s.network != "raptix_lab_sandbox-net" {
		t.Errorf("network = %q", s.network)
	}
	if s.image != "ghcr.io/akapi895/raptix-sandbox:dev" {
		t.Errorf("image = %q", s.image)
	}

	// Process env beats .env.
	t.Setenv("RAPTIX_STACK_SANDBOX_NETWORK", "env-net")
	s, err = resolveControllerSettings(controllerFlags{})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if s.network != "env-net" {
		t.Errorf("network = %q, want env-net to beat .env", s.network)
	}

	// Flags beat everything.
	s, err = resolveControllerSettings(controllerFlags{
		secretsDir: "C:/x/secrets",
		network:    "flag-net",
		image:      "img:1",
		listen:     "127.0.0.1:9300",
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if s.secretsDir != "C:/x/secrets" || s.network != "flag-net" || s.image != "img:1" || s.listen != "127.0.0.1:9300" {
		t.Errorf("flags did not win: %+v", s)
	}
	if s.home != filepath.Dir("C:/x/secrets") {
		t.Errorf("home = %q", s.home)
	}
}

func TestReadControllerPID(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "controller.pid")

	if _, alive := readControllerPID(path); alive {
		t.Fatal("missing pid file reads as running")
	}
	if err := os.WriteFile(path, []byte("not-a-pid"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, alive := readControllerPID(path); alive {
		t.Fatal("garbage pid file reads as running")
	}
	if err := os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	pid, alive := readControllerPID(path)
	if !alive || pid != os.Getpid() {
		t.Fatalf("live pid not detected: pid=%d alive=%v", pid, alive)
	}
	if err := os.WriteFile(path, []byte("99999999"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, alive := readControllerPID(path); alive {
		t.Fatal("stale pid reads as running")
	}
}

func TestControllerPaths(t *testing.T) {
	s := controllerSettings{home: "H", secretsDir: filepath.Join("H", "secrets")}
	if got := controllerDir(s); got != filepath.Join("H", "web-sandboxes") {
		t.Errorf("controllerDir = %q", got)
	}
	if got := controllerPIDPath(s); got != filepath.Join("H", "web-sandboxes", "controller.pid") {
		t.Errorf("controllerPIDPath = %q", got)
	}
	if got := controllerLogPath(s); got != filepath.Join("H", "web-sandboxes", "controller.log") {
		t.Errorf("controllerLogPath = %q", got)
	}
	if config.RaptixHome() == "" {
		t.Fatal("RaptixHome empty")
	}
}
