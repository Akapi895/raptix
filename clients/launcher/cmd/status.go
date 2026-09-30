package cmd

import (
	"github.com/Akapi895/raptix/clients/launcher/internal/compose"
	"github.com/spf13/cobra"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show Raptix service status",
	RunE: func(cmd *cobra.Command, args []string) error {
		return compose.New().Ps()
	},
}

func init() {
	rootCmd.AddCommand(statusCmd)
}
