//go:build windows

package updater

import (
	"fmt"
	"os"
	"os/exec"
)

// reexecSelf starts the updated launcher with inherited streams and exits with its status.
func reexecSelf() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()
	if err := cmd.Run(); err != nil {
		// Propagate the child's exit status.
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		return fmt.Errorf("spawn %s: %w", exe, err)
	}
	os.Exit(0)
	return nil // unreachable
}
