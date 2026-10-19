package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/Akapi895/raptix/apps/launcher/internal/compose"
	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	"github.com/Akapi895/raptix/apps/launcher/internal/sandboxes"
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
	sandboxCmd := &cobra.Command{Use: "sandboxes", Short: "Provision one sandbox container per web project (ADR-0086 A)"}
	sandboxConfig := func(missing bool) (sandboxes.Config, error) {
		base := compose.New()
		env, err := config.LoadEnv(base.EnvFile)
		if err != nil {
			return sandboxes.Config{}, err
		}
		version := env["RAPTIX_VERSION"]
		if version == "" {
			version = "stable"
		}
		network := env["RAPTIX_SANDBOX_NETWORK"]
		if network == "" {
			network = "raptix"
			if stack := env["RAPTIX_STACK_NAME"]; stack != "" {
				network += "-" + stack
			}
			network += "_sandbox-net"
		}
		return sandboxes.Config{
			Bin:     base.Runtime.Bin,
			Home:    base.Home,
			Runner:  sandboxes.ExecRunner{},
			Missing: missing,
			Settings: sandboxes.Settings{
				Image:   "ghcr.io/akapi895/raptix-sandbox:" + version,
				Network: network,
				Volume:  workspaceVolume(env, base.Web().Project),
				EnvFile: base.EnvFile,
			},
		}, nil
	}
	sandboxCmd.AddCommand(&cobra.Command{Use: "sync", Short: "Start a sandbox for every project directory and remove orphaned ones", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		cfg, err := sandboxConfig(false)
		if err != nil {
			return err
		}
		started, err := sandboxes.Sync(cfg)
		for _, slug := range started {
			fmt.Fprintln(cmd.OutOrStdout(), "sandbox ready for project "+slug)
		}
		return err
	}})
	watch := &cobra.Command{Use: "watch", Short: "Keep a sandbox running for every project directory (starts missing ones, never removes)", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		cfg, err := sandboxConfig(true)
		if err != nil {
			return err
		}
		interval, err := cmd.Flags().GetDuration("interval")
		if err != nil {
			return err
		}
		for {
			started, err := sandboxes.Sync(cfg)
			for _, slug := range started {
				fmt.Fprintln(cmd.OutOrStdout(), "sandbox ready for project "+slug)
			}
			if err != nil {
				fmt.Fprintln(cmd.ErrOrStderr(), "sandbox watch: "+err.Error())
			}
			time.Sleep(interval)
		}
	}}
	watch.Flags().Duration("interval", 15*time.Second, "How often to look for project directories without a sandbox")
	sandboxCmd.AddCommand(watch)
	web.AddCommand(sandboxCmd)
	web.AddCommand(start,
		&cobra.Command{Use: "stop", Args: cobra.NoArgs, RunE: func(_ *cobra.Command, _ []string) error { return compose.New().Web().Down() }},
		&cobra.Command{Use: "status", Args: cobra.NoArgs, RunE: func(_ *cobra.Command, _ []string) error { return compose.New().Web().Ps() }},
	)
	rootCmd.AddCommand(web)
}

// workspaceVolume is the named volume that holds every project directory. The compose project name the
// stack actually ran under can differ from the launcher's stack name, so the operator can name it in .env.
func workspaceVolume(env map[string]string, stack string) string {
	if v := os.Getenv("RAPTIX_WEB_WORKSPACE_VOLUME"); v != "" {
		return v
	}
	if v := env["RAPTIX_WEB_WORKSPACE_VOLUME"]; v != "" {
		return v
	}
	return stack + "_web_runtime_workspace"
}
