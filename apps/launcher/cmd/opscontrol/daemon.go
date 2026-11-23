package opscontrol

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"

	internal "github.com/Akapi895/raptix/apps/launcher/internal/opscontrol"
	"github.com/spf13/cobra"
)

var daemonCmd = &cobra.Command{
	Use:   "daemon",
	Short: "Run the opscontrol daemon in the foreground",
	Long: `Runs the opscontrol HTTP server on the Unix domain socket at
$RAPTIX_HOME/run/ops.sock. Intended to be supervised by
` + "`raptix start`" + ` (which spawns it detached and writes the
PID file). Operators can also invoke it directly for debugging:

    RAPTIX_HOME=/tmp/dogfood raptix opscontrol daemon

ADR-0006 §1' is the authoritative spec.`,
	RunE: runDaemon,
}

func runDaemon(_ *cobra.Command, _ []string) error {
	if err := internal.EnsureRunDir(); err != nil {
		return fmt.Errorf("opscontrol: ensure run dir: %w", err)
	}

	allow, err := internal.LoadAllowlist()
	if err != nil {
		return err
	}

	backend := internal.NewDockerComposeBackend()

	// Use the launcher overlay so the runtime mounts the daemon socket.
	overridePath := filepath.Join(filepath.Dir(backend.ComposeFile), "docker-compose.opscontrol.yml")
	if _, err := os.Stat(overridePath); err == nil {
		backend.ExtraFiles = append(backend.ExtraFiles, overridePath)
	}

	// Export the host socket before Compose interpolates the overlay.
	if err := os.Setenv("RAPTIX_OPSCONTROL_SOCK_HOST", internal.HostSocketPath()); err != nil {
		return fmt.Errorf("opscontrol: export socket path: %w", err)
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	server := internal.NewServer(backend, allow, logger)

	// Record the daemon's own PID even when it runs in the foreground.
	pidPath := internal.PIDFilePath()
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		return fmt.Errorf("opscontrol: write pid file: %w", err)
	}
	defer os.Remove(pidPath)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	socketPath := internal.HostSocketPath()
	logger.Info("opscontrol daemon up",
		"socket", socketPath,
		"backend", backend.Name(),
		"allowlist_size", len(allow.Members()),
	)

	if err := server.Listen(ctx, socketPath); err != nil && err != context.Canceled {
		return err
	}
	logger.Info("opscontrol daemon stopped")
	return nil
}
