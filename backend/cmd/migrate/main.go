// Command migrate runs goose migrations as a separate release step.
// Run from backend/: go run ./cmd/migrate -command up -dir migrations
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	stdlib "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"

	"github.com/Akapi895/raptix/backend/internal/app"
	"github.com/Akapi895/raptix/backend/internal/infrastructure/jobs"
)

func run(args []string) error {
	var (
		configPath string
		dir        string
		command    string
	)
	fs := flag.NewFlagSet("migrate", flag.ContinueOnError)
	fs.StringVar(&configPath, "config", "", "path to config YAML (default ../configs/app.yaml)")
	fs.StringVar(&dir, "dir", "migrations", "migrations directory (relative to CWD)")
	fs.StringVar(&command, "command", "up", "goose command: up | down | status | version")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %v", fs.Args())
	}

	switch command {
	case "up", "down", "status", "version":
	default:
		return fmt.Errorf("unknown command %q (want up|down|status|version)", command)
	}
	if configPath == "" {
		configPath = "../configs/app.yaml"
	}

	cfg, err := app.LoadConfig(configPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	connCfg, err := pgx.ParseConfig(cfg.Database.URL)
	if err != nil {
		return fmt.Errorf("parse database url: %w", err)
	}
	connCfg.ConnectTimeout = cfg.Database.ConnectTimeout

	db := stdlib.OpenDB(*connCfg)
	defer func() { _ = db.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), cfg.Database.ConnectTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}

	period := uint64(1)
	threshold := uint64(timeoutSeconds(cfg.Database.MigrationLockTimeout))
	locker, err := lock.NewPostgresSessionLocker(lock.WithLockTimeout(period, threshold))
	if err != nil {
		return fmt.Errorf("init migration locker: %w", err)
	}

	provider, err := goose.NewProvider(
		goose.DialectPostgres, db, os.DirFS(dir),
		goose.WithSessionLocker(locker),
	)
	if err != nil {
		return fmt.Errorf("init goose provider: %w", err)
	}

	// River owns its own schema and migrations. They run in the same release
	// step as goose but are applied separately, never by the HTTP server.
	pool, err := pgxpool.New(ctx, cfg.Database.URL)
	if err != nil {
		return fmt.Errorf("open jobs pool: %w", err)
	}
	defer pool.Close()

	switch command {
	case "up":
		res, err := provider.Up(ctx)
		if err != nil {
			return fmt.Errorf("goose up: %w", err)
		}
		for _, r := range res {
			if r.Source != nil {
				fmt.Printf("  applied %s (%s)\n", r.Source.Path, r.Duration)
			}
		}
		if err := jobs.Migrate(ctx, pool); err != nil {
			return err
		}
		fmt.Println("  applied river migrations")
	case "down":
		// Reverse order: the queue schema is removed before application tables.
		if err := jobs.MigrateDown(ctx, pool); err != nil {
			return err
		}
		fmt.Println("  reverted one river migration")
		res, err := provider.Down(ctx)
		if err != nil {
			return fmt.Errorf("goose down: %w", err)
		}
		if res != nil && res.Source != nil {
			fmt.Printf("  reverted %s\n", res.Source.Path)
		}
	case "version":
		v, err := provider.GetDBVersion(ctx)
		if err != nil {
			return fmt.Errorf("goose version: %w", err)
		}
		fmt.Printf("database version: %d\n", v)
	case "status":
		st, err := provider.Status(ctx)
		if err != nil {
			return fmt.Errorf("goose status: %w", err)
		}
		for _, s := range st {
			if s.Source == nil {
				continue
			}
			fmt.Printf("  %-20s %-8s %s\n", s.Source.Path, s.State, s.AppliedAt.Format("2006-01-02 15:04:05"))
		}
		ok, messages, err := jobs.Status(ctx, pool)
		if err != nil {
			return err
		}
		switch {
		case ok:
			fmt.Println("river migrations: applied")
		default:
			fmt.Println("river migrations: pending")
			for _, message := range messages {
				fmt.Printf("  %s\n", message)
			}
		}
	}
	return nil
}

// timeoutSeconds returns d rounded up to whole seconds, at least 1.
func timeoutSeconds(d time.Duration) int64 {
	s := int64(d / time.Second)
	if d%time.Second != 0 {
		s++
	}
	if s < 1 {
		return 1
	}
	return s
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		os.Exit(1)
	}
}
