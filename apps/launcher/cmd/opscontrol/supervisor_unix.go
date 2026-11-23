//go:build !windows

package opscontrol

import (
	"os/exec"
	"syscall"
)

// terminateDaemon sends SIGTERM to the daemon process group.
func terminateDaemon(pid int) error {
	return syscall.Kill(pid, syscall.SIGTERM)
}

// processAlive checks existence and permissions with signal 0.
func processAlive(pid int) bool {
	return syscall.Kill(pid, syscall.Signal(0)) == nil
}

// setDetached starts a new session so the daemon outlives the launcher.
func setDetached(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
