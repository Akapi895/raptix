package app

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the application configuration, loaded at the composition root.
// Sources in order: defaults, optional YAML, then RAP_* environment overrides.
type Config struct {
	Server    ServerConfig    `yaml:"server"`
	Database  DatabaseConfig  `yaml:"database"`
	Artifact  ArtifactConfig  `yaml:"artifact"`
	Content   ContentConfig   `yaml:"content"`
	Execution ExecutionConfig `yaml:"execution"`
	Sandbox   SandboxConfig   `yaml:"sandbox"`
	Agent     AgentConfig     `yaml:"agent"`
	LLM       LLMConfig       `yaml:"llm"`
	Log       LogConfig       `yaml:"log"`
}

type ServerConfig struct {
	Addr            string        `yaml:"addr"`
	ShutdownTimeout time.Duration `yaml:"shutdown_timeout"`
}

type DatabaseConfig struct {
	URL                  string        `yaml:"url"`
	MaxConns             int32         `yaml:"max_conns"`
	ConnectTimeout       time.Duration `yaml:"connect_timeout"`
	MigrationLockTimeout time.Duration `yaml:"migration_lock_timeout"`
}

type ArtifactConfig struct {
	Root string `yaml:"root"`
}

type ContentConfig struct {
	Root       string `yaml:"root"`
	SchemaRoot string `yaml:"schema_root"`
}

// ExecutionConfig bounds capability dispatch: how long a capability may run, how
// much output it may produce, how many invocations a single run may make, and
// how old a non-terminal invocation must be before startup reconcile treats it
// as stale.
type ExecutionConfig struct {
	DefaultTimeout       time.Duration `yaml:"default_timeout"`
	MaxOutputBytes       int64         `yaml:"max_output_bytes"`
	MaxInvocationsPerRun int           `yaml:"max_invocations_per_run"`
	ReconcileStaleAfter  time.Duration `yaml:"reconcile_stale_after"`
}

// SandboxConfig selects the environment command capabilities run in. Local is
// the lab default; container is the production boundary.
type SandboxConfig struct {
	Mode           string `yaml:"mode"` // local | container
	Image          string `yaml:"image"`
	Network        bool   `yaml:"network"`
	MaxOutputBytes int64  `yaml:"max_output_bytes"`
}

// AgentConfig bounds the agent loop: how many model/tool steps one attempt may
// take, how large the assembled context may be, and the attempt timeout.
type AgentConfig struct {
	MaxSteps         int           `yaml:"max_steps"`
	MaxContextTokens int           `yaml:"max_context_tokens"`
	DefaultTimeout   time.Duration `yaml:"default_timeout"`
	Model            string        `yaml:"model"`
}

// LLMConfig configures the model provider (OpenAI-compatible endpoint).
type LLMConfig struct {
	BaseURL string        `yaml:"base_url"`
	Model   string        `yaml:"model"`
	APIKey  string        `yaml:"api_key"`
	Timeout time.Duration `yaml:"timeout"`
}

type LogConfig struct {
	Level string `yaml:"level"`
}

