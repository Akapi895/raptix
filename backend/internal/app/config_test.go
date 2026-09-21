package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func parseYAML(t *testing.T, body string) *Config {
	t.Helper()
	cleanEnv(t)
	cfg, err := LoadConfig(writeConfig(t, body))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	return cfg
}

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "app.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

// cleanEnv isolates tests from the host's RAP_* variables (empty value -> default).
func cleanEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"RAP_SERVER_ADDR", "RAP_SERVER_SHUTDOWN_TIMEOUT",
		"RAP_DATABASE_URL", "RAP_DATABASE_MAX_CONNS", "RAP_DATABASE_CONNECT_TIMEOUT", "RAP_DATABASE_MIGRATION_LOCK_TIMEOUT",
		"RAP_LOG_LEVEL", "RAP_ARTIFACT_ROOT", "RAP_CONTENT_ROOT",
	} {
		t.Setenv(k, "")
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	cfg := parseYAML(t, "")
	if cfg.Server.Addr != ":8080" {
		t.Errorf("default addr = %q, want :8080", cfg.Server.Addr)
	}
	if cfg.Database.URL == "" {
		t.Error("default database.url must not be empty")
	}
	if cfg.Log.Level != "info" {
		t.Errorf("default log level = %q, want info", cfg.Log.Level)
	}
}

func TestLoadConfigRejectsNonPositiveTimeouts(t *testing.T) {
	cases := map[string]string{
		"shutdown":       "server:\n  shutdown_timeout: 0s\n",
		"connect":        "database:\n  connect_timeout: -1s\n",
		"migration_lock": "database:\n  migration_lock_timeout: 0s\n",
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			cleanEnv(t)
			if _, err := LoadConfig(writeConfig(t, body)); err == nil {
				t.Fatal("expected error for non-positive timeout")
			}
		})
	}
}

func TestLoadConfigRejectsInvalidLogLevel(t *testing.T) {
	cleanEnv(t)
	t.Setenv("RAP_LOG_LEVEL", "trace")
	if _, err := LoadConfig(""); err == nil {
		t.Fatal("expected error for invalid log level")
	}
}

func TestEnvOverridesParseError(t *testing.T) {
	cleanEnv(t)
	t.Setenv("RAP_DATABASE_MAX_CONNS", "not-a-number")
	if _, err := LoadConfig(""); err == nil {
		t.Fatal("expected parse error for invalid RAP_DATABASE_MAX_CONNS")
	}
}

func TestEnvOverridesApplied(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "app.yaml")
	if err := os.WriteFile(path, []byte(""), 0o600); err != nil {
		t.Fatal(err)
	}
	cleanEnv(t)
	t.Setenv("RAP_SERVER_ADDR", ":9999")
	t.Setenv("RAP_SERVER_SHUTDOWN_TIMEOUT", "3s")
	t.Setenv("RAP_DATABASE_MIGRATION_LOCK_TIMEOUT", "7s")

	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Server.Addr != ":9999" {
		t.Errorf("addr = %q, want :9999", cfg.Server.Addr)
	}
	if cfg.Server.ShutdownTimeout != 3*time.Second {
		t.Errorf("shutdown timeout = %s, want 3s", cfg.Server.ShutdownTimeout)
	}
	if cfg.Database.MigrationLockTimeout != 7*time.Second {
		t.Errorf("migration lock timeout = %s, want 7s", cfg.Database.MigrationLockTimeout)
	}
}
