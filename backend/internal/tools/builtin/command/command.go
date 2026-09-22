// Package command implements capabilities backed by an external process. The
// process runs through an injected sandbox.Runner, never a shell, and its
// arguments are validated against a per-tool allowlist so user input cannot add
// flags the manifest did not sanction. The capability records stdout as raw
// evidence through workspace/evidence and returns refs; execution still owns
// permission and lifecycle decisions.
package command

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/Akapi895/raptix/backend/internal/execution/artifact"
	"github.com/Akapi895/raptix/backend/internal/execution/sandbox"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
)

// Options describes a command capability's fixed invocation shape.
type Options struct {
	Base         string   // executable, e.g. "nmap"
	BaseArgs     []string // args always applied before user flags
	AllowedFlags []string // exact user flags this capability may add
	MaxOutput    int64    // per-stream output cap; 0 = runner default
}

// Command runs a validated external process through a sandbox.Runner.
type Command struct {
	name    string
	opts    Options
	allowed map[string]struct{}
	runner  sandbox.Runner
	writer  *artifact.Writer
}

// New wires a command capability.
func New(name string, opts Options, runner sandbox.Runner, writer *artifact.Writer) *Command {
	allowed := make(map[string]struct{}, len(opts.AllowedFlags))
	for _, f := range opts.AllowedFlags {
		allowed[f] = struct{}{}
	}
	return &Command{name: name, opts: opts, allowed: allowed, runner: runner, writer: writer}
}

type args struct {
	Target string   `json:"target"`
	Ports  string   `json:"ports"`
	Flags  []string `json:"flags"`
}

var portsRe = regexp.MustCompile(`^[0-9,\-]{1,64}$`)

// Invoke validates args, runs the process, records stdout as raw evidence, and
// returns a result carrying the artifact ref and exit code.
func (c *Command) Invoke(ctx context.Context, raw json.RawMessage) (*output.Result, error) {
	var a args
	if err := json.Unmarshal(raw, &a); err != nil {
		return output.Error("", fmt.Errorf("invalid %s args: %w", c.name, err)), nil
	}
	target := strings.TrimSpace(a.Target)
	if err := validateTarget(target); err != nil {
		return output.Error("", err), nil
	}
	ports := strings.TrimSpace(a.Ports)
	if ports != "" && !portsRe.MatchString(ports) {
		return output.Error("", fmt.Errorf("%s ports must be a comma/range list", c.name)), nil
	}
	for _, f := range a.Flags {
		if _, ok := c.allowed[f]; !ok {
			return output.Error("", fmt.Errorf("%s flag %q is not allowed", c.name, f)), nil
		}
	}

	cmdArgs := make([]string, 0, len(c.opts.BaseArgs)+len(a.Flags)+4)
	cmdArgs = append(cmdArgs, c.opts.BaseArgs...)
	cmdArgs = append(cmdArgs, a.Flags...)
	if ports != "" {
		cmdArgs = append(cmdArgs, "-p", ports)
	}
	cmdArgs = append(cmdArgs, target)

	run, err := c.runner.Run(ctx, sandbox.Spec{
		Command:   c.opts.Base,
		Args:      cmdArgs,
		Network:   true,
		MaxOutput: c.opts.MaxOutput,
	}, nil)
	if err != nil {
		return output.Error("", fmt.Errorf("%s run failed: %w", c.name, err)), nil
	}

	// Persist stdout as raw evidence even on non-zero exit or timeout: the
	// bytes behind a failed attempt are still the record of what happened.
	art, werr := c.writer.WriteRaw(ctx, nil, "text/plain", c.name+"-stdout/1.0", strings.NewReader(string(run.Stdout)))
	if werr != nil {
		return output.Error("", fmt.Errorf("record %s evidence: %w", c.name, werr)), nil
	}
	rawRef := art.ID.String()

	var res *output.Result
	switch {
	case run.TimedOut:
		res = output.Timeout(rawRef, fmt.Errorf("%s timed out", c.name))
	case run.ExitCode != 0:
		res = output.Error(rawRef, fmt.Errorf("%s exited with code %d", c.name, run.ExitCode))
	default:
		res = output.Success(rawRef, "", "")
	}
	code := run.ExitCode
	res.ExitCode = &code
	res.DurationMs = run.Duration.Milliseconds()
	if run.Truncated {
		res.AddDiagnostic("warning", "output truncated at the configured cap")
	}
	if len(run.Stderr) > 0 {
		res.AddDiagnostic("info", "stderr: "+truncate(string(run.Stderr), 512))
	}
	return res, nil
}

// validateTarget rejects an empty target and anything that could be read as a
// flag or split into multiple arguments.
func validateTarget(target string) error {
	if target == "" {
		return fmt.Errorf("target is required")
	}
	if strings.HasPrefix(target, "-") {
		return fmt.Errorf("target must not start with '-'")
	}
	if strings.ContainsAny(target, " \t\r\n") {
		return fmt.Errorf("target must not contain whitespace")
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
