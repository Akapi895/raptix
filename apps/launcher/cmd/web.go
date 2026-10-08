package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/Akapi895/raptix/apps/launcher/internal/compose"
	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	"github.com/spf13/cobra"
)

func init() {
	web := &cobra.Command{Use: "web", Short: "Manage the independent web-raptix UI/API stack"}
	start := &cobra.Command{Use: "start", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		base := compose.New()
		if _, err := os.Stat(filepath.Join(base.Home, "docker-compose.web-raptix.yml")); err != nil {
			return fmt.Errorf("web deployment config missing; update the installed configuration: %w", err)
		}
		pull, err := cmd.Flags().GetBool("pull")
		if err != nil {
			return err
		}
		if pull {
			if err := base.Pull(""); err != nil {
				return err
			}
			if err := base.Web().Pull(""); err != nil {
				return err
			}
		}
		startInfra, err := cmd.Flags().GetBool("start-infra")
		if err != nil {
			return err
		}
		if startInfra {
			if err := base.Up(); err != nil {
				return err
			}
		}
		if err := base.EnsureWebDatabase(); err != nil {
			return err
		}
		if err := base.Web().Up(); err != nil {
			return err
		}
		port := os.Getenv("WEB_RAPTIX_PORT")
		if port == "" {
			env, err := config.LoadEnv(base.EnvFile)
			if err != nil {
				return err
			}
			port = env["WEB_RAPTIX_PORT"]
		}
		if port == "" {
			port = "3000"
		}
		fmt.Fprintln(cmd.OutOrStdout(), "Web raptix: http://127.0.0.1:"+port+"/projects")
		return nil
	}}
	start.Flags().Bool("pull", true, "Pull version-selected images before starting (disable for local built images)")
	start.Flags().Bool("start-infra", true, "Start base infrastructure first (disable when an existing shared stack is already running)")
	web.AddCommand(start,
		&cobra.Command{Use: "stop", Args: cobra.NoArgs, RunE: func(_ *cobra.Command, _ []string) error { return compose.New().Web().Down() }},
		&cobra.Command{Use: "status", Args: cobra.NoArgs, RunE: func(_ *cobra.Command, _ []string) error { return compose.New().Web().Ps() }},
	)
	rootCmd.AddCommand(web)
}
