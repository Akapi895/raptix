package opscontrol

import (
	"errors"
	"runtime"
)

// ServiceManager controls the host service through systemd or launchd.
// Unmanaged hosts use a detached process. Service operations are idempotent.
type ServiceManager interface {
	// Name returns the implementation tag for diagnostics
	// ("systemd-user", "launchd", "none").
	Name() string

	// Available reports whether this host can use the manager.
	Available() bool

	// Installed checks whether the service unit exists, even when stopped.
	Installed() (bool, error)

	// Active reports whether the service is currently running per the
	// init system. For noop returns false.
	Active() (bool, error)

	// Install refreshes and enables the unit, then starts the service.
	Install(spec InstallSpec) error

	// Uninstall stops the service, disables it, and removes the unit
	// file. Idempotent: a never-installed unit is a no-op.
	Uninstall() error

	// Start starts the service if installed but not active.
	// No-op when already active. Errors when not installed.
	Start() error

	// Stop stops the service if active. No-op when already inactive.
	Stop() error
}

// InstallSpec holds the resolved paths and stack name for the service definition.
type InstallSpec struct {
	// BinaryPath is the absolute launcher path used by the service.
	BinaryPath string

	// HomePath is the absolute RAPTIX_HOME used by the launcher and daemon.
	HomePath string

	// StackName scopes the unit name and socket path to one stack.
	StackName string
}

// DetectServiceManager prefers systemd on Linux and launchd on macOS.
// Other hosts use the launcher-spawn fallback.
func DetectServiceManager() ServiceManager {
	switch runtime.GOOS {
	case "linux":
		sm := newSystemdManager()
		if sm.Available() {
			return sm
		}
	case "darwin":
		lm := newLaunchdManager()
		if lm.Available() {
			return lm
		}
	}
	return noopManager{}
}

// ErrNotInstalled is returned by Start when the unit is not present.
var ErrNotInstalled = errors.New("opscontrol: service is not installed; run `raptix opscontrol install` first")

// noopManager represents an unsupported or unavailable service manager.
type noopManager struct{}

func (noopManager) Name() string                  { return "none" }
func (noopManager) Available() bool               { return false }
func (noopManager) Installed() (bool, error)      { return false, nil }
func (noopManager) Active() (bool, error)         { return false, nil }
func (noopManager) Install(_ InstallSpec) error   { return errors.New("opscontrol: no service manager available on this host (falling back to launcher-spawned mode)") }
func (noopManager) Uninstall() error              { return nil }
func (noopManager) Start() error                  { return ErrNotInstalled }
func (noopManager) Stop() error                   { return nil }
