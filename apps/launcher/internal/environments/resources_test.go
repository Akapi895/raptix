package environments

import (
	"errors"
	"slices"
	"strings"
	"testing"
)

const testDigest = "ghcr.io/akapi895/raptix-langgraph@sha256:" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func validIdentity(role Role) Identity {
	return Identity{DeploymentID: "deploy-1", ProjectID: "proj-alpha", EnvironmentID: "env-alpha", Role: role, Generation: 1}
}

func TestIdentityRejectsValuesThatCouldWidenNamesOrLabels(t *testing.T) {
	cases := map[string]func(*Identity){
		"uppercase project id":      func(id *Identity) { id.ProjectID = "Proj" },
		"dot in environment id":     func(id *Identity) { id.EnvironmentID = "env.alpha" },
		"empty deployment id":       func(id *Identity) { id.DeploymentID = "" },
		"comma in deployment id":    func(id *Identity) { id.DeploymentID = "a,b" },
		"unknown role":              func(id *Identity) { id.Role = "sandbox-admin" },
		"zero generation":           func(id *Identity) { id.Generation = 0 },
		"overlong environment id":   func(id *Identity) { id.EnvironmentID = strings.Repeat("a", 70) },
		"leading hyphen project id": func(id *Identity) { id.ProjectID = "-proj" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			id := validIdentity(RoleRuntime)
			mutate(&id)
			if err := id.Validate(); !errors.Is(err, ErrInvalidIdentity) {
				t.Fatalf("Validate() = %v, want ErrInvalidIdentity", err)
			}
		})
	}
	if err := validIdentity(RoleSandbox).Validate(); err != nil {
		t.Fatalf("valid sandbox identity refused: %v", err)
	}
}

func TestResourceNamesAreStableAcrossGenerationsAndRoles(t *testing.T) {
	first := validIdentity(RoleRuntime)
	second := first
	second.Generation = 7
	if first.NetworkName() != second.NetworkName() || first.StateVolumeName() != second.StateVolumeName() {
		t.Fatal("network and state volume names must not change with the generation")
	}
	if first.ContainerName() == validIdentity(RoleSandbox).ContainerName() {
		t.Fatal("runtime and sandbox must have different container names")
	}
	other := first
	other.EnvironmentID = "env-beta"
	if first.NetworkName() == other.NetworkName() {
		t.Fatal("different environments must not share a network name")
	}
}

func TestImagePolicyAcceptsOnlyAllowlistedDigestReferences(t *testing.T) {
	if _, err := NewImagePolicy([]string{"ghcr.io/akapi895/raptix-langgraph:stable"}); err == nil {
		t.Fatal("a tag must not be accepted as a configured image")
	}
	policy, err := NewImagePolicy([]string{testDigest})
	if err != nil {
		t.Fatalf("NewImagePolicy: %v", err)
	}
	if err := policy.Check(testDigest); err != nil {
		t.Fatalf("allowlisted digest refused: %v", err)
	}
	if err := policy.Check("ghcr.io/akapi895/other@sha256:" + strings.Repeat("a", 64)); !errors.Is(err, ErrRejectedImage) {
		t.Fatalf("unlisted digest accepted: %v", err)
	}
}

func TestNormalizeHostPathContainsEveryPathInsideRoot(t *testing.T) {
	cases := []struct {
		name, root, input, want string
		wantErr                 bool
	}{
		{name: "windows backslashes", root: `D:\work`, input: `D:\work\ws\proj`, want: "D:/work/ws/proj"},
		{name: "windows drive letter is uppercased", root: `d:/work`, input: `d:/work/proj`, want: "D:/work/proj"},
		{name: "wsl path", root: "/mnt/d/work", input: "/mnt/d/work/proj", want: "/mnt/d/work/proj"},
		{name: "dotdot after a valid prefix", root: `D:\work`, input: `D:\work\..\secret`, wantErr: true},
		{name: "sibling with shared prefix", root: `D:\work`, input: `D:\work2\proj`, wantErr: true},
		{name: "outside root", root: `D:\work`, input: `D:\other\proj`, wantErr: true},
		{name: "comma adds a mount option", root: `D:\work`, input: `D:\work\a,readonly`, wantErr: true},
		{name: "equals sign", root: `D:\work`, input: `D:\work\a=b`, wantErr: true},
		{name: "control character", root: `D:\work`, input: "D:\\work\\a\nb", wantErr: true},
		{name: "relative path", root: `D:\work`, input: `work\proj`, wantErr: true},
		{name: "empty", root: `D:\work`, input: ``, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NormalizeHostPath(tc.root, tc.input)
			if tc.wantErr {
				if !errors.Is(err, ErrRejectedPath) {
					t.Fatalf("NormalizeHostPath(%q, %q) = %q, %v; want ErrRejectedPath", tc.root, tc.input, got, err)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("NormalizeHostPath(%q, %q) = %q, %v; want %q", tc.root, tc.input, got, err, tc.want)
			}
		})
	}
}

func TestCreateArgsMountOnlyOwnWorkspaceAndHardenEveryContainer(t *testing.T) {
	spec := func(role Role) Spec {
		return Spec{Identity: validIdentity(role), Image: testDigest, WorkspaceSlug: "proj-alpha", WorkspaceHostPath: "D:/work/proj-alpha", MemoryBytes: 2 << 30, PidsLimit: 512}
	}
	runtime, err := spec(RoleRuntime).CreateArgs()
	if err != nil {
		t.Fatalf("runtime CreateArgs: %v", err)
	}
	sandbox, err := spec(RoleSandbox).CreateArgs()
	if err != nil {
		t.Fatalf("sandbox CreateArgs: %v", err)
	}
	for name, args := range map[string][]string{"runtime": runtime, "sandbox": sandbox} {
		joined := strings.Join(args, " ")
		for _, forbidden := range []string{"--privileged", "docker.sock", "--env-file", "--volume ", "--publish", "-p "} {
			if strings.Contains(joined, forbidden) {
				t.Fatalf("%s args contain forbidden %q: %s", name, forbidden, joined)
			}
		}
		for _, required := range []string{"--cap-drop", "ALL", "no-new-privileges:true", "--restart", "no", "--memory", "--pids-limit"} {
			if !slices.Contains(args, required) {
				t.Fatalf("%s args miss %q", name, required)
			}
		}
		if !slices.Contains(args, "type=bind,source=D:/work/proj-alpha,target=/workspace/proj-alpha") {
			t.Fatalf("%s args do not bind the project workspace at its canonical target: %s", name, joined)
		}
		if args[len(args)-1] != testDigest {
			t.Fatalf("%s args must end with the digest-pinned image", name)
		}
	}
	if !slices.Contains(runtime, "type=volume,source="+validIdentity(RoleRuntime).StateVolumeName()+",target="+RuntimeStatePath) {
		t.Fatalf("runtime must mount its own state volume at %s", RuntimeStatePath)
	}
	if strings.Contains(strings.Join(sandbox, " "), RuntimeStatePath) {
		t.Fatal("sandbox must not mount the runtime state")
	}
}

func TestCreateArgsRefusesUnboundedLimits(t *testing.T) {
	spec := Spec{Identity: validIdentity(RoleRuntime), Image: testDigest, WorkspaceSlug: "proj-alpha", WorkspaceHostPath: "D:/work/proj-alpha", MemoryBytes: 0, PidsLimit: 512}
	if _, err := spec.CreateArgs(); err == nil {
		t.Fatal("zero memory limit must be refused")
	}
}
