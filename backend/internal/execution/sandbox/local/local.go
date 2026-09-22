// Package local provides the host sandbox runner used for lab and CI. It is a
// concrete adapter: only the composition root constructs it, so business
// packages can never accidentally run a process on the host.
package local

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"time"

	"github.com/Akapi895/raptix/backend/internal/execution/sandbox"
	"github.com/Akapi895/raptix/backend/internal/execution/sandbox/internal/capture"
)

// Runner runs a command directly on the host. It never shells out, sets a
// minimal environment rather than inheriting the parent's, and caps each
// captured stream so a misbehaving capability cannot exhaust memory.
type Runner struct {
	maxOutput int64
	log       *slog.Logger
}

// New wires a host runner. maxOutput caps each stream (0 = default).
func New(maxOutput int64, log *slog.Logger) *Runner {
	if maxOutput <= 0 {
		maxOutput = capture.DefaultMaxOutput
	}
	if log == nil {
		log = slog.Default()
	}
	return &Runner{maxOutput: maxOutput, log: log}
}

// Run starts the process, captures its streams, and waits for exit. When the
// command exceeds its context deadline the process is killed and Result.TimedOut
// is reported.
func (r *Runner) Run(ctx context.Context, spec sandbox.Spec, stdin io.Reader) (sandbox.Result, error) {
	if spec.Command == "" {
		return sandbox.Result{}, fmt.Errorf("command is required")
	}
	cmd := exec.CommandContext(ctx, spec.Command, spec.Args...)
	if spec.WorkDir != "" {
		cmd.Dir = spec.WorkDir
	}
	cmd.Env = r.baseEnv(spec.Env)
	if stdin != nil {
		cmd.Stdin = stdin
	}

	maxOut := r.maxOutput
	if spec.MaxOutput > 0 {
		maxOut = spec.MaxOutput
	}
	stdout := capture.NewBuffer(maxOut)
	stderr := capture.NewBuffer(maxOut)
	cmd.Stdout = stdout
	cmd.Stderr = stderr

	start := time.Now()
	runErr := cmd.Run()
	elapsed := time.Since(start)

	res := sandbox.Result{
		Stdout:    stdout.Bytes(),
		Stderr:    stderr.Bytes(),
		Duration:  elapsed,
		Truncated: stdout.Truncated() || stderr.Truncated(),
	}

	if runErr != nil {
		if ctx.Err() == context.DeadlineExceeded {
			res.TimedOut = true
			return res, nil
		}
		if ee, ok := runErr.(*exec.ExitError); ok {
			res.ExitCode = ee.ExitCode()
			return res, nil
		}
		return res, runErr
	}
	return res, nil
}

// baseEnv builds a minimal sandbox environment. It does not inherit the parent
// process environment wholesale: only a small, predictable set is preserved and
// merged with the capability's requested extra variables.
func (r *Runner) baseEnv(extra []string) []string {
	base := []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + os.Getenv("HOME"),
		"LANG=C",
		"LC_ALL=C",
	}
	if tz := os.Getenv("TZ"); tz != "" {
		base = append(base, "TZ="+tz)
	}
	return append(base, extra...)
}
