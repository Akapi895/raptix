//go:build !windows

package updater

import (
	"fmt"
	"os"
	"syscall"
)

// reexecSelf replaces the process with the updated launcher and keeps its arguments and environment.
// It returns only if exec fails.
func reexecSelf() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}
	// Exec preserves standard streams and descriptors without FD_CLOEXEC.
	if err := syscall.Exec(exe, os.Args, os.Environ()); err != nil {
		return fmt.Errorf("exec %s: %w", exe, err)
	}
	return nil // unreachable on success
}
