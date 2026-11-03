package environments

import (
	"context"
	"fmt"
	"strings"
)

// Orphan is a container the controller created for a deployment whose environment the control plane no longer
// knows. It is reported, never removed: deleting it is a decision the operator makes with the evidence in hand.
type Orphan struct {
	Name          string `json:"name"`
	EnvironmentID string `json:"environmentId"`
	Role          string `json:"role"`
	State         string `json:"state"`
}

// FindOrphans lists the containers labelled as owned by one deployment and returns those whose environment is not in
// known. It is read-only: one docker ps, no change to any container or volume. Volumes are not listed because the
// controller does not label them; their names carry the environment stem, which the operator checks against the
// report.
func FindOrphans(ctx context.Context, runner Runner, deploymentID string, known map[string]bool) ([]Orphan, error) {
	if deploymentID == "" {
		return nil, fmt.Errorf("%w: deployment id is required", errInvalidSpec)
	}
	stdout, _, err := runner.Run(ctx, "ps", "-a", "--no-trunc",
		"--filter", "label="+LabelManaged+"=true",
		"--filter", "label="+LabelDeployment+"="+deploymentID,
		"--format", "{{.Names}}\t{{.State}}\t{{.Label \""+LabelEnvironment+"\"}}\t{{.Label \""+LabelRole+"\"}}")
	if err != nil {
		return nil, ErrUnavailable
	}
	orphans := []Orphan{}
	for _, line := range strings.Split(stdout, "\n") {
		fields := strings.Split(strings.TrimRight(line, "\r"), "\t")
		if len(fields) != 4 || fields[0] == "" {
			continue
		}
		if known[fields[2]] {
			continue
		}
		orphans = append(orphans, Orphan{Name: fields[0], State: fields[1], EnvironmentID: fields[2], Role: fields[3]})
	}
	return orphans, nil
}
