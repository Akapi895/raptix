//go:build !windows

package cmd

import (
	"os"
	"os/exec"
	"syscall"
)

// setControllerDetached starts a new session so the controller outlives the launcher.
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
