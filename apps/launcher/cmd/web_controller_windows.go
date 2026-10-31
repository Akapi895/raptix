//go:build windows

package cmd

import (
	"os"
	"os/exec"
	"syscall"
)

// setControllerDetached puts the spawned controller in its own process
// group so a Ctrl-C in the launcher console does not propagate to it
// (same approach as opscontrol's launcher-spawn fallback).
func setControllerDetached(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

// controllerProcessAlive reports whether pid names a live process. On
// Windows os.FindProcess opens a handle via OpenProcess and fails when
// the PID is not running, which is a good-enough liveness probe.
func controllerProcessAlive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	_ = p.Release()
	return true
}

// killControllerProcess stops the controller. Windows has no SIGTERM, so
// this is a hard terminate; the HTTP server has no in-flight requests to
// drain in the stop path that matters (project creation either finished
// or the caller saw the error).
func killControllerProcess(pid int) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return p.Kill()
}
