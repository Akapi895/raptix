package opscontrol

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	internal "github.com/Akapi895/raptix/apps/launcher/internal/opscontrol"
	"github.com/Akapi895/raptix/apps/launcher/internal/ui"
	"github.com/spf13/cobra"
)

var installCmd = &cobra.Command{
	Use:   "install",
	Short: "Install opscontrol as a managed background service",
	Long: `Installs the opscontrol daemon as a systemd user unit (Linux,
including WSL2 with systemd=true) or a launchd LaunchAgent (macOS).

After install the daemon survives reboots, restarts automatically on
crash, and runs independently of the launcher — ` + "`raptix start`" + ` /
` + "`raptix stop`" + ` only manage the compose stack, not the daemon.

When the host does not have a recognized init system (Windows, WSL2
without systemd, Linux without per-user systemd), this command exits
with an explanatory note and the launcher keeps using the legacy
"spawn-as-child" mode automatically.`,
	RunE: runInstall,
}

func runInstall(_ *cobra.Command, _ []string) error {
	return EnsureInstalled()
}

// EnsureInstalled refreshes the managed unit or leaves startup to the launcher on unsupported hosts.
func EnsureInstalled() error {
	mgr := internal.DetectServiceManager()
	if !mgr.Available() {
		ui.Warning("No supported service manager on this host (looked for systemd-user, launchd).")
		ui.Info("opscontrol will use the launcher-spawn path automatically. No install action required.")
		return nil
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("opscontrol: resolve binary path: %w", err)
	}

	// Create the directories before systemd applies ReadWritePaths.
	homePath := config.RaptixHome()
	if err := os.MkdirAll(homePath, 0o700); err != nil {
		return fmt.Errorf("opscontrol: pre-create home: %w", err)
	}
	if err := internal.EnsureRunDir(); err != nil {
		return fmt.Errorf("opscontrol: pre-create run dir: %w", err)
	}

	spec := internal.InstallSpec{
		BinaryPath: exe,
		HomePath:   homePath,
		StackName:  internal.StackName(),
	}

	ui.Info(fmt.Sprintf("Installing opscontrol via %s (unit=%s)...", mgr.Name(), internal.ServiceUnitName()))
	if err := mgr.Install(spec); err != nil {
		return err
	}

	// The service may still be activating after enable --now returns.
	if err := waitForActive(mgr, 10*time.Second); err != nil {
		return err
	}

	ui.Success(fmt.Sprintf("opscontrol service is active. Socket: %s", internal.HostSocketPath()))
	return nil
}

// waitForActive requires an active unit and a Unix socket. A restarting unit may briefly appear active.
func waitForActive(mgr internal.ServiceManager, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	socketPath := internal.HostSocketPath()
	for time.Now().Before(deadline) {
		active, err := mgr.Active()
		if err != nil {
			return fmt.Errorf("opscontrol: probe active state: %w", err)
		}
		if active {
			if info, sErr := os.Stat(socketPath); sErr == nil && info.Mode()&os.ModeSocket != 0 {
				return nil
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return errors.New("opscontrol: service did not reach active+socket-ready within " + timeout.String() +
		"; check `journalctl --user -u " + internal.ServiceUnitName() + "` or `launchctl print` output")
}

func init() {
	Cmd.AddCommand(installCmd)
}
