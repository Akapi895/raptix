// Package runtime selects a reachable Docker, Podman or nerdctl installation.
// RAPTIX_CONTAINER_RUNTIME overrides the default lookup order.
package runtime

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// Runtime is a snapshot of the detected container runtime.
type Runtime struct {
	// Name is the canonical short name: "docker", "podman", "nerdctl".
	Name string
	// Bin is the absolute path of the binary to invoke.
	Bin string
	// ComposeArgs holds the subcommand prefix. A standalone Compose wrapper needs no prefix.
	ComposeArgs []string
	// DockerHost holds the Docker API socket override, when available.
	DockerHost string
	// Rootless reports whether the runtime is running unprivileged.
	// Affects volume-mount semantics + recommended sysctls.
	Rootless bool
	// Version is the runtime's reported version string ("28.0.1" /
	// "5.2.0" / etc.) for diagnostics.
	Version string
}

// Detect returns the selected runtime or an error suitable for an installation hint.
func Detect() (Runtime, error) {
	if forced := strings.ToLower(strings.TrimSpace(os.Getenv("RAPTIX_CONTAINER_RUNTIME"))); forced != "" {
		switch forced {
		case "docker", "podman", "nerdctl":
			r, err := probe(forced)
			if err != nil {
				return Runtime{}, fmt.Errorf("RAPTIX_CONTAINER_RUNTIME=%s requested but unusable: %w", forced, err)
			}
			return r, nil
		default:
			return Runtime{}, fmt.Errorf("RAPTIX_CONTAINER_RUNTIME=%q is not one of docker|podman|nerdctl", forced)
		}
	}

	// 2-4. Autodetect in order of preference
	for _, name := range []string{"docker", "podman", "nerdctl"} {
		if r, err := probe(name); err == nil {
			return r, nil
		}
	}

	return Runtime{}, fmt.Errorf("no container runtime found on PATH (looked for docker, podman, nerdctl)")
}

// probe attempts to use a specific runtime; returns Runtime if it
// responds to `<bin> info`, or an error.
func probe(name string) (Runtime, error) {
	bin, err := exec.LookPath(name)
	if err != nil {
		return Runtime{}, fmt.Errorf("%s not on PATH", name)
	}
	// Probe the daemon because the binary can be installed while the service is stopped.
	if err := exec.Command(bin, "info").Run(); err != nil {
		return Runtime{}, fmt.Errorf("%s installed but daemon not reachable: %w", name, err)
	}

	r := Runtime{Name: name, Bin: bin, ComposeArgs: []string{"compose"}}
	r.Version = versionString(bin)
	r.Rootless = rootless(bin, name)

	switch name {
	case "podman":
		// Reuse the first available Podman compatibility socket for Docker API clients.
		if sock := podmanSocket(); sock != "" {
			r.DockerHost = "unix://" + sock
		}
		// Use the standalone Podman Compose wrapper only when the built-in command is unavailable.
		if !hasBuiltinPodmanCompose(bin) {
			if pc, err := exec.LookPath("podman-compose"); err == nil {
				r.Bin = pc
				r.ComposeArgs = nil // podman-compose IS the compose binary
			}
		}
	case "nerdctl":
		// nerdctl's compose sub-command is built-in since 0.16; older
		// builds had a separate `nerdctl-compose`.
	}

	return r, nil
}

// podmanSocket checks the rootless socket before the system socket.
func podmanSocket() string {
	if xdg := os.Getenv("XDG_RUNTIME_DIR"); xdg != "" {
		p := filepath.Join(xdg, "podman", "podman.sock")
		if fileExists(p) {
			return p
		}
	}
	// Rootless fallback for $XDG_RUNTIME_DIR unset on Linux distros
	// that don't export it for interactive shells.
	if uid := os.Getuid(); uid >= 0 {
		p := filepath.Join("/run", "user", strconv.Itoa(uid), "podman", "podman.sock")
		if fileExists(p) {
			return p
		}
	}
	// Rootful default
	if fileExists("/run/podman/podman.sock") {
		return "/run/podman/podman.sock"
	}
	// macOS Podman Desktop uses a different path; user can override via
	// RAPTIX_DOCKER_HOST if needed.
	return ""
}

// rootless reports whether the runtime runs without host root privileges.
func rootless(bin, name string) bool {
	switch name {
	case "podman":
		// Fall back to a home-directory heuristic if Podman cannot report its rootless state.
		out, err := exec.Command(bin, "info", "--format", "{{.Host.Security.Rootless}}").Output()
		if err == nil {
			return strings.TrimSpace(string(out)) == "true"
		}
		return strings.HasPrefix(bin, os.Getenv("HOME"))
	case "docker":
		// Desktop runs outside the host's root context. Linux Docker defaults to rootful.
		if runtime.GOOS == "linux" {
			// `docker info --format {{.SecurityOptions}}` lists "rootless"
			// when the daemon is rootless.
			out, err := exec.Command(bin, "info", "--format", "{{.SecurityOptions}}").Output()
			if err == nil && strings.Contains(string(out), "rootless") {
				return true
			}
			return false
		}
		return true
	case "nerdctl":
		// Same heuristic as podman.
		out, err := exec.Command(bin, "info", "--format", "{{.SecurityOptions}}").Output()
		return err == nil && strings.Contains(string(out), "rootless")
	}
	return false
}

// hasBuiltinPodmanCompose returns true when `podman compose --help`
// exits 0 (i.e. Podman 4.4+ ships compose support inline).
func hasBuiltinPodmanCompose(bin string) bool {
	err := exec.Command(bin, "compose", "--help").Run()
	return err == nil
}

// versionString returns the runtime's reported version, "unknown" on
// failure.
func versionString(bin string) string {
	out, err := exec.Command(bin, "version", "--format", "{{.Server.Version}}").Output()
	if err != nil || len(out) == 0 {
		// Some clients don't expose --format
		out, err = exec.Command(bin, "--version").Output()
		if err != nil {
			return "unknown"
		}
	}
	return strings.TrimSpace(string(out))
}

// fileExists is a small wrapper for sock-path existence checks.
func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// Apply adds runtime environment overrides to a new slice.
func (r Runtime) Apply(env []string) []string {
	if r.DockerHost == "" {
		return env
	}
	out := make([]string, 0, len(env)+1)
	// Only add DOCKER_HOST if the caller hasn't already set it — let
	// the user's explicit choice win.
	for _, kv := range env {
		if strings.HasPrefix(kv, "DOCKER_HOST=") {
			return env
		}
		out = append(out, kv)
	}
	out = append(out, "DOCKER_HOST="+r.DockerHost)
	return out
}

// String renders a one-line diagnostic for the onboard System Check
// panel and the `raptix version` output.
func (r Runtime) String() string {
	bits := []string{r.Name}
	if r.Version != "" {
		bits = append(bits, r.Version)
	}
	if r.Rootless {
		bits = append(bits, "rootless")
	}
	if r.DockerHost != "" {
		bits = append(bits, "socket="+r.DockerHost)
	}
	return strings.Join(bits, " · ")
}
