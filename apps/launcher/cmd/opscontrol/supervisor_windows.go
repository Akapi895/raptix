//go:build windows

package opscontrol

import (
	"os"
	"os/exec"
	"syscall"
)

// Windows uses the detached daemon fallback.

// terminateDaemon stops the daemon process. Windows has no SIGTERM, so
// this is a hard terminate.
func terminateDaemon(pid int) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return p.Kill()
}

// processAlive checks whether Windows can open the process.
func processAlive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	_ = p.Release()
	return true
}

// setDetached starts the daemon in its own process group so a Ctrl-C in
// the launcher console does not propagate to it.
func setDetached(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}
