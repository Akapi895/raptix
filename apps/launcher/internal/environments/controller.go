package environments

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

var (
	ErrNotFound           = errors.New("resource not found")
	ErrForeignResource    = errors.New("a resource with this name is not owned by this environment")
	ErrGenerationMismatch = errors.New("resource belongs to another generation")
	ErrRunning            = errors.New("container must be stopped first")
	ErrStillRunning       = errors.New("container is still running after stop")
	ErrImageMissing       = errors.New("image is not present locally; pull it explicitly before starting")
	ErrUnavailable        = errors.New("docker or a required shared resource is unavailable")
)

// Runner executes the docker client with argv only. It never goes through a shell.
type Runner interface {
	Run(ctx context.Context, args ...string) (stdout, stderr string, err error)
}

// ExecRunner runs the local docker client.
type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, args ...string) (string, string, error) {
	cmd := exec.CommandContext(ctx, "docker", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		// Operator diagnostics only: the verb and the first line of docker's own message. The caller never sees it.
		fmt.Fprintf(os.Stderr, "environment controller: docker %s failed: %s\n", strings.Join(args[:min(2, len(args))], " "), firstLine(stderr.String()))
	}
	return stdout.String(), stderr.String(), err
}

func firstLine(text string) string {
	if i := strings.IndexByte(text, '\n'); i >= 0 {
		return strings.TrimSpace(text[:i])
	}
	return strings.TrimSpace(text)
}

// Config is the host's trusted configuration. Callers never supply these values.
type Config struct {
	WorkspaceRoot     string
	ManagementNetwork string
	Images            []string
	MemoryBytes       int64
	PidsLimit         int
	// RuntimeEnv is granted to runtimes only, after ValidateRuntimeEnv. Empty means none.
	RuntimeEnv map[string]string
	// Resolve returns the real path behind a host path. Default: filepath.EvalSymlinks.
	Resolve func(string) (string, error)
}

// Request is the caller's view. Name, network, volume, mount and image authority come from the host.
type Request struct {
	Identity          Identity `json:"identity"`
	Image             string   `json:"image"`
	WorkspaceSlug     string   `json:"workspaceSlug"`
	WorkspaceHostPath string   `json:"workspaceHostPath"`
	StopTimeoutSecs   int      `json:"stopTimeoutSeconds"`
}

// Observation is what docker reports for one container.
type Observation struct {
	Name       string `json:"name"`
	Exists     bool   `json:"exists"`
	Running    bool   `json:"running"`
	Generation int64  `json:"generation"`
	// Health is docker's health status when the image declares a check: "starting", "healthy", "unhealthy". Empty otherwise.
	Health string `json:"health"`
}

type Controller struct {
	runner  Runner
	cfg     Config
	images  ImagePolicy
	resolve func(string) (string, error)
}

func New(runner Runner, cfg Config) (*Controller, error) {
	images, err := NewImagePolicy(cfg.Images)
	if err != nil {
		return nil, err
	}
	if _, err := cleanHostPath(cfg.WorkspaceRoot); err != nil {
		return nil, fmt.Errorf("workspace root: %w", err)
	}
	if cfg.ManagementNetwork == "" || strings.ContainsAny(cfg.ManagementNetwork, ",= \t") {
		return nil, fmt.Errorf("%w: management network", errInvalidSpec)
	}
	if err := ValidateRuntimeEnv(cfg.RuntimeEnv); err != nil {
		return nil, err
	}
	resolve := cfg.Resolve
	if resolve == nil {
		resolve = filepath.EvalSymlinks
	}
	return &Controller{runner: runner, cfg: cfg, images: images, resolve: resolve}, nil
}

