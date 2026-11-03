package sandboxes

import (
	"os"
	"os/exec"
)

// ExecRunner runs the runtime binary, passing its output through to the operator.
type ExecRunner struct{}

func (ExecRunner) Output(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	return string(out), err
}

func (ExecRunner) Run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
