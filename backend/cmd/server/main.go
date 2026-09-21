// Command server is the sole HTTP host for the platform.
// Run from backend/: go run ./cmd/server -config ../configs/app.yaml
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/Akapi895/raptix/backend/internal/app"
)

func run() error {
	configPath := flag.String("config", "../configs/app.yaml", "path to config YAML")
	flag.Parse()

	cfg, err := app.LoadConfig(*configPath)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	log := app.NewLogger(cfg.Log.Level)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	application, err := app.New(cfg, log)
	if err != nil {
		return fmt.Errorf("initialize application: %w", err)
	}

	if err := application.Run(ctx); err != nil {
		if errors.Is(err, context.Canceled) {
			return nil
		}
		return fmt.Errorf("run server: %w", err)
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
}
