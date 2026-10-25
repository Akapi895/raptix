package sandboxes

import (
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
	bad := []string{"", "Upper", "-lead", "trail-", "under_score", "dot.name", strings.Repeat("a", 60), "a b", "../x"}
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

func TestVolumeNameBelongsToOneProject(t *testing.T) {
	got, err := VolumeName("lab-a")
	if err != nil || got != "raptix-ws-lab-a" {
		t.Fatalf("VolumeName = %q, %v; want raptix-ws-lab-a", got, err)
	}
}

func TestRenderComposeMountsOnlyTheProjectsOwnVolumeAtWorkspace(t *testing.T) {
	out, err := RenderCompose("lab-a", Settings{Image: "img:stable", Network: "raptix_web_sandbox-net"}, "tok-lab-a")
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	for _, want := range []string{
		"container_name: sbx-lab-a",
		"services:\n  sbx-lab-a:\n",
		"source: workspace\n        target: /workspace\n",
		"name: raptix-ws-lab-a",
		"name: raptix_web_sandbox-net",
		"SANDBOX_TOKEN: 'tok-lab-a'",
		"cap_drop: [ALL]",
		"no-new-privileges:true",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("compose is missing %q:\n%s", want, s)
		}
	}
	for _, banned := range []string{"subpath", "/workspace/lab-a", "RAPTIX_ENGAGEMENT", "NEO4J", "env_file", "raptix-web-raptix_web_runtime_workspace"} {
		if strings.Contains(s, banned) {
			t.Errorf("compose still carries %q, which ADR-0102 removes:\n%s", banned, s)
		}
	}
}

func TestRenderComposePassesNoDeploymentEnvironment(t *testing.T) {
	out, err := RenderCompose("lab-a", Settings{Image: "img", Network: "net"}, "tok")
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	for _, secret := range []string{"env_file", "LITELLM_MASTER_KEY", "ANTHROPIC_API_KEY", "VAULT_ENCRYPTION_KEY", "RAPTIX_WEB_ADMIN_PASSWORD", "NEO4J_PASSWORD"} {
		if strings.Contains(s, secret) {
			t.Errorf("sandbox compose passes or names %s", secret)
		}
	}
}

func TestRenderComposeRejectsIncompleteSettings(t *testing.T) {
	if _, err := RenderCompose("lab-a", Settings{Image: "img"}, "tok"); err == nil {
		t.Fatal("RenderCompose with missing settings = nil, want an error")
	}
}

func TestRenderComposeRefusesAProjectWithoutItsOwnToken(t *testing.T) {
	full := Settings{Image: "img", Network: "net"}
	if _, err := RenderCompose("lab-a", full, ""); err == nil {
		t.Fatal("RenderCompose with an empty token = nil, want an error: a sandbox must never start unauthenticated")
	}
}