// Ensure creates the environment's resources if they are absent and returns the
// observed state. It never pulls images and never adopts a foreign resource.
func (c *Controller) Ensure(ctx context.Context, req Request) (Observation, error) {
	spec, err := c.spec(req)
	if err != nil {
		return Observation{}, err
	}
	id := req.Identity
	// The image must already be here before anything is created, so a missing image leaves no network or volume behind.
	if _, stderr, err := c.runner.Run(ctx, "image", "inspect", "--format", "{{.Id}}", req.Image); err != nil {
		if isMissingImage(stderr) {
			return Observation{}, ErrImageMissing
		}
		return Observation{}, ErrUnavailable
	}
	existing, err := c.inspectContainer(ctx, id.ContainerName())
	if err != nil {
		return Observation{}, err
	}
	if existing != nil {
		if !id.Owns(existing.Config.Labels) {
			return Observation{}, ErrForeignResource
		}
		if gen := generationOf(existing.Config.Labels); gen != id.Generation {
			return Observation{}, ErrGenerationMismatch
		}
		if err := c.ensureManagementNetwork(ctx, id, existing); err != nil {
			return Observation{}, err
		}
		return observationOf(id.ContainerName(), existing), nil
	}
	if err := c.ensureNetwork(ctx, id); err != nil {
		return Observation{}, err
	}
	if id.Role == RoleRuntime {
		if err := c.ensureVolume(ctx, id); err != nil {
			return Observation{}, err
		}
	}
	args, err := spec.CreateArgs()
	if err != nil {
		return Observation{}, err
	}
	if _, stderr, err := c.runner.Run(ctx, args...); err != nil {
		if strings.Contains(stderr, "Unable to find image") || strings.Contains(stderr, "No such image") {
			return Observation{}, ErrImageMissing
		}
		return Observation{}, ErrUnavailable
	}
	if id.Role == RoleRuntime {
		if err := c.connectManagement(ctx, id.ContainerName()); err != nil {
			return Observation{}, err
		}
	}
	created, err := c.inspectContainer(ctx, id.ContainerName())
	if err != nil || created == nil {
		return Observation{}, ErrUnavailable
	}
	return observationOf(id.ContainerName(), created), nil
}

// Start starts an owned container at the given generation.
func (c *Controller) Start(ctx context.Context, id Identity) (Observation, error) {
	if _, err := c.owned(ctx, id); err != nil {
		return Observation{}, err
	}
	if _, _, err := c.runner.Run(ctx, "start", id.ContainerName()); err != nil {
		return Observation{}, ErrUnavailable
	}
	return c.Observe(ctx, id)
}

// Stop asks docker to stop the container. If it is still running afterwards the
// caller gets ErrStillRunning, and the slot must stay held.
func (c *Controller) Stop(ctx context.Context, id Identity, timeoutSecs int) (Observation, error) {
	if timeoutSecs < 1 || timeoutSecs > 300 {
		return Observation{}, fmt.Errorf("%w: stop timeout", errInvalidSpec)
	}
	if _, err := c.owned(ctx, id); err != nil {
		return Observation{}, err
	}
	if _, _, err := c.runner.Run(ctx, "stop", "-t", strconv.Itoa(timeoutSecs), id.ContainerName()); err != nil {
		return Observation{}, ErrUnavailable
	}
	observed, err := c.Observe(ctx, id)
	if err != nil {
		return Observation{}, err
	}
	if observed.Running {
		return observed, ErrStillRunning
	}
	return observed, nil
}

// Recreate replaces an owned, stopped container with a higher generation.
// Workspace and state volumes are kept.
func (c *Controller) Recreate(ctx context.Context, req Request) (Observation, error) {
	existing, err := c.inspectContainer(ctx, req.Identity.ContainerName())
	if err != nil {
		return Observation{}, err
	}
	if existing != nil {
		if !req.Identity.Owns(existing.Config.Labels) {
			return Observation{}, ErrForeignResource
		}
		if generationOf(existing.Config.Labels) >= req.Identity.Generation {
			return Observation{}, ErrGenerationMismatch
		}
		if existing.State.Running {
			return Observation{}, ErrRunning
		}
		if _, _, err := c.runner.Run(ctx, "rm", req.Identity.ContainerName()); err != nil {
			return Observation{}, ErrUnavailable
		}
	}
	return c.Ensure(ctx, req)
}

