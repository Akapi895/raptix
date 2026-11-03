package environments

import (
	"errors"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
)

// Container paths are canonical and fixed (ADR-0092 mount invariants).
const (
	RuntimeStatePath = "/app/.langgraph_api"
	workspacePrefix  = "/workspace/"
)

var (
	ErrRejectedPath    = errors.New("rejected host path")
	ErrRejectedImage   = errors.New("image is not a digest-pinned allowlisted reference")
	errInvalidSpec     = errors.New("invalid environment spec")
	digestRefPattern   = regexp.MustCompile(`^[a-z0-9][a-z0-9._/:-]{0,199}@sha256:[a-f0-9]{64}$`)
	workspaceSlug      = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$`)
	forbiddenPathRunes = regexp.MustCompile(`[\x00-\x1f\x7f,="']`)
	drivePrefix        = regexp.MustCompile(`^[A-Za-z]:/`)
)

// ImagePolicy accepts only the digest-pinned references the host was configured with.
type ImagePolicy struct{ allowed map[string]struct{} }

// NewImagePolicy rejects tags and unpinned references at configuration time.
func NewImagePolicy(refs []string) (ImagePolicy, error) {
	allowed := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		if !digestRefPattern.MatchString(ref) {
			return ImagePolicy{}, fmt.Errorf("%w: %q", ErrRejectedImage, ref)
		}
		allowed[ref] = struct{}{}
	}
	return ImagePolicy{allowed: allowed}, nil
}

func (p ImagePolicy) Check(ref string) error {
	if _, ok := p.allowed[ref]; !ok {
		return ErrRejectedImage
	}
	return nil
}

// NormalizeHostPath turns a Windows, WSL or POSIX host path into the form the
// Docker client expects, and proves it sits under root. It refuses ".." before
// cleaning, and any character that could add a mount option (",", "=", quotes).
func NormalizeHostPath(root, p string) (string, error) {
	clean, err := cleanHostPath(p)
	if err != nil {
		return "", err
	}
	base, err := cleanHostPath(root)
	if err != nil {
		return "", fmt.Errorf("workspace root: %w", err)
	}
	inside := clean == base || strings.HasPrefix(strings.ToLower(clean), strings.ToLower(strings.TrimSuffix(base, "/"))+"/")
	if !inside {
		return "", ErrRejectedPath
	}
	return clean, nil
}

