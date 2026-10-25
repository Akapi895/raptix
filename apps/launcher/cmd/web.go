package cmd

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/Akapi895/raptix/apps/launcher/internal/compose"
	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	"github.com/Akapi895/raptix/apps/launcher/internal/environments"
	"github.com/Akapi895/raptix/apps/launcher/internal/sandboxes"
	"github.com/spf13/cobra"
)

// sandboxFlags are the deployment values the sandbox controller needs. They are flags, not discovered from the
// environment, so the controller always starts the same containers.
type sandboxFlags struct {
	runtime    string
	home       string
	secretsDir string
	network    string
	image      string
}

func addSandboxFlags(cmd *cobra.Command, f *sandboxFlags) {
	fl := cmd.Flags()
	fl.StringVar(&f.runtime, "runtime", "docker", "container runtime binary")
	fl.StringVar(&f.home, "home", "", "Raptix home; compose files are written under <home>/web-sandboxes")
	fl.StringVar(&f.secretsDir, "secrets-dir", "", "directory holding the sandbox key and the controller token")
	fl.StringVar(&f.network, "network", "", "existing sandbox network")
	fl.StringVar(&f.image, "image", "", "sandbox image reference")
	for _, name := range []string{"home", "secrets-dir", "network", "image"} {
		if err := cmd.MarkFlagRequired(name); err != nil {
			panic(err)
		}
	}
}

func (f sandboxFlags) config() (sandboxes.Config, error) {
	key, err := sandboxes.ReadSecret(filepath.Join(f.secretsDir, sandboxes.KeyFile))
	if err != nil {
		return sandboxes.Config{}, err
	}
	return sandboxes.Config{
		Bin:    f.runtime,
		Home:   f.home,
		Key:    key,
		Runner: sandboxes.ExecRunner{},
		Settings: sandboxes.Settings{
			Image:   f.image,
			Network: f.network,
		},
	}, nil
}

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

	var serveFlags sandboxFlags
	var listen string
	serveCmd := &cobra.Command{Use: "serve", Short: "Serve the host controller that starts a sandbox when a project is created", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		return runSandboxController(cmd, serveFlags, listen)
	}}
	addSandboxFlags(serveCmd, &serveFlags)
	serveCmd.Flags().StringVar(&listen, "listen", "127.0.0.1:9200", "loopback address to serve on")
	sandboxCmd.AddCommand(serveCmd)

	var secretsDir string
	initSecretsCmd := &cobra.Command{Use: "init-secrets", Short: "Create the sandbox key and controller token once, owner-only", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, _ []string) error {
		if err := sandboxes.InitSecrets(secretsDir); err != nil {
			return err
		}
		fmt.Fprintln(cmd.OutOrStdout(), "sandbox secrets ready in "+secretsDir)
		return nil
	}}
	initSecretsCmd.Flags().StringVar(&secretsDir, "secrets-dir", "", "directory to create the sandbox key and controller token in")
	if err := initSecretsCmd.MarkFlagRequired("secrets-dir"); err != nil {
		panic(err)
	}
	sandboxCmd.AddCommand(initSecretsCmd)

	web.AddCommand(sandboxCmd)
	web.AddCommand(start,
		&cobra.Command{Use: "stop", Args: cobra.NoArgs, RunE: func(_ *cobra.Command, _ []string) error { return compose.New().Web().Down() }},
		&cobra.Command{Use: "status", Args: cobra.NoArgs, RunE: func(_ *cobra.Command, _ []string) error { return compose.New().Web().Ps() }},
	)
	rootCmd.AddCommand(web)
}

// runSandboxController serves ensure requests from the web API on a loopback address. It runs on the host, because
// only the host has the container runtime; the API reaches it through host.docker.internal with a bearer token.
func runSandboxController(cmd *cobra.Command, f sandboxFlags, listen string) error {
	cfg, err := f.config()
	if err != nil {
		return err
	}
	token, err := sandboxes.ReadSecret(filepath.Join(f.secretsDir, sandboxes.ControllerTokenFile))
	if err != nil {
		return err
	}
	handler, err := sandboxes.NewHandler(func(slug string) error {
		err := sandboxes.Ensure(cfg, slug)
		if err != nil {
			fmt.Fprintf(cmd.ErrOrStderr(), "sandbox for project %s: %v\n", slug, err)
		}
		return err
	}, token)
	if err != nil {
		return err
	}
	srv, err := environments.NewServer(listen, handler)
	if err != nil {
		return err
	}
	// Starting a sandbox waits for its container to become healthy, so the response can take longer than the default.
	srv.WriteTimeout = 3 * time.Minute

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdown); err != nil {
			fmt.Fprintf(cmd.ErrOrStderr(), "sandbox controller shutdown: %v\n", err)
		}
	}()

	listener, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		return fmt.Errorf("sandbox controller cannot listen on %s: %w", srv.Addr, err)
	}
	fmt.Fprintf(cmd.OutOrStdout(), "sandbox controller listening on %s\n", listen)
	if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
