package opscontrol

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/Akapi895/raptix/apps/launcher/internal/config"
)

// DockerComposeBackend delegates profile and dependency resolution to Docker Compose.
type DockerComposeBackend struct {
	// ComposeFile, EnvFile and extra files form the shared Compose arguments.
	ComposeFile string
	EnvFile     string
	ExtraFiles  []string
	// WaitTimeoutSeconds caps startup time, including cold-start migrations.
	WaitTimeoutSeconds int
	runs sync.Map
}

// NewDockerComposeBackend constructs a backend with the launcher's
// standard $RAPTIX_HOME paths.
func NewDockerComposeBackend() *DockerComposeBackend {
	home := config.RaptixHome()
	return &DockerComposeBackend{
		ComposeFile:        filepath.Join(home, "docker-compose.yml"),
		EnvFile:            filepath.Join(home, ".env"),
		WaitTimeoutSeconds: 180,
	}
}

func (b *DockerComposeBackend) Name() string { return "docker-compose" }

// baseArgs uses the launcher's project name so both can manage the same containers.
func (b *DockerComposeBackend) baseArgs() []string {
	args := []string{
		"compose",
		"-p", ComposeProjectName(),
		"-f", b.ComposeFile,
		"--env-file", b.EnvFile,
	}
	for _, f := range b.ExtraFiles {
		args = append(args, "-f", f)
	}
	return args
}



type workloadRun struct {
	engagement string
	runID      string
}

func newRunID() (string, error) {
	var bytes [12]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("generate workload run id: %w", err)
	}
	return hex.EncodeToString(bytes[:]), nil
}

func labeledComposeOverride(services []string, workload, engagement, runID string) (string, error) {
	override := map[string]map[string]map[string]map[string]string{"services": {}}
	for _, service := range services {
		override["services"][service] = map[string]map[string]string{
			"labels": {
				"raptix.engagement": engagement,
				"raptix.run":        runID,
				"raptix.workload":   workload,
			},
		}
	}
	contents, err := json.Marshal(override)
	if err != nil {
		return "", fmt.Errorf("encode workload labels: %w", err)
	}
	file, err := os.CreateTemp("", "raptix-ops-labels-*.json")
	if err != nil {
		return "", fmt.Errorf("create workload label override: %w", err)
	}
	if _, err := file.Write(contents); err != nil {
		_ = file.Close()
		_ = os.Remove(file.Name())
		return "", fmt.Errorf("write workload label override: %w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(file.Name())
		return "", fmt.Errorf("close workload label override: %w", err)
	}
	return file.Name(), nil
}
// Start waits for the selected workload. The caller holds its lock.
// --no-recreate prevents adding a profile from replacing running services.
func (b *DockerComposeBackend) Start(ctx context.Context, workload, engagementID string) (Handle, error) {
	if engagementID == "" {
		return Handle{}, fmt.Errorf("workload %s requires an engagement id", workload)
	}
	services, err := b.profileExclusiveServices(ctx, workload)
	if err != nil {
		return Handle{}, err
	}
	runID, err := newRunID()
	if err != nil {
		return Handle{}, err
	}
	override, err := labeledComposeOverride(services, workload, engagementID, runID)
	if err != nil {
		return Handle{}, err
	}
	defer os.Remove(override)
	args := append(b.baseArgs(), "-f", override)
	args = append(args,
		"--profile", workload,
		"up", "-d", "--no-build", "--no-recreate", "--wait",
		"--wait-timeout", fmt.Sprintf("%d", b.WaitTimeoutSeconds),
	)
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Env = ComposeCommandEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return Handle{}, fmt.Errorf("compose up --profile %s: %w: %s", workload, err, strings.TrimSpace(string(out)))
	}
	b.runs.Store(workload, workloadRun{engagement: engagementID, runID: runID})
	return Handle{Workload: workload, State: StateRunning, EngagementID: engagementID}, nil
}

// Stop removes only services unique to the selected profile and leaves volumes intact.
// Compose profile flags also select default services, so pass explicit service names.
func (b *DockerComposeBackend) Stop(ctx context.Context, workload string) error {
	value, ok := b.runs.Load(workload)
	if !ok {
		return fmt.Errorf("workload %s has no run label; refusing unscoped teardown", workload)
	}
	run := value.(workloadRun)
	filterArgs := []string{
		"ps", "-aq",
		"--filter", "label=raptix.engagement=" + run.engagement,
		"--filter", "label=raptix.run=" + run.runID,
		"--filter", "label=raptix.workload=" + workload,
	}
	psCmd := exec.CommandContext(ctx, "docker", filterArgs...)
	out, err := psCmd.Output()
	if err != nil {
		return fmt.Errorf("list workload containers: %w", err)
	}
	containers := strings.Fields(string(out))
	if len(containers) == 0 {
		b.runs.Delete(workload)
		return nil
	}
	stopCmd := exec.CommandContext(ctx, "docker", append([]string{"stop"}, containers...)...)
	if out, err := stopCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("stop workload containers: %w: %s", err, strings.TrimSpace(string(out)))
	}
	rmCmd := exec.CommandContext(ctx, "docker", append([]string{"rm", "-f"}, containers...)...)
	if out, err := rmCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("remove workload containers: %w: %s", err, strings.TrimSpace(string(out)))
	}
	b.runs.Delete(workload)
	return nil
}
func (b *DockerComposeBackend) profileExclusiveServices(ctx context.Context, workload string) ([]string, error) {
	withProfile, err := b.listServices(ctx, workload)
	if err != nil {
		return nil, fmt.Errorf("list services for profile %s: %w", workload, err)
	}
	defaults, err := b.listServices(ctx, "")
	if err != nil {
		return nil, fmt.Errorf("list default services: %w", err)
	}
	defaultSet := make(map[string]struct{}, len(defaults))
	for _, s := range defaults {
		defaultSet[s] = struct{}{}
	}
	var exclusive []string
	for _, s := range withProfile {
		if _, isDefault := defaultSet[s]; !isDefault {
			exclusive = append(exclusive, s)
		}
	}
	return exclusive, nil
}

// listServices runs `docker compose config --services [--profile X]`
// and returns the parsed service-name list.
func (b *DockerComposeBackend) listServices(ctx context.Context, profile string) ([]string, error) {
	args := b.baseArgs()
	if profile != "" {
		args = append(args, "--profile", profile)
	}
	args = append(args, "config", "--services")
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Env = ComposeCommandEnv()
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("compose config --services profile=%q: %w", profile, err)
	}
	var names []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if s := strings.TrimSpace(line); s != "" {
			names = append(names, s)
		}
	}
	return names, nil
}

// List reads the registry rather than polling Compose.
func (b *DockerComposeBackend) List(_ context.Context) ([]WorkloadStatus, error) {
	// The server passes its own registry snapshot in; this backend
	// returns nil to mean "use the registry".
	return nil, nil
}
