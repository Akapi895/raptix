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
		"RAP_AUTH_MODE", "RAP_AUTH_ISSUER", "RAP_AUTH_AUDIENCE", "RAP_AUTH_DEVELOPMENT_PRINCIPAL",
		"RAP_DATABASE_URL", "RAP_DATABASE_MAX_CONNS", "RAP_DATABASE_CONNECT_TIMEOUT", "RAP_DATABASE_MIGRATION_LOCK_TIMEOUT",
		"RAP_LOG_LEVEL", "RAP_ARTIFACT_ROOT", "RAP_CONTENT_ROOT", "RAP_CONTENT_SCHEMA_ROOT",
		"RAP_EXECUTION_DEFAULT_TIMEOUT", "RAP_EXECUTION_MAX_OUTPUT_BYTES", "RAP_EXECUTION_MAX_INVOCATIONS_PER_RUN", "RAP_EXECUTION_RECONCILE_STALE_AFTER",
		"RAP_SANDBOX_MODE", "RAP_SANDBOX_IMAGE", "RAP_SANDBOX_NETWORK", "RAP_SANDBOX_MAX_OUTPUT_BYTES",
		"RAP_AGENT_MAX_STEPS", "RAP_AGENT_MAX_CONTEXT_TOKENS", "RAP_AGENT_DEFAULT_TIMEOUT", "RAP_AGENT_MODEL",
		"RAP_LLM_BASE_URL", "RAP_LLM_MODEL", "RAP_LLM_API_KEY", "RAP_LLM_TIMEOUT",
	} {
		t.Setenv(k, "")
	}
}

func TestLoadConfigValidatesAuthModes(t *testing.T) {
	cleanEnv(t)
	if _, err := LoadConfig(writeConfig(t, "auth:\n  mode: oidc\n")); err == nil {
		t.Fatal("OIDC mode without issuer/audience was accepted")
	}
	if _, err := LoadConfig(writeConfig(t, "auth:\n  mode: development\n  development_principal: ''\n")); err == nil {
		t.Fatal("development mode without fixed principal was accepted")
	}
	cfg, err := LoadConfig(writeConfig(t, "auth:\n  mode: oidc\n  issuer: https://issuer.example\n  audience: raptix\n"))
	if err != nil || cfg.Auth.Mode != "oidc" {
		t.Fatalf("valid OIDC config: %#v %v", cfg.Auth, err)
	}
}

// TestLoadConfigExampleConfigIsValid keeps the shipped example in sync with the
// Config struct: a stale example would silently drop settings on copy.
func TestLoadConfigExampleConfigIsValid(t *testing.T) {
	cleanEnv(t)
	path, err := filepath.Abs(filepath.Join("..", "..", "..", "configs", "app.example.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Skipf("example config not present: %v", err)
	}
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig(%s): %v", path, err)
	}
	if cfg.Execution.DefaultTimeout <= 0 || cfg.Sandbox.Mode == "" {
		t.Fatalf("example config did not populate execution/sandbox: %+v", cfg)
	}
}

func TestLoadConfigExecutionAndSandboxOverrides(t *testing.T) {
	cleanEnv(t)
	t.Setenv("RAP_EXECUTION_DEFAULT_TIMEOUT", "5s")
	t.Setenv("RAP_EXECUTION_MAX_OUTPUT_BYTES", "2048")
	t.Setenv("RAP_EXECUTION_MAX_INVOCATIONS_PER_RUN", "3")
	t.Setenv("RAP_EXECUTION_RECONCILE_STALE_AFTER", "90s")
	t.Setenv("RAP_SANDBOX_MODE", "local")
	t.Setenv("RAP_SANDBOX_NETWORK", "false")
	cfg, err := LoadConfig(writeConfig(t, ""))
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Execution.DefaultTimeout != 5*time.Second || cfg.Execution.MaxOutputBytes != 2048 || cfg.Execution.MaxInvocationsPerRun != 3 || cfg.Execution.ReconcileStaleAfter != 90*time.Second {
		t.Fatalf("execution overrides = %+v", cfg.Execution)
	}
	if cfg.Sandbox.Network {
		t.Fatalf("sandbox network override not applied: %+v", cfg.Sandbox)
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
