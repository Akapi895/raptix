package sandboxes

import (
	"fmt"
	"os"
	"path/filepath"
)

// Runner runs container-runtime commands. Tests substitute a fake; production uses ExecRunner.
type Runner interface {
	Output(name string, args ...string) (string, error)
	Run(name string, args ...string) error
}

// Config is everything Ensure needs from the launcher.
type Config struct {
	// Bin is the container runtime binary (docker or podman).
	Bin string
	// Home is the Raptix home; compose files are written under Home/web-sandboxes.
	Home string
	// Key derives each project's sandbox token (see TokenFor). It is never written into a sandbox.
	Key string
	// Settings are the deployment values shared by every project sandbox.
	Settings Settings
	// Runner executes the runtime commands.
	Runner Runner
}

// Ensure starts the sandbox of one project and returns once its container is healthy. It is the only path that creates
// a project sandbox: the web API calls it when a project is created. It creates the project's own volume with the
// compose file, and then creates the plan directory inside the container, so no process on the host or in the API
// writes a project's files.
func Ensure(cfg Config, slug string) error {
	if cfg.Runner == nil || cfg.Bin == "" || cfg.Home == "" || cfg.Key == "" {
		return fmt.Errorf("sandbox ensure needs a runtime, a home directory, the sandbox key and a runner")
	}
	// RenderCompose validates the slug before anything below uses it in a path or a command.
	body, err := RenderCompose(slug, cfg.Settings, TokenFor(cfg.Key, slug))
	if err != nil {
		return err
	}
	dir := filepath.Join(cfg.Home, "web-sandboxes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", dir, err)
	}
	file := filepath.Join(dir, slug+".compose.yml")
	if err := os.WriteFile(file, body, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", file, err)
	}
	args := []string{"compose", "-p", ComposeProject, "-f", file, "up", "-d", "--wait", "--wait-timeout", "120"}
	if err := cfg.Runner.Run(cfg.Bin, args...); err != nil {
		return fmt.Errorf("start sandbox for project %s: %w", slug, err)
	}
	container, err := ContainerName(slug)
	if err != nil {
		return err
	}
	if err := cfg.Runner.Run(cfg.Bin, "exec", container, "mkdir", "-p", "/workspace/plan"); err != nil {
		return fmt.Errorf("create plan directory for project %s: %w", slug, err)
	}
	return nil
}
