package cmd

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Akapi895/raptix/apps/launcher/internal/environments"
	"github.com/spf13/cobra"
)

// The trusted host controller for project environments (ADR-0092). It runs on the host, listens on loopback only, and
// reads its token from a file. Stopping it does not stop the environment containers it created.
var environmentControllerFlags struct {
	listen         string
	tokenFile      string
	workspaceRoot  string
	mgmtNetwork    string
	images         string
	memoryBytes    int64
	pidsLimit      int
	runtimeEnvFile string
}

var environmentControllerCmd = &cobra.Command{
	Use:   "environment-controller",
	Short: "Run the trusted host controller for project environments (ADR-0092)",
	Long: "Serves the six allowlisted environment operations on a loopback address. The token is read from a file. " +
		"Images are digest-pinned references, comma-separated. Environment containers survive a controller restart.",
	RunE: runEnvironmentController,
}

func init() {
	f := environmentControllerCmd.Flags()
	f.StringVar(&environmentControllerFlags.listen, "listen", "127.0.0.1:9100", "loopback address to serve on")
	f.StringVar(&environmentControllerFlags.tokenFile, "token-file", "", "file holding the bearer token (at least 32 bytes)")
	f.StringVar(&environmentControllerFlags.workspaceRoot, "workspace-root", "", "host directory that holds every project workspace")
	f.StringVar(&environmentControllerFlags.mgmtNetwork, "management-network", "", "existing network the runtime joins for the control plane")
	f.StringVar(&environmentControllerFlags.images, "images", "", "comma-separated digest-pinned image references the host allows")
	f.Int64Var(&environmentControllerFlags.memoryBytes, "memory-bytes", 2<<30, "memory limit for each environment container")
	f.IntVar(&environmentControllerFlags.pidsLimit, "pids-limit", 512, "process limit for each environment container")
	f.StringVar(&environmentControllerFlags.runtimeEnvFile, "runtime-env-file", "", "file of KEY=VALUE lines granted to runtimes; only allowlisted keys are accepted")
	for _, name := range []string{"token-file", "workspace-root", "management-network", "images"} {
		_ = environmentControllerCmd.MarkFlagRequired(name)
	}
	rootCmd.AddCommand(environmentControllerCmd)
}

func runEnvironmentController(cmd *cobra.Command, _ []string) error {
	raw, err := os.ReadFile(environmentControllerFlags.tokenFile)
	if err != nil {
		return fmt.Errorf("read controller token file: %w", err)
	}
	token := strings.TrimSpace(string(raw))
	runtimeEnv, err := readRuntimeEnv(environmentControllerFlags.runtimeEnvFile)
	if err != nil {
		return err
	}
	ctrl, err := environments.New(environments.ExecRunner{}, environments.Config{
		RuntimeEnv:        runtimeEnv,
		WorkspaceRoot:     environmentControllerFlags.workspaceRoot,
		ManagementNetwork: environmentControllerFlags.mgmtNetwork,
		Images:            splitImages(environmentControllerFlags.images),
		MemoryBytes:       environmentControllerFlags.memoryBytes,
		PidsLimit:         environmentControllerFlags.pidsLimit,
	})
	if err != nil {
		return err
	}
	handler, err := environments.NewHandler(ctrl, token)
	if err != nil {
		return err
	}
	srv, err := environments.NewServer(environmentControllerFlags.listen, handler)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()

	fmt.Fprintf(cmd.OutOrStdout(), "environment controller listening on %s\n", environmentControllerFlags.listen)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func splitImages(raw string) []string {
	var out []string
	for _, item := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// readRuntimeEnv reads KEY=VALUE lines. Blank lines and comments are skipped. The allowlist is enforced by the
// controller, so an unknown key stops the start rather than being passed on.
func readRuntimeEnv(path string) (map[string]string, error) {
	env := map[string]string{}
	if path == "" {
		return env, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read runtime env file: %w", err)
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("runtime env file has a line without KEY=VALUE")
		}
		env[strings.TrimSpace(key)] = value
	}
	return env, nil
}