func cleanHostPath(p string) (string, error) {
	if p == "" || forbiddenPathRunes.MatchString(p) {
		return "", ErrRejectedPath
	}
	slashed := strings.ReplaceAll(p, `\`, "/")
	for _, segment := range strings.Split(slashed, "/") {
		if segment == ".." {
			return "", ErrRejectedPath
		}
	}
	if drivePrefix.MatchString(slashed) {
		slashed = strings.ToUpper(slashed[:1]) + slashed[1:]
	} else if !strings.HasPrefix(slashed, "/") {
		return "", ErrRejectedPath
	}
	return strings.TrimSuffix(path.Clean(slashed), "/"), nil
}

// Spec is one container to create. Every field is validated before rendering.
type Spec struct {
	Identity          Identity
	Image             string
	WorkspaceSlug     string
	WorkspaceHostPath string
	MemoryBytes       int64
	PidsLimit         int
	// RuntimeEnv is the bootstrap allowlist the host grants the runtime only (ADR-0092 §5.2). The sandbox receives none.
	RuntimeEnv map[string]string
}

// WorkspaceTarget is the canonical in-container workspace for this project.
func (s Spec) WorkspaceTarget() string { return workspacePrefix + s.WorkspaceSlug }

// CreateArgs renders the docker create argv. There is no shell, no env file,
// no privileged flag and no Docker socket. A runtime gets a private state
// volume. A sandbox gets only its project workspace, on its environment network.
func (s Spec) CreateArgs() ([]string, error) {
	if err := s.Identity.Validate(); err != nil {
		return nil, err
	}
	if !workspaceSlug.MatchString(s.WorkspaceSlug) || s.WorkspaceHostPath == "" {
		return nil, errInvalidSpec
	}
	if s.MemoryBytes <= 0 || s.PidsLimit <= 0 {
		return nil, fmt.Errorf("%w: resource limits must be positive", errInvalidSpec)
	}
	args := []string{
		"create",
		"--name", s.Identity.ContainerName(),
		"--network", s.Identity.NetworkName(),
		"--restart", "no",
		// Never pull from inside create. docker create pulls a missing image by default. The host decides when to pull.
		"--pull", "never",
		"--cap-drop", "ALL",
		"--security-opt", "no-new-privileges:true",
		"--memory", fmt.Sprint(s.MemoryBytes),
		"--pids-limit", fmt.Sprint(s.PidsLimit),
	}
	labels := s.Identity.Labels()
	for _, key := range sortedKeys(labels) {
		args = append(args, "--label", key+"="+labels[key])
	}
	env := map[string]string{
		"RAPTIX_ROLE":                   string(s.Identity.Role),
		"RAPTIX_PROJECT_ID":             s.Identity.ProjectID,
		"RAPTIX_ENVIRONMENT_ID":         s.Identity.EnvironmentID,
		"RAPTIX_ENVIRONMENT_GENERATION": fmt.Sprint(s.Identity.Generation),
		"RAPTIX_WORKSPACE_SLUG":         s.WorkspaceSlug,
	}
	if s.Identity.Role == RoleRuntime {
		sandbox := s.Identity
		sandbox.Role = RoleSandbox
		env["SANDBOX_URL"] = "http://" + sandbox.ContainerName() + ":9999"
	}
	for _, key := range sortedKeys(env) {
		args = append(args, "--env", key+"="+env[key])
	}
	if s.Identity.Role == RoleRuntime {
		for _, key := range sortedKeys(s.RuntimeEnv) {
			args = append(args, "--env", key+"="+s.RuntimeEnv[key])
		}
	}
	args = append(args, "--mount", "type=bind,source="+s.WorkspaceHostPath+",target="+s.WorkspaceTarget())
	if s.Identity.Role == RoleRuntime {
		args = append(args, "--mount", "type=volume,source="+s.Identity.StateVolumeName()+",target="+RuntimeStatePath)
	}
	args = append(args, s.Image)
	// The runtime starts the way the compose stack starts it: no reload, so a stable process serves the API. The image
	// default enables file watching, which reloads the graph every time the runtime writes its own state.
	if s.Identity.Role == RoleRuntime {
		args = append(args, runtimeCommand...)
	}
	return args, nil
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// runtimeCommand is the runtime's launch command, the same as the web runtime in docker-compose.web-runtime.yml.
// Port 2024 is the port the runtime endpoint is derived with.
var runtimeCommand = []string{"langgraph", "dev", "--host", "0.0.0.0", "--port", "2024", "--no-browser", "--no-reload", "--n-jobs-per-worker", "10", "--allow-blocking"}

// RuntimeEnvAllowlist is every environment variable the host may grant a runtime. Anything else is refused at startup,
// so the host never forwards a whole .env file to a project container.
var RuntimeEnvAllowlist = []string{"RAPTIX_LLM__PROXY_URL", "RAPTIX_LLM__PROXY_API_KEY", "RAPTIX_LITELLM_MODELS", "RAPTIX_MODEL_PROFILE", "RAPTIX_AUTH_PRIORITY", "RAPTIX_LANGUAGE", "CUSTOM_OPENAI_API_BASE", "CUSTOM_OPENAI_API_KEY", "CUSTOM_OPENAI_MODEL", "RAPTIX_USE_SKILLOGY"}

// ValidateRuntimeEnv refuses a key outside the allowlist or a value that could split an argument.
func ValidateRuntimeEnv(env map[string]string) error {
	allowed := make(map[string]struct{}, len(RuntimeEnvAllowlist))
	for _, key := range RuntimeEnvAllowlist {
		allowed[key] = struct{}{}
	}
	for key, value := range env {
		if _, ok := allowed[key]; !ok {
			return fmt.Errorf("%w: %s is not an allowed runtime variable", errInvalidSpec, key)
		}
		if strings.ContainsAny(value, "\n\r\x00") {
			return fmt.Errorf("%w: %s has a control character", errInvalidSpec, key)
		}
	}
	return nil
}
