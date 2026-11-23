package cmd

import "github.com/Akapi895/raptix/apps/launcher/cmd/opscontrol"

func init() {
	rootCmd.AddCommand(opscontrol.Cmd)
}