// LoadConfig reads the YAML file (if present) then applies RAP_* env overrides.
func LoadConfig(path string) (*Config, error) {
	cfg := defaults()

	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			if !os.IsNotExist(err) {
				return nil, fmt.Errorf("read config %s: %w", path, err)
			}
			// missing file: fall through to defaults + env
		} else if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parse config %s: %w", path, err)
		}
	}

	if err := applyEnvOverrides(cfg); err != nil {
		return nil, err
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func defaults() *Config {
	return &Config{
		Server: ServerConfig{
			Addr:            ":8080",
			ShutdownTimeout: 10 * time.Second,
		},
		Database: DatabaseConfig{
			URL:                  "postgres://raptix:raptix@localhost:5432/raptix?sslmode=disable",
			MaxConns:             10,
			ConnectTimeout:       5 * time.Second,
			MigrationLockTimeout: 15 * time.Second,
		},
		Artifact: ArtifactConfig{Root: "./data/artifacts"},
		Content:  ContentConfig{Root: "./content", SchemaRoot: "./contracts/manifests"},
		Execution: ExecutionConfig{
			DefaultTimeout:       30 * time.Second,
			MaxOutputBytes:       1 << 20,
			MaxInvocationsPerRun: 100,
			ReconcileStaleAfter:  5 * time.Minute,
		},
		Sandbox: SandboxConfig{
			Mode:           "local",
			Image:          "raptix/sandbox:latest",
			Network:        true,
			MaxOutputBytes: 1 << 20,
		},
		Agent: AgentConfig{
			MaxSteps:         8,
			MaxContextTokens: 16000,
			DefaultTimeout:   2 * time.Minute,
		},
		LLM: LLMConfig{
			BaseURL: "https://stream-netmind.viettel.vn/aigw/ai/v1",
			Model:   "MiniMax/MiniMax-M3-VIP",
			Timeout: 60 * time.Second,
		},
		Log: LogConfig{Level: "info"},
	}
}

// applyEnvOverrides applies RAP_* overrides, returning an error for invalid
// numeric/duration values so a mistyped override is not silently ignored.
func applyEnvOverrides(cfg *Config) error {
	cfg.Database.URL = envOr("RAP_DATABASE_URL", cfg.Database.URL)
	cfg.Server.Addr = envOr("RAP_SERVER_ADDR", cfg.Server.Addr)
	cfg.Log.Level = envOr("RAP_LOG_LEVEL", cfg.Log.Level)
	cfg.Artifact.Root = envOr("RAP_ARTIFACT_ROOT", cfg.Artifact.Root)
	cfg.Content.Root = envOr("RAP_CONTENT_ROOT", cfg.Content.Root)
	cfg.Content.SchemaRoot = envOr("RAP_CONTENT_SCHEMA_ROOT", cfg.Content.SchemaRoot)

	if v, ok := os.LookupEnv("RAP_DATABASE_MAX_CONNS"); ok && v != "" {
		n, err := strconv.ParseInt(v, 10, 32)
		if err != nil {
			return fmt.Errorf("RAP_DATABASE_MAX_CONNS: invalid integer %q: %w", v, err)
		}
		cfg.Database.MaxConns = int32(n)
	}
	if v, ok := os.LookupEnv("RAP_SERVER_SHUTDOWN_TIMEOUT"); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("RAP_SERVER_SHUTDOWN_TIMEOUT: invalid duration %q: %w", v, err)
		}
		cfg.Server.ShutdownTimeout = d
	}
	if v, ok := os.LookupEnv("RAP_DATABASE_CONNECT_TIMEOUT"); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("RAP_DATABASE_CONNECT_TIMEOUT: invalid duration %q: %w", v, err)
		}
		cfg.Database.ConnectTimeout = d
	}
	if v, ok := os.LookupEnv("RAP_DATABASE_MIGRATION_LOCK_TIMEOUT"); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("RAP_DATABASE_MIGRATION_LOCK_TIMEOUT: invalid duration %q: %w", v, err)
		}
		cfg.Database.MigrationLockTimeout = d
	}

	if v, ok := os.LookupEnv("RAP_EXECUTION_DEFAULT_TIMEOUT"); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("RAP_EXECUTION_DEFAULT_TIMEOUT: invalid duration %q: %w", v, err)
		}
		cfg.Execution.DefaultTimeout = d
	}
	if v, ok := os.LookupEnv("RAP_EXECUTION_MAX_OUTPUT_BYTES"); ok && v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return fmt.Errorf("RAP_EXECUTION_MAX_OUTPUT_BYTES: invalid integer %q: %w", v, err)
		}
		cfg.Execution.MaxOutputBytes = n
	}
	if v, ok := os.LookupEnv("RAP_EXECUTION_MAX_INVOCATIONS_PER_RUN"); ok && v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("RAP_EXECUTION_MAX_INVOCATIONS_PER_RUN: invalid integer %q: %w", v, err)
		}
		cfg.Execution.MaxInvocationsPerRun = n
	}
	if v, ok := os.LookupEnv("RAP_EXECUTION_RECONCILE_STALE_AFTER"); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("RAP_EXECUTION_RECONCILE_STALE_AFTER: invalid duration %q: %w", v, err)
		}
		cfg.Execution.ReconcileStaleAfter = d
	}
	cfg.Sandbox.Mode = envOr("RAP_SANDBOX_MODE", cfg.Sandbox.Mode)
	cfg.Sandbox.Image = envOr("RAP_SANDBOX_IMAGE", cfg.Sandbox.Image)
	if v, ok := os.LookupEnv("RAP_SANDBOX_NETWORK"); ok && v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("RAP_SANDBOX_NETWORK: invalid bool %q: %w", v, err)
		}
		cfg.Sandbox.Network = b
	}
	if v, ok := os.LookupEnv("RAP_SANDBOX_MAX_OUTPUT_BYTES"); ok && v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return fmt.Errorf("RAP_SANDBOX_MAX_OUTPUT_BYTES: invalid integer %q: %w", v, err)
		}
		cfg.Sandbox.MaxOutputBytes = n
	}
	if v, ok := os.LookupEnv("RAP_AGENT_MAX_STEPS"); ok && v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("RAP_AGENT_MAX_STEPS: invalid integer %q: %w", v, err)
		}
		cfg.Agent.MaxSteps = n
	}
	if v, ok := os.LookupEnv("RAP_AGENT_MAX_CONTEXT_TOKENS"); ok && v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("RAP_AGENT_MAX_CONTEXT_TOKENS: invalid integer %q: %w", v, err)
		}
		cfg.Agent.MaxContextTokens = n
	}
	if v, ok := os.LookupEnv("RAP_AGENT_DEFAULT_TIMEOUT"); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("RAP_AGENT_DEFAULT_TIMEOUT: invalid duration %q: %w", v, err)
		}
		cfg.Agent.DefaultTimeout = d
	}
	cfg.Agent.Model = envOr("RAP_AGENT_MODEL", cfg.Agent.Model)

	cfg.LLM.BaseURL = envOr("RAP_LLM_BASE_URL", cfg.LLM.BaseURL)
	cfg.LLM.Model = envOr("RAP_LLM_MODEL", cfg.LLM.Model)
	cfg.LLM.APIKey = envOr("RAP_LLM_API_KEY", cfg.LLM.APIKey)
	if v, ok := os.LookupEnv("RAP_LLM_TIMEOUT"); ok && v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("RAP_LLM_TIMEOUT: invalid duration %q: %w", v, err)
		}
		cfg.LLM.Timeout = d
	}
	return nil
}

