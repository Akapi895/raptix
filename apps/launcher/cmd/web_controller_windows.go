//go:build windows

package cmd

import (
	"os"
	"os/exec"
	"syscall"
)

// setControllerDetached keeps the launcher's Ctrl-C from reaching the controller.
func setControllerDetached(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

// controllerProcessAlive checks whether Windows can open the process.
func controllerProcessAlive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	_ = p.Release()
	return true
}

// killControllerProcess terminates the controller because Windows has no SIGTERM.
func killControllerProcess(pid int) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return p.Kill()
}
