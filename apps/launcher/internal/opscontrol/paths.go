// Package opscontrol manages workload lifecycle on the host. The runtime reaches it over a Unix socket.
package opscontrol

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/Akapi895/raptix/apps/launcher/internal/config"
)

// StackName returns the sanitized RAPTIX_STACK_NAME or an empty string for the default stack.
func StackName() string {
	name := strings.TrimSpace(os.Getenv("RAPTIX_STACK_NAME"))
	if name == "" {
		return ""
	}
	// Restrict stack names before using them in unit names and socket paths.
	if len(name) > 32 {
		name = name[:32]
	}
	clean := strings.Builder{}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9':
		case r == '-':
		default:
			r = '-'
		}
		clean.WriteRune(r)
	}
	return clean.String()
}

// stackSuffix returns ".stack2"-style suffix when RAPTIX_STACK_NAME
// is set, empty otherwise. Used as a filename infix.
func stackSuffix() string {
	if s := StackName(); s != "" {
		return "." + s
	}
	return ""
}

// HostSocketPath keeps a separate socket for each stack under RAPTIX_HOME/run.
func HostSocketPath() string {
	return filepath.Join(config.RaptixHome(), "run", "ops"+stackSuffix()+".sock")
}

// ContainerSocketPath is constant because each stack has its own runtime container.
const ContainerSocketPath = "/var/run/raptix-ops.sock"

// PIDFilePath keeps a separate daemon PID file for each stack.
func PIDFilePath() string {
	return filepath.Join(config.RaptixHome(), "run", "opscontrol"+stackSuffix()+".pid")
}

// EnsureRunDir creates the private directory for the daemon socket and PID file.
func EnsureRunDir() error {
	return os.MkdirAll(filepath.Join(config.RaptixHome(), "run"), 0o700)
}

// ServiceUnitName includes the stack name to keep service definitions separate.
func ServiceUnitName() string {
	suffix := StackName()
	if suffix == "" {
		return "raptix-opscontrol"
	}
	return "raptix-opscontrol-" + suffix
}

// ComposeProjectEnv overrides the project for both the launcher and the daemon.
const ComposeProjectEnv = "RAPTIX_COMPOSE_PROJECT"

// ComposeProjectName uses RAPTIX_COMPOSE_PROJECT first, then raptix with the optional stack suffix.
// A shared name avoids container name conflicts between launcher and daemon.
func ComposeProjectName() string {
	if v := strings.TrimSpace(os.Getenv(ComposeProjectEnv)); v != "" {
		return v
	}
	suffix := StackName()
	if suffix == "" {
		return "raptix"
	}
	return "raptix-" + suffix
}

// ComposeCommandEnv keeps project and container names consistent between Compose callers.
// Empty process values take precedence over conflicting .env settings.
func ComposeCommandEnv() []string {
	env := os.Environ()
	for _, key := range []string{
		"RAPTIX_STACK_NAME",
		ComposeProjectEnv,
	} {
		if _, ok := os.LookupEnv(key); !ok {
			env = append(env, key+"=")
		}
	}
	// Clear COMPOSE_PROFILES in the child so only explicitly selected profiles start.
	env = append(env, "COMPOSE_PROFILES=")
	return env
}
