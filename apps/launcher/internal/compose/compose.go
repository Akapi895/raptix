package compose

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Akapi895/raptix/apps/launcher/internal/config"
	"github.com/Akapi895/raptix/apps/launcher/internal/opscontrol"
	"github.com/Akapi895/raptix/apps/launcher/internal/runtime"
)

// Compose wraps Docker Compose commands for Raptix services.
type Compose struct {
	Home        string
	ComposeFile string
	EnvFile     string
	Project     string
	Standalone  bool
	// Runtime is the detected container runtime, reused for every Compose call.
	Runtime runtime.Runtime
}

// New uses the Raptix home and falls back to Docker if no runtime responds.
func New() *Compose {
	home := config.RaptixHome()
	rt, err := runtime.Detect()
	if err != nil {
		// Let the first Docker command report why the runtime is unavailable.
		rt = runtime.Runtime{Name: "docker", Bin: "docker", ComposeArgs: []string{"compose"}}
	}
	return &Compose{
		Home:        home,
		ComposeFile: filepath.Join(home, "docker-compose.yml"),
		EnvFile:     filepath.Join(home, ".env"),
		Runtime:     rt,
	}
}

// Profiles lists optional workload profiles used for teardown.
var Profiles = struct {
	C2        string
	AD        string
	Reversing string
}{
	C2:        "c2-sliver",
	AD:        "ad",
	Reversing: "reversing",
}

// AllProfiles includes every profile so teardown can remove any workload.
func AllProfiles() []string {
	return []string{
		"--profile", Profiles.C2,
		"--profile", Profiles.AD,
		"--profile", Profiles.Reversing,
	}
}

// baseArgs builds the common Compose arguments. The zero-value runtime uses Docker's subcommand form.
func (c *Compose) baseArgs() []string {
	prefix := c.Runtime.ComposeArgs
	if prefix == nil && c.Runtime.Bin == "" {
		prefix = []string{"compose"}
	}
	args := append([]string{}, prefix...)
	// Use the same explicit project name as the host daemon to avoid container name conflicts.
	project := c.Project
	if project == "" {
		project = opscontrol.ComposeProjectName()
	}
	args = append(args, "-p", project)
	args = append(args, "-f", c.ComposeFile, "--env-file", c.EnvFile)
	// Attach the overlay only when the daemon socket is available.
	if override := filepath.Join(c.Home, "docker-compose.opscontrol.yml"); !c.Standalone && fileExists(override) &&
		os.Getenv("RAPTIX_OPSCONTROL_SOCK_HOST") != "" {
		args = append(args, "-f", override)
	}
	return args
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ContainerName mirrors docker-compose.yml, including the optional stack suffix.
func ContainerName(svc string) string {
	stack := strings.TrimSpace(os.Getenv("RAPTIX_STACK_NAME"))
	if stack == "" {
		return "raptix-" + svc
	}
	return "raptix-" + stack + "-" + svc
}

// readVersion returns the installed version or an empty string so Compose can use its default tag.
func (c *Compose) readVersion() string {
	data, err := os.ReadFile(filepath.Join(c.Home, ".version"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// composeEnv gives the installed version precedence over .env and applies runtime-specific settings.
func (c *Compose) composeEnv() []string {
	// Share interpolation settings with the host daemon to keep container names consistent.
	env := opscontrol.ComposeCommandEnv()
	if v := c.readVersion(); v != "" {
		env = append(env, "RAPTIX_VERSION="+imageTag(v))
	}
	// Expose Podman's compatibility socket to Docker API clients.
	env = c.Runtime.Apply(env)
	return env
}

// run executes a compose command via the detected runtime.
func (c *Compose) run(args []string, interactive bool) error {
	cmdArgs := append(c.baseArgs(), args...)
	cmd := exec.Command(c.Runtime.Bin, cmdArgs...)
	cmd.Env = c.composeEnv()
	if interactive {
		cmd.Stdin = os.Stdin
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
	} else {
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
	}
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s compose %s: %w", c.Runtime.Name, strings.Join(args, " "), err)
	}
	return nil
}

// Up starts services and waits for their Compose health checks.
// RAPTIX_STARTUP_TIMEOUT_SECONDS overrides the wait budget.
func (c *Compose) Up(profiles ...string) error {
	args := []string{}
	for _, p := range profiles {
		args = append(args, "--profile", p)
	}
	args = append(args, "up", "-d", "--no-build", "--wait", "--wait-timeout", startupTimeoutSeconds())
	return c.run(args, false)
}

// startupTimeoutSeconds returns the --wait-timeout value as a string.
// User override via RAPTIX_STARTUP_TIMEOUT_SECONDS; falls back to 600s.
func startupTimeoutSeconds() string {
	if v := os.Getenv("RAPTIX_STARTUP_TIMEOUT_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return strconv.Itoa(n)
		}
	}
	return "600"
}

// Down stops and removes containers using all profiles for clean teardown.
func (c *Compose) Down() error {
	args := AllProfiles()
	args = append(args, "down")
	return c.run(args, false)
}

// DownAndPurge removes containers, networks and named volumes during uninstall.
func (c *Compose) DownAndPurge() error {
	args := AllProfiles()
	args = append(args, "down", "--volumes", "--remove-orphans")
	return c.run(args, false)
}

// Pull uses the supplied version, falling back to the installed version.
func (c *Compose) Pull(version string) error {
	cmd := exec.Command(c.Runtime.Bin, append(c.baseArgs(), "pull")...)
	env := c.composeEnv()
	if version != "" {
		env = append(env, "RAPTIX_VERSION="+imageTag(version))
	}
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s compose pull: %w", c.Runtime.Name, err)
	}
	return nil
}

func imageTag(version string) string {
	return strings.TrimPrefix(strings.TrimSpace(version), "v")
}

// Ps shows service status; with arguments, only those services.
func (c *Compose) Ps(services ...string) error {
	args := append([]string{"ps"}, services...)
	return c.run(args, false)
}

// Stop stops the given services without removing their containers.
func (c *Compose) Stop(services ...string) error {
	args := append([]string{"stop"}, services...)
	return c.run(args, false)
}

// UpServices starts the named services and their dependencies, then waits for health checks.
func (c *Compose) UpServices(services ...string) error {
	args := append([]string{"up", "-d", "--no-build", "--wait", "--wait-timeout", startupTimeoutSeconds()}, services...)
	return c.run(args, false)
}

// Logs follows service logs.
func (c *Compose) Logs(service string) error {
	args := []string{"logs", "-f"}
	if service != "" {
		args = append(args, service)
	}
	return c.run(args, false)
}

// Exec runs a command inside a running service container.
func (c *Compose) Exec(service string, command ...string) error {
	args := append([]string{"exec", "-T", service}, command...)
	return c.run(args, false)
}

// CleanScratch removes pre-engagement scratch and session directories from the sandbox.
func (c *Compose) CleanScratch() {
	cmd := exec.Command(
		c.Runtime.Bin,
		"exec",
		ContainerName("sandbox"),
		"rm",
		"-rf",
		"/workspace/.scratch",
		"/workspace/.sessions",
	)
	cmd.Env = c.composeEnv()
	cmd.Stdout = nil
	cmd.Stderr = nil
	_ = cmd.Run()
}
