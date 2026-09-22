// Package sandbox defines the execution environment boundary for command
// capabilities. A Runner executes a process with the least authority a
// capability needs. Concrete runners (host and container) live in subpackages
// so that only the composition root can construct one; execution and tools
// depend on this interface alone.
package sandbox

import (
	"context"
	"io"
	"time"
)

// Spec describes one isolated process invocation. Fields are the contract
// between a command capability and the environment that runs it.
type Spec struct {
	Command   string
	Args      []string
	Env       []string // extra env, merged over a minimal sandbox base
	WorkDir   string
	Network   bool
	Resources map[string]any
	MaxOutput int64 // per-stream output cap in bytes; 0 = runner default
}

// Result is what the environment returns after attempting to run a Spec.
type Result struct {
	ExitCode  int
	Stdout    []byte
	Stderr    []byte
	TimedOut  bool
	Duration  time.Duration
	Truncated bool
}

// Runner executes a Spec until it exits, is killed by its context, or is capped.
// A non-zero exit is not an error: it is surfaced on Result.ExitCode so callers
// can decide. The returned error is reserved for environment failures (e.g. the
// binary could not be started) or a context that ended the run.
type Runner interface {
	Run(ctx context.Context, spec Spec, stdin io.Reader) (Result, error)
}
