//go:build !windows

package cmd

import (
	"os"
	"os/exec"
	"syscall"
)

// setControllerDetached puts the spawned controller in its own session so
// it survives the launcher exiting (no controlling terminal, not in the
// launcher's process group).
func setControllerDetached(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}

// controllerProcessAlive reports whether pid names a live process. Signal
// 0 does not deliver a signal; it only runs the kernel's existence check.
func controllerProcessAlive(pid int) bool {
	return syscall.Kill(pid, syscall.Signal(0)) == nil
}

// killControllerProcess sends SIGTERM so the controller's graceful
// shutdown (signal.NotifyContext in runSandboxController) runs.
func killControllerProcess(pid int) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return p.Signal(syscall.SIGTERM)
}