func (c *Config) validate() error {
	if c.Database.URL == "" {
		return fmt.Errorf("database.url is required")
	}
	switch c.Log.Level {
	case "debug", "info", "warn", "error":
	default:
		return fmt.Errorf("log.level %q is invalid (debug|info|warn|error)", c.Log.Level)
	}
	if c.Server.ShutdownTimeout <= 0 {
		return fmt.Errorf("server.shutdown_timeout must be positive, got %s", c.Server.ShutdownTimeout)
	}
	if c.Database.ConnectTimeout <= 0 {
		return fmt.Errorf("database.connect_timeout must be positive, got %s", c.Database.ConnectTimeout)
	}
	if c.Database.MigrationLockTimeout <= 0 {
		return fmt.Errorf("database.migration_lock_timeout must be positive, got %s", c.Database.MigrationLockTimeout)
	}
	if c.Database.MaxConns <= 0 {
		return fmt.Errorf("database.max_conns must be positive, got %d", c.Database.MaxConns)
	}
	if c.Execution.DefaultTimeout <= 0 {
		return fmt.Errorf("execution.default_timeout must be positive, got %s", c.Execution.DefaultTimeout)
	}
	if c.Execution.MaxOutputBytes <= 0 {
		return fmt.Errorf("execution.max_output_bytes must be positive, got %d", c.Execution.MaxOutputBytes)
	}
	if c.Execution.MaxInvocationsPerRun < 0 {
		return fmt.Errorf("execution.max_invocations_per_run must not be negative, got %d", c.Execution.MaxInvocationsPerRun)
	}
	if c.Execution.ReconcileStaleAfter <= 0 {
		return fmt.Errorf("execution.reconcile_stale_after must be positive, got %s", c.Execution.ReconcileStaleAfter)
	}
	switch c.Sandbox.Mode {
	case "local", "container":
	default:
		return fmt.Errorf("sandbox.mode %q is invalid (local|container)", c.Sandbox.Mode)
	}
	if c.Sandbox.Mode == "container" && c.Sandbox.Image == "" {
		return fmt.Errorf("sandbox.image is required when sandbox.mode is container")
	}
	if c.Sandbox.MaxOutputBytes <= 0 {
		return fmt.Errorf("sandbox.max_output_bytes must be positive, got %d", c.Sandbox.MaxOutputBytes)
	}
	if c.Agent.MaxSteps <= 0 {
		return fmt.Errorf("agent.max_steps must be positive, got %d", c.Agent.MaxSteps)
	}
	if c.Agent.MaxContextTokens <= 0 {
		return fmt.Errorf("agent.max_context_tokens must be positive, got %d", c.Agent.MaxContextTokens)
	}
	if c.Agent.DefaultTimeout <= 0 {
		return fmt.Errorf("agent.default_timeout must be positive, got %s", c.Agent.DefaultTimeout)
	}
	if c.LLM.BaseURL == "" {
		return fmt.Errorf("llm.base_url must not be empty")
	}
	u, err := url.ParseRequestURI(c.LLM.BaseURL)
	if err != nil || u.Scheme == "" || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("llm.base_url must be an absolute http(s) URL")
	}
	if c.LLM.Model == "" {
		return fmt.Errorf("llm.model must not be empty")
	}
	if c.LLM.Timeout <= 0 {
		return fmt.Errorf("llm.timeout must be positive, got %s", c.LLM.Timeout)
	}
	return nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