// Remove deletes an owned, stopped container. Volumes and networks stay until
// the explicit delete flow of I06.
func (c *Controller) Remove(ctx context.Context, id Identity) error {
	container, err := c.owned(ctx, id)
	if err != nil {
		return err
	}
	if container.State.Running {
		return ErrRunning
	}
	if _, _, err := c.runner.Run(ctx, "rm", id.ContainerName()); err != nil {
		return ErrUnavailable
	}
	return nil
}

// Observe reports the container's state. A container that exists without this
// environment's labels is reported as ErrForeignResource and is never touched.
func (c *Controller) Observe(ctx context.Context, id Identity) (Observation, error) {
	if err := id.Validate(); err != nil {
		return Observation{}, err
	}
	container, err := c.inspectContainer(ctx, id.ContainerName())
	if err != nil {
		return Observation{}, err
	}
	if container == nil {
		return Observation{Name: id.ContainerName(), Exists: false}, nil
	}
	if !id.Owns(container.Config.Labels) {
		return Observation{}, ErrForeignResource
	}
	return observationOf(id.ContainerName(), container), nil
}

// owned returns the container only when its labels and generation match exactly.
func (c *Controller) owned(ctx context.Context, id Identity) (*containerInspect, error) {
	if err := id.Validate(); err != nil {
		return nil, err
	}
	container, err := c.inspectContainer(ctx, id.ContainerName())
	if err != nil {
		return nil, err
	}
	if container == nil {
		return nil, ErrNotFound
	}
	if !id.Owns(container.Config.Labels) {
		return nil, ErrForeignResource
	}
	if generationOf(container.Config.Labels) != id.Generation {
		return nil, ErrGenerationMismatch
	}
	return container, nil
}

func (c *Controller) spec(req Request) (Spec, error) {
	if err := req.Identity.Validate(); err != nil {
		return Spec{}, err
	}
	if err := c.images.Check(req.Image); err != nil {
		return Spec{}, err
	}
	host, err := c.hostWorkspace(req.WorkspaceHostPath)
	if err != nil {
		return Spec{}, err
	}
	return Spec{
		Identity:          req.Identity,
		Image:             req.Image,
		WorkspaceSlug:     req.WorkspaceSlug,
		WorkspaceHostPath: host,
		MemoryBytes:       c.cfg.MemoryBytes,
		PidsLimit:         c.cfg.PidsLimit,
		RuntimeEnv:        c.cfg.RuntimeEnv,
	}, nil
}

// hostWorkspace refuses a path whose real location, after symlink resolution, is outside the root.
func (c *Controller) hostWorkspace(raw string) (string, error) {
	norm, err := NormalizeHostPath(c.cfg.WorkspaceRoot, raw)
	if err != nil {
		return "", err
	}
	real, err := c.resolve(norm)
	if err != nil {
		return "", ErrRejectedPath
	}
	realNorm, err := NormalizeHostPath(c.cfg.WorkspaceRoot, real)
	if err != nil || !strings.EqualFold(realNorm, norm) {
		return "", ErrRejectedPath
	}
	return norm, nil
}

func (c *Controller) ensureManagementNetwork(ctx context.Context, id Identity, container *containerInspect) error {
	if id.Role != RoleRuntime {
		return nil
	}
	if _, joined := container.NetworkSettings.Networks[c.cfg.ManagementNetwork]; joined {
		return nil
	}
	return c.connectManagement(ctx, id.ContainerName())
}

func (c *Controller) connectManagement(ctx context.Context, container string) error {
	if _, _, err := c.runner.Run(ctx, "network", "inspect", c.cfg.ManagementNetwork); err != nil {
		return ErrUnavailable
	}
	if _, _, err := c.runner.Run(ctx, "network", "connect", c.cfg.ManagementNetwork, container); err != nil {
		return ErrUnavailable
	}
	return nil
}

