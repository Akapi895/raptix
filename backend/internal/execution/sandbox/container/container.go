// Package container provides the production sandbox runner. It is a concrete
// adapter constructed only by the composition root.
package container

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strconv"
	"time"

	"github.com/Akapi895/raptix/backend/internal/execution/sandbox"
	"github.com/Akapi895/raptix/backend/internal/execution/sandbox/internal/capture"
)

// Config configures the container sandbox.
type Config struct {
	Image          string
	Network        bool
	MaxOutputBytes int64
	CPUs           string // e.g. "1"
	Memory         string // e.g. "512m"
}

// Runner runs each capability in an ephemeral container so a capability cannot
// touch the host filesystem, environment or network beyond what its Spec
// allows. It drives the docker CLI; a deployment needing a tighter integration
// can replace it without touching execution or tools.
type Runner struct {
	cfg       Config
	maxOutput int64
	bin       string
	log       *slog.Logger
}

// New validates that a container runtime is available. It fails fast when
// docker is missing so a misconfigured production deployment does not silently
// run commands on the host.
func New(cfg Config, log *slog.Logger) (*Runner, error) {
	if cfg.Image == "" {
		return nil, fmt.Errorf("sandbox container image is required")
	}
	bin, err := exec.LookPath("docker")
	if err != nil {
		return nil, fmt.Errorf("container sandbox requires the docker CLI: %w", err)
	}
	if log == nil {
		log = slog.Default()
	}
	max := cfg.MaxOutputBytes
	if max <= 0 {
		max = capture.DefaultMaxOutput
	}
	return &Runner{cfg: cfg, maxOutput: max, bin: bin, log: log}, nil
}

// Run starts a container, captures its streams, and waits for exit. Non-zero
// exits are surfaced on Result.ExitCode; a context deadline maps to TimedOut.
func (r *Runner) Run(ctx context.Context, spec sandbox.Spec, stdin io.Reader) (sandbox.Result, error) {
	if spec.Command == "" {
		return sandbox.Result{}, fmt.Errorf("command is required")
	}
	args := r.buildArgs(spec)

	cmd := exec.CommandContext(ctx, r.bin, args...)
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

// buildArgs assembles the docker run command. The container is ephemeral, runs
// with no host network unless the Spec asks for it, and is resource-bounded.
func (r *Runner) buildArgs(spec sandbox.Spec) []string {
	netMode := "none"
	if spec.Network || r.cfg.Network {
		netMode = "bridge"
	}
	args := []string{"run", "--rm", "--network", netMode, "--read-only"}
	if r.cfg.CPUs != "" {
		args = append(args, "--cpus", r.cfg.CPUs)
	}
	if r.cfg.Memory != "" {
		args = append(args, "--memory", r.cfg.Memory)
	}
	if cpu, ok := resourceString(spec.Resources, "cpu"); ok {
		args = append(args, "--cpus", cpu)
	}
	if mem, ok := resourceString(spec.Resources, "memory"); ok {
		args = append(args, "--memory", mem)
	}
	for _, e := range spec.Env {
		args = append(args, "-e", e)
	}
	args = append(args, r.cfg.Image, spec.Command)
	args = append(args, spec.Args...)
	return args
}

// resourceString reads a resource limit from a Spec.Resources map, accepting
// both string and numeric values.
func resourceString(m map[string]any, key string) (string, bool) {
	if m == nil {
		return "", false
	}
	v, ok := m[key]
	if !ok {
		return "", false
	}
	switch t := v.(type) {
	case string:
		return t, t != ""
	case int:
		return strconv.Itoa(t), true
	case int64:
		return strconv.FormatInt(t, 10), true
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64), true
	default:
		return "", false
	}
}
