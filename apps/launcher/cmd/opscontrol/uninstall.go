package opscontrol

import (
	internal "github.com/Akapi895/raptix/apps/launcher/internal/opscontrol"
	"github.com/Akapi895/raptix/apps/launcher/internal/ui"
	"github.com/spf13/cobra"
)

var uninstallCmd = &cobra.Command{
	Use:   "uninstall",
	Short: "Remove the opscontrol managed service (reverts to launcher-spawn fallback)",
	Long: `Stops the service, removes the systemd unit / launchd plist, and
reloads the init system so a subsequent ` + "`raptix opscontrol install`" + `
starts from a clean state.

If the service was never installed via ` + "`raptix opscontrol install`" + `,
this command is a no-op.`,
	RunE: runUninstall,
}

func runUninstall(_ *cobra.Command, _ []string) error {
	mgr := internal.DetectServiceManager()
	if !mgr.Available() {
		ui.Info("No supported service manager on this host; nothing to uninstall.")
		return nil
	}
	installed, err := mgr.Installed()
	if err != nil {
		return err
	}
	if !installed {
		ui.Info("opscontrol service is not installed; nothing to do.")
		return nil
	}
	if err := mgr.Uninstall(); err != nil {
		return err
	}
	ui.Success("opscontrol service removed. Future `raptix start` will use the launcher-spawn fallback unless reinstalled.")
	return nil
}

func init() {
	Cmd.AddCommand(uninstallCmd)
}