func (c *Controller) ensureNetwork(ctx context.Context, id Identity) error {
	labels, err := c.inspectLabels(ctx, "network", id.NetworkName())
	if err != nil {
		return err
	}
	if labels != nil {
		if !id.OwnsShared(labels) {
			return ErrForeignResource
		}
		return nil
	}
	return c.createWithLabels(ctx, "network", id.NetworkName(), id.SharedLabels())
}

func (c *Controller) ensureVolume(ctx context.Context, id Identity) error {
	labels, err := c.inspectLabels(ctx, "volume", id.StateVolumeName())
	if err != nil {
		return err
	}
	if labels != nil {
		if !id.OwnsShared(labels) {
			return ErrForeignResource
		}
		return nil
	}
	return c.createWithLabels(ctx, "volume", id.StateVolumeName(), id.SharedLabels())
}

func (c *Controller) createWithLabels(ctx context.Context, kind, name string, labels map[string]string) error {
	args := []string{kind, "create"}
	for _, key := range sortedKeys(labels) {
		args = append(args, "--label", key+"="+labels[key])
	}
	args = append(args, name)
	if _, _, err := c.runner.Run(ctx, args...); err != nil {
		return ErrUnavailable
	}
	return nil
}

// inspectLabels returns nil labels with no error when the network or volume is absent.
func (c *Controller) inspectLabels(ctx context.Context, kind, name string) (map[string]string, error) {
	stdout, stderr, err := c.runner.Run(ctx, kind, "inspect", "--format", "{{json .Labels}}", name)
	if err != nil {
		if isNotFound(stderr) {
			return nil, nil
		}
		return nil, ErrUnavailable
	}
	var labels map[string]string
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &labels); err != nil {
		return nil, ErrUnavailable
	}
	if labels == nil {
		labels = map[string]string{}
	}
	return labels, nil
}

// inspectContainer returns nil with no error when the container is absent.
func (c *Controller) inspectContainer(ctx context.Context, name string) (*containerInspect, error) {
	stdout, stderr, err := c.runner.Run(ctx, "inspect", "--type", "container", name)
	if err != nil {
		if isNotFound(stderr) {
			return nil, nil
		}
		return nil, ErrUnavailable
	}
	var found []containerInspect
	if err := json.Unmarshal([]byte(stdout), &found); err != nil || len(found) != 1 {
		return nil, ErrUnavailable
	}
	return &found[0], nil
}

type containerInspect struct {
	Config struct {
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
	State struct {
		Running bool `json:"Running"`
		Health  struct {
			Status string `json:"Status"`
		} `json:"Health"`
	} `json:"State"`
	NetworkSettings struct {
		Networks map[string]json.RawMessage `json:"Networks"`
	} `json:"NetworkSettings"`
}

func observationOf(name string, container *containerInspect) Observation {
	return Observation{Name: name, Exists: true, Running: container.State.Running, Generation: generationOf(container.Config.Labels), Health: container.State.Health.Status}
}

func generationOf(labels map[string]string) int64 {
	gen, err := strconv.ParseInt(labels[LabelGeneration], 10, 64)
	if err != nil {
		return -1
	}
	return gen
}

// isNotFound reports a daemon answer that a resource is absent. Docker words it differently per kind: "No such
// container", "No such volume", "network X not found". Only a daemon error counts, so a missing docker client
// binary is never mistaken for an absent resource.
func isNotFound(stderr string) bool {
	lower := strings.ToLower(stderr)
	return strings.Contains(lower, "error response from daemon") && (strings.Contains(lower, "no such") || strings.Contains(lower, "not found"))
}

// isMissingImage reports the daemon's answer for an image that is not present locally.
func isMissingImage(stderr string) bool {
	lower := strings.ToLower(stderr)
	return strings.Contains(lower, "no such image") || strings.Contains(lower, "unable to find image")
}
