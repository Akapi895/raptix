package sandboxes

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Runner runs container-runtime commands. Tests substitute a fake; production uses ExecRunner.
type Runner interface {
	Output(name string, args ...string) (string, error)
	Run(name string, args ...string) error
}

// Config is everything Sync needs from the launcher.
type Config struct {
	// Bin is the container runtime binary (docker or podman).
	Bin string
	// Home is the Raptix home; compose files are written under Home/web-sandboxes.
	Home string
	// Settings are the deployment values shared by every project sandbox.
	Settings Settings
	// Runner executes the runtime commands.
	Runner Runner
	// Missing starts only projects without a running sandbox and removes nothing.
	// The watch loop uses it so a transient listing can never delete a live sandbox.
	Missing bool
}

// Sync makes one sandbox container per project directory on the workspace volume and
// removes sandbox containers whose project directory no longer exists. It returns the
// slugs it started so the caller can report them.
func Sync(cfg Config) ([]string, error) {
	if cfg.Runner == nil || cfg.Bin == "" || cfg.Home == "" {
		return nil, fmt.Errorf("sandbox sync needs a runtime, a home directory and a runner")
	}
	projects, err := listProjects(cfg)
	if err != nil {
		return nil, err
	}
	containers, err := listSandboxContainers(cfg)
	if err != nil {
		return nil, err
	}
	// An empty listing usually means the workspace volume name is wrong, not that no project exists.
	// Removing sandboxes on that evidence would delete the sandboxes of live projects.
	if len(projects) == 0 && len(containers) > 0 {
		return nil, fmt.Errorf("no project directories found on volume %s; refusing to remove %d sandbox container(s). Set RAPTIX_WEB_WORKSPACE_VOLUME to the workspace volume name", cfg.Settings.Volume, len(containers))
	}
	ensure, orphaned := Plan(projects, containers)
	if cfg.Missing {
		running, err := listRunningSandboxes(cfg)
		if err != nil {
			return nil, err
		}
		ensure = withoutRunning(ensure, running)
		orphaned = nil
	}
	dir := filepath.Join(cfg.Home, "web-sandboxes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create %s: %w", dir, err)
	}
	for _, slug := range ensure {
		body, err := RenderCompose(slug, cfg.Settings)
		if err != nil {
			return nil, err
		}
		file := filepath.Join(dir, slug+".compose.yml")
		if err := os.WriteFile(file, body, 0o644); err != nil {
			return nil, fmt.Errorf("write %s: %w", file, err)
		}
		args := []string{"compose", "-p", ComposeProject, "-f", file, "--env-file", cfg.Settings.EnvFile, "up", "-d"}
		if err := cfg.Runner.Run(cfg.Bin, args...); err != nil {
			return ensure, fmt.Errorf("start sandbox for project %s: %w", slug, err)
		}
	}
	for _, name := range orphaned {
		if err := cfg.Runner.Run(cfg.Bin, "rm", "-f", name); err != nil {
			return ensure, fmt.Errorf("remove orphaned sandbox %s: %w", name, err)
		}
	}
	return ensure, nil
}

// listerImage is a plain image used only to list directories; the sandbox image's entrypoint starts a daemon, so it is not used here.
const listerImage = "alpine:latest"

// listProjects reads the project directories from the workspace volume. A project is a directory
// with a plan/ directory, as the web server creates it (projects-service prepares the plan dir); other
// top-level entries on the volume are not projects. A throwaway
// container lists them, so the launcher never needs the volume on its own filesystem.
func listRunningSandboxes(cfg Config) ([]string, error) {
	out, err := cfg.Runner.Output(cfg.Bin, "ps", "--filter", "name=^"+HostPrefix, "--format", "{{.Names}}")
	if err != nil {
		return nil, fmt.Errorf("list running sandbox containers: %w", err)
	}
	return splitLines(out), nil
}

func withoutRunning(slugs []string, running []string) []string {
	up := map[string]bool{}
	for _, name := range running {
		up[name] = true
	}
	var missing []string
	for _, slug := range slugs {
		if !up[HostPrefix+slug] {
			missing = append(missing, slug)
		}
	}
	return missing
}

func listProjects(cfg Config) ([]string, error) {
	out, err := cfg.Runner.Output(cfg.Bin, "run", "--rm", "-v", cfg.Settings.Volume+":/w", listerImage,
		"sh", "-c", `for d in /w/*/; do n=$(basename "$d"); [ -d "$d/plan" ] && echo "$n"; done; true`)
	if err != nil {
		return nil, fmt.Errorf("list project directories on %s: %w", cfg.Settings.Volume, err)
	}
	return splitLines(out), nil
}

func listSandboxContainers(cfg Config) ([]string, error) {
	out, err := cfg.Runner.Output(cfg.Bin, "ps", "-a", "--filter", "name=^"+HostPrefix, "--format", "{{.Names}}")
	if err != nil {
		return nil, fmt.Errorf("list sandbox containers: %w", err)
	}
	return splitLines(out), nil
}

func splitLines(s string) []string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		if t := strings.TrimSpace(line); t != "" {
			out = append(out, t)
		}
	}
	return out
}
