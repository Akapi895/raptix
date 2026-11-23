package opscontrol

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	internal "github.com/Akapi895/raptix/apps/launcher/internal/opscontrol"
)

// composeOverlayBody mounts the daemon socket in LangGraph and ships with the launcher.
const composeOverlayBody = `# docker-compose.opscontrol.yml — LAUNCHER-MANAGED runtime overlay (ADR-0006).
# Do NOT hand-edit. The launcher rewrites this file on every ` + "`raptix start`" + `
# (cmd/opscontrol/supervisor.go:writeComposeOverlay) so any manual edits are
# erased on the next boot.
#
# RAPTIX_OPSCONTROL_SOCK_HOST is REQUIRED at compose interpolation
# time. There is no '/dev/null' fallback: a missing socket path means
# the daemon wiring is broken, and we'd rather fail at boot than mount
# a character device into the container and surface ECONNREFUSED
# mid-engagement.

services:
  langgraph:
    volumes:
      - "${RAPTIX_OPSCONTROL_SOCK_HOST}:/var/run/raptix-ops.sock:rw"
`

// writeComposeOverlay refreshes the launcher-managed Compose file.
func writeComposeOverlay() error {
	target := filepath.Join(config.RaptixHome(), "docker-compose.opscontrol.yml")
	return os.WriteFile(target, []byte(composeOverlayBody), 0o644)
}

// EnsureRunning reuses or starts the managed service, then waits for its socket.
// Without an installed unit, it starts a detached daemon.
func EnsureRunning() (socketPath string, err error) {
	if err := internal.EnsureRunDir(); err != nil {
		return "", err
	}
	// Write the overlay before Compose resolves its file list.
	if err := writeComposeOverlay(); err != nil {
		return "", fmt.Errorf("opscontrol: write compose overlay: %w", err)
	}
	socketPath = internal.HostSocketPath()

	mgr := internal.DetectServiceManager()
	if mgr.Available() {
		installed, err := mgr.Installed()
		if err != nil {
			return "", err
		}
		if installed {
			active, err := mgr.Active()
			if err != nil {
				return "", err
			}
			if !active {
				if err := mgr.Start(); err != nil {
					return "", err
				}
			}
			if err := waitForSocket(socketPath, 5*time.Second); err != nil {
				return "", fmt.Errorf("opscontrol: managed service did not bind socket: %w "+
					"(check `raptix opscontrol status`)", err)
			}
			return socketPath, nil
		}
	}

	return ensureRunningLauncherSpawn(socketPath)
}

// Stop terminates a launcher-spawned daemon after Compose teardown. Managed units stay running.
func Stop() error {
	mgr := internal.DetectServiceManager()
	if mgr.Available() {
		installed, err := mgr.Installed()
		if err != nil {
			return err
		}
		if installed {
			return nil
		}
	}
	return stopLauncherSpawn()
}

// ensureRunningLauncherSpawn implements the pre-Alt-A behavior. Kept
// as a fallback for environments without a recognized init system.
func ensureRunningLauncherSpawn(socketPath string) (string, error) {
	if pid, alive := readPID(); alive {
		// Daemon already running. Confirm the socket is too.
		if info, err := os.Stat(socketPath); err == nil && info.Mode()&os.ModeSocket != 0 {
			return socketPath, nil
		}
		// Daemon is alive but socket missing — unhealthy. Kill +
		// respawn.
		_ = terminateDaemon(pid)
		_ = os.Remove(internal.PIDFilePath())
	}

	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("opscontrol: locate self: %w", err)
	}
	cmd := exec.Command(exe, "opscontrol", "daemon") //nolint:gosec // own binary
	cmd.Stdin = nil
	logf, lerr := os.OpenFile(daemonLogPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if lerr == nil {
		cmd.Stdout = logf
		cmd.Stderr = logf
	}
	setDetached(cmd)
	cmd.Env = append(os.Environ(), "RAPTIX_OPSCONTROL_CHILD=1")
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("opscontrol: spawn daemon: %w", err)
	}
	_ = cmd.Process.Release()

	if err := waitForSocket(socketPath, 5*time.Second); err != nil {
		return "", fmt.Errorf("opscontrol: launcher-spawn daemon failed to bind socket: %w "+
			"(see %s)", err, daemonLogPath())
	}
	return socketPath, nil
}

func stopLauncherSpawn() error {
	pid, alive := readPID()
	if !alive {
		return nil
	}
	if err := terminateDaemon(pid); err != nil {
		return fmt.Errorf("opscontrol: signal daemon: %w", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, alive := readPID(); !alive {
			_ = os.Remove(internal.HostSocketPath())
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return errors.New("opscontrol: daemon did not exit within 5s")
}

// waitForSocket waits for a Unix socket until the deadline.
func waitForSocket(path string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if info, err := os.Stat(path); err == nil && info.Mode()&os.ModeSocket != 0 {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return fmt.Errorf("socket %s did not appear within %s", path, timeout)
}

// readPID returns the recorded PID and whether it is alive.
func readPID() (int, bool) {
	raw, err := os.ReadFile(internal.PIDFilePath())
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pid <= 0 {
		return 0, false
	}
	if !processAlive(pid) {
		return pid, false
	}
	return pid, true
}

func daemonLogPath() string {
	return internal.PIDFilePath() + ".log"
}
