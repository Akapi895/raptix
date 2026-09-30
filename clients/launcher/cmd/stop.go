package cmd

import (
	"github.com/Akapi895/raptix/clients/launcher/cmd/opscontrol"
	"github.com/Akapi895/raptix/clients/launcher/internal/compose"
	"github.com/Akapi895/raptix/clients/launcher/internal/ui"
	"github.com/spf13/cobra"
)

var stopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop all Raptix services",
	RunE: func(cmd *cobra.Command, args []string) error {
		c := compose.New()
		ui.Info("Stopping Raptix services...")
		c.RemoveOrphanedCLI()
		// Clear legacy root-level scratch/session buffers before tearing the
		// stack down. Current runs keep these under engagement workspaces.
		c.CleanScratch()
		if err := c.Down(); err != nil {
			return err
		}
		// Tear down the opscontrol daemon after compose so any
		// workload it owned has already been removed by `compose down`.
		// Non-fatal: a never-started daemon is a no-op here.
		if err := opscontrol.Stop(); err != nil {
			ui.Warning("opscontrol stop: " + err.Error())
		}
		ui.Success("All services stopped")
		return nil
	},
}

func init() {
	rootCmd.AddCommand(stopCmd)
}
