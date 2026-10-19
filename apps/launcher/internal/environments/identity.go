// Package environments is the trusted host controller for per-project runtime
// and sandbox containers (ADR-0092). It runs only allowlisted operations on
// resources that carry this deployment's labels, and it never accepts a
// container name, Compose file, mount or image from a caller.
package environments

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
)

// Role is the container role inside one environment.
type Role string

const (
	RoleRuntime Role = "runtime"
	RoleSandbox Role = "sandbox"
)

// Label keys stamped on every resource the controller creates. Observe,
// start, stop and remove act only on resources whose labels match exactly.
const (
	LabelManaged     = "raptix.managed"
	LabelDeployment  = "raptix.deployment"
	LabelProject     = "raptix.project"
	LabelEnvironment = "raptix.environment"
	LabelRole        = "raptix.role"
	LabelGeneration  = "raptix.generation"
)

var (
	deploymentPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
	identifierPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	ErrInvalidIdentity = errors.New("invalid environment identity")
)

// Identity names one container of one environment in one deployment.
type Identity struct {
	DeploymentID  string `json:"deploymentId"`
	ProjectID     string `json:"projectId"`
	EnvironmentID string `json:"environmentId"`
	Role          Role   `json:"role"`
	Generation    int64  `json:"generation"`
}

// Validate rejects anything that could widen a Docker name, label or filter.
func (id Identity) Validate() error {
	if !deploymentPattern.MatchString(id.DeploymentID) {
		return fmt.Errorf("%w: deployment id", ErrInvalidIdentity)
	}
	if !identifierPattern.MatchString(id.ProjectID) {
		return fmt.Errorf("%w: project id", ErrInvalidIdentity)
	}
	if !identifierPattern.MatchString(id.EnvironmentID) {
		return fmt.Errorf("%w: environment id", ErrInvalidIdentity)
	}
	if id.Role != RoleRuntime && id.Role != RoleSandbox {
		return fmt.Errorf("%w: role", ErrInvalidIdentity)
	}
	if id.Generation < 1 {
		return fmt.Errorf("%w: generation", ErrInvalidIdentity)
	}
	return nil
}

// stem is stable across generations and roles, so one environment always maps
// to the same network and state volume names.
func (id Identity) stem() string {
	sum := sha256.Sum256([]byte(id.DeploymentID + "\x00" + id.EnvironmentID))
	return "raptix-env-" + hex.EncodeToString(sum[:])[:12]
}

func (id Identity) ContainerName() string   { return id.stem() + "-" + string(id.Role) }
func (id Identity) NetworkName() string     { return id.stem() + "-net" }
func (id Identity) StateVolumeName() string { return id.stem() + "-state" }

// Labels returns the exact label set an owned resource must carry.
func (id Identity) Labels() map[string]string {
	return map[string]string{
		LabelManaged:     "true",
		LabelDeployment:  id.DeploymentID,
		LabelProject:     id.ProjectID,
		LabelEnvironment: id.EnvironmentID,
		LabelRole:        string(id.Role),
		LabelGeneration:  fmt.Sprint(id.Generation),
	}
}

// Owns reports whether labels belong to this deployment, project, environment
// and role. The generation is compared separately so a recreate can replace
// an older incarnation of the same container.
func (id Identity) Owns(labels map[string]string) bool {
	return labels[LabelManaged] == "true" &&
		labels[LabelDeployment] == id.DeploymentID &&
		labels[LabelProject] == id.ProjectID &&
		labels[LabelEnvironment] == id.EnvironmentID &&
		labels[LabelRole] == string(id.Role)
}
