package sandboxes

import (
	"reflect"
	"strings"
	"testing"
)

func TestValidSlugAcceptsOnlySandboxHostSafeNames(t *testing.T) {
	ok := []string{"a", "popup-lab-80vj", strings.Repeat("a", 59)}
	for _, s := range ok {
		if err := ValidSlug(s); err != nil {
			t.Errorf("ValidSlug(%q) = %v, want nil", s, err)
		}
	}
	bad := []string{"", "Upper", "-lead", "trail-", "under_score", "dot.name", strings.Repeat("a", 60), "a b"}
	for _, s := range bad {
		if err := ValidSlug(s); err == nil {
			t.Errorf("ValidSlug(%q) = nil, want an error", s)
		}
	}
}

func TestContainerNameMatchesTheServerRoute(t *testing.T) {
	got, err := ContainerName("popup-lab-80vj")
	if err != nil || got != "sbx-popup-lab-80vj" {
		t.Fatalf("ContainerName = %q, %v; want sbx-popup-lab-80vj", got, err)
	}
}

func TestRenderComposeMountsOnlyTheProjectSubpathAndIsolatesIt(t *testing.T) {
	out, err := RenderCompose("lab-a", Settings{Image: "img:stable", Network: "raptix_sandbox-net", Volume: "raptix-web-raptix_web_runtime_workspace", EnvFile: `C:\raptix\.env`})
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	for _, want := range []string{
		"container_name: sbx-lab-a",
		"target: /workspace/lab-a",
		"subpath: lab-a",
		"RAPTIX_ENGAGEMENT: 'lab-a'",
		"RAPTIX_WORKSPACE_ISOLATED: '1'",
		"cap_drop: [ALL]",
		"no-new-privileges:true",
		"name: raptix-web-raptix_web_runtime_workspace",
		"name: raptix_sandbox-net",
		"env_file: 'C:/raptix/.env'",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("compose is missing %q:\n%s", want, s)
		}
	}
	if strings.Contains(s, "source: workspace\n        target: /workspace\n") {
		t.Errorf("compose mounts the whole volume at /workspace:\n%s", s)
	}
}

func TestRenderComposeRejectsIncompleteSettings(t *testing.T) {
	if _, err := RenderCompose("lab-a", Settings{Image: "img"}); err == nil {
		t.Fatal("RenderCompose with missing settings = nil, want an error")
	}
}

func TestPlanEnsuresEveryProjectAndFlagsOrphanedContainers(t *testing.T) {
	ensure, orphaned := Plan(
		[]string{"web-m1-20261016", "lab-a", "BAD NAME"},
		[]string{"sbx-lab-a", "sbx-gone", "raptix-web-raptix-api"},
	)
	if !reflect.DeepEqual(ensure, []string{"lab-a", "web-m1-20261016"}) {
		t.Errorf("ensure = %v", ensure)
	}
	if !reflect.DeepEqual(orphaned, []string{"sbx-gone"}) {
		t.Errorf("orphaned = %v", orphaned)
	}
}
