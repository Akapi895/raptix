package app

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the application configuration, loaded at the composition root.
// Sources in order: defaults, optional YAML, then RAP_* environment overrides.
type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Artifact ArtifactConfig `yaml:"artifact"`
	Content  ContentConfig  `yaml:"content"`
	Log      LogConfig      `yaml:"log"`
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
	Root string `yaml:"root"`
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
		Content:  ContentConfig{Root: "./content"},
		Log:      LogConfig{Level: "info"},
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
	return nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
