package environments

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type psRunner struct {
	stdout string
	err    error
	args   []string
}

func (p *psRunner) Run(_ context.Context, args ...string) (string, string, error) {
	p.args = args
	return p.stdout, "", p.err
}

func TestFindOrphansReportsOnlyContainersOfUnknownEnvironments(t *testing.T) {
	runner := &psRunner{stdout: "raptix-env-a-runtime\trunning\tenv-known\truntime\n" +
		"raptix-env-b-runtime\texited\tenv-gone\truntime\n" +
		"raptix-env-b-sandbox\texited\tenv-gone\tsandbox\n" +
		"\n"}
	orphans, err := FindOrphans(context.Background(), runner, "dep-1", map[string]bool{"env-known": true})
	if err != nil {
		t.Fatalf("FindOrphans: %v", err)
	}
	if len(orphans) != 2 || orphans[0].Name != "raptix-env-b-runtime" || orphans[1].Role != "sandbox" {
		t.Fatalf("orphans = %+v, want the two containers of env-gone", orphans)
	}
	joined := ""
	for _, arg := range runner.args {
		joined += arg + " "
	}
	if !containsAll(joined, "label=raptix.deployment=dep-1", "label=raptix.managed=true", "ps -a") {
		t.Fatalf("docker ps did not filter by deployment and managed label: %s", joined)
	}
}

func TestFindOrphansRefusesAnEmptyDeploymentAndReportsDockerFailure(t *testing.T) {
	if _, err := FindOrphans(context.Background(), &psRunner{}, "", nil); !errors.Is(err, errInvalidSpec) {
		t.Fatalf("empty deployment: err = %v, want invalid spec", err)
	}
	if _, err := FindOrphans(context.Background(), &psRunner{err: errors.New("daemon down")}, "dep-1", nil); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("docker failure: err = %v, want unavailable", err)
	}
}

func containsAll(haystack string, needles ...string) bool {
	for _, needle := range needles {
		if !strings.Contains(haystack, needle) {
			return false
		}
	}
	return true
}
