package environments

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
)

// fakeDocker models the docker verbs the controller uses. It records every call so a
// test can prove that a refused operation sent nothing that mutates Docker.
type fakeDocker struct {
	images     map[string]bool
	containers map[string]*fakeContainer
	networks   map[string]map[string]string
	volumes    map[string]map[string]string
	stuck      map[string]bool
	calls      [][]string
}

type fakeContainer struct {
	labels   map[string]string
	running  bool
	networks map[string]bool
}

func newFakeDocker() *fakeDocker {
	return &fakeDocker{
		images:     map[string]bool{testDigest: true},
		containers: map[string]*fakeContainer{},
		networks:   map[string]map[string]string{"raptix-net": {}},
		volumes:    map[string]map[string]string{},
		stuck:      map[string]bool{},
	}
}

func (f *fakeDocker) Run(_ context.Context, args ...string) (string, string, error) {
	f.calls = append(f.calls, slices.Clone(args))
	switch {
	case slices.Equal(args[:min(3, len(args))], []string{"inspect", "--type", "container"}):
		name := args[len(args)-1]
		c, ok := f.containers[name]
		if !ok {
			return "", "Error: No such container: " + name, errors.New("exit 1")
		}
		nets := map[string]json.RawMessage{}
		for n := range c.networks {
			nets[n] = json.RawMessage(`{}`)
		}
		out, _ := json.Marshal([]map[string]any{{"Config": map[string]any{"Labels": c.labels}, "State": map[string]any{"Running": c.running}, "NetworkSettings": map[string]any{"Networks": nets}}})
		return string(out), "", nil
	case args[0] == "network" && len(args) == 5 && args[1] == "inspect" && args[2] == "--format":
		return f.labelsOr(f.networks, args[4], "network")
	case args[0] == "volume" && len(args) == 5 && args[1] == "inspect" && args[2] == "--format":
		return f.labelsOr(f.volumes, args[4], "volume")
	case args[0] == "network" && len(args) == 3 && args[1] == "inspect":
		if _, ok := f.networks[args[2]]; ok {
			return "[{}]", "", nil
		}
		return "", "Error: No such network: " + args[2], errors.New("exit 1")
	case args[0] == "network" && args[1] == "create":
		f.networks[args[len(args)-1]] = parseLabels(args)
		return "", "", nil
	case args[0] == "volume" && args[1] == "create":
		f.volumes[args[len(args)-1]] = parseLabels(args)
		return "", "", nil
	case args[0] == "create":
		image := args[len(args)-1]
		if !f.images[image] {
			return "", "Unable to find image '" + image + "' locally", errors.New("exit 125")
		}
		name := argValue(args, "--name")
		if _, exists := f.containers[name]; exists {
			return "", "Conflict. The container name is already in use", errors.New("exit 125")
		}
		f.containers[name] = &fakeContainer{labels: parseLabels(args), networks: map[string]bool{argValue(args, "--network"): true}}
		return name, "", nil
	case args[0] == "network" && args[1] == "connect":
		f.containers[args[3]].networks[args[2]] = true
		return "", "", nil
	case args[0] == "start":
		f.containers[args[1]].running = true
		return "", "", nil
	case args[0] == "stop":
		name := args[len(args)-1]
		if !f.stuck[name] {
			f.containers[name].running = false
		}
		return "", "", nil
	case args[0] == "rm":
		name := args[len(args)-1]
		if f.containers[name].running {
			return "", "cannot remove a running container", errors.New("exit 1")
		}
		delete(f.containers, name)
		return "", "", nil
	case args[0] == "pull":
		return "", "pull is not allowed from the controller", errors.New("exit 1")
	}
	return "", "unexpected call " + strings.Join(args, " "), errors.New("exit 1")
}

func (f *fakeDocker) labelsOr(store map[string]map[string]string, name, kind string) (string, string, error) {
	labels, ok := store[name]
	if !ok {
		return "", "Error: No such " + kind + ": " + name, errors.New("exit 1")
	}
	out, _ := json.Marshal(labels)
	return string(out), "", nil
}

// mutating reports whether any recorded call changed Docker state.
func (f *fakeDocker) mutating() []string {
	var out []string
	for _, call := range f.calls {
		if call[0] == "inspect" || (len(call) > 1 && call[1] == "inspect") {
			continue
		}
		out = append(out, strings.Join(call, " "))
	}
	return out
}

func parseLabels(args []string) map[string]string {
	labels := map[string]string{}
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "--label" {
			key, value, _ := strings.Cut(args[i+1], "=")
			labels[key] = value
		}
	}
	return labels
}

func argValue(args []string, flag string) string {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == flag {
			return args[i+1]
		}
	}
	return ""
}

func newTestController(t *testing.T, docker *fakeDocker, resolve func(string) (string, error)) *Controller {
	t.Helper()
	ctrl, err := New(docker, Config{
		WorkspaceRoot:     `D:\work`,
		ManagementNetwork: "raptix-net",
		Images:            []string{testDigest},
		MemoryBytes:       2 << 30,
		PidsLimit:         512,
		Resolve:           resolve,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return ctrl
}

func identityFor(env string, role Role, gen int64) Identity {
	return Identity{DeploymentID: "deploy-1", ProjectID: "proj-" + env, EnvironmentID: env, Role: role, Generation: gen}
}

func requestFor(env string, role Role, gen int64) Request {
	return Request{Identity: identityFor(env, role, gen), Image: testDigest, WorkspaceSlug: "proj-" + env, WorkspaceHostPath: `D:\work\proj-` + env, StopTimeoutSecs: 10}
}

func echoPath(p string) (string, error) { return p, nil }

func TestEnsureCreatesOwnedResourcesAndNeverPulls(t *testing.T) {
	docker := newFakeDocker()
	ctrl := newTestController(t, docker, echoPath)
	obs, err := ctrl.Ensure(context.Background(), requestFor("alpha", RoleRuntime, 1))
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if !obs.Exists || obs.Running || obs.Generation != 1 {
		t.Fatalf("Ensure observation = %+v", obs)
	}
	id := identityFor("alpha", RoleRuntime, 1)
	if got := docker.containers[id.ContainerName()].labels; !id.Owns(got) {
		t.Fatalf("container labels = %v, not owned by the environment", got)
	}
	if !docker.containers[id.ContainerName()].networks["raptix-net"] {
		t.Fatal("runtime must join the management network")
	}
	if _, ok := docker.volumes[id.StateVolumeName()]; !ok {
		t.Fatal("runtime must get its own state volume")
	}
	for _, call := range docker.calls {
		if slices.Contains(call, "pull") {
			t.Fatalf("controller pulled an image: %v", call)
		}
	}
}

func TestEnsureIsIdempotentForTheSameGeneration(t *testing.T) {
	docker := newFakeDocker()
	ctrl := newTestController(t, docker, echoPath)
	req := requestFor("alpha", RoleSandbox, 1)
	if _, err := ctrl.Ensure(context.Background(), req); err != nil {
		t.Fatalf("first Ensure: %v", err)
	}
	docker.calls = nil
	if _, err := ctrl.Ensure(context.Background(), req); err != nil {
		t.Fatalf("second Ensure: %v", err)
	}
	if got := docker.mutating(); len(got) != 0 {
		t.Fatalf("repeat Ensure changed Docker: %v", got)
	}
}

func TestEnsureRefusesToAdoptForeignOrOtherGenerationResources(t *testing.T) {
	ctx := context.Background()
	id := identityFor("alpha", RoleSandbox, 1)

	t.Run("container with other labels under the same name", func(t *testing.T) {
		docker := newFakeDocker()
		docker.containers[id.ContainerName()] = &fakeContainer{labels: map[string]string{LabelManaged: "true", LabelDeployment: "other"}}
		ctrl := newTestController(t, docker, echoPath)
		if _, err := ctrl.Ensure(ctx, requestFor("alpha", RoleSandbox, 1)); !errors.Is(err, ErrForeignResource) {
			t.Fatalf("Ensure = %v, want ErrForeignResource", err)
		}
		if got := docker.mutating(); len(got) != 0 {
			t.Fatalf("foreign container was changed: %v", got)
		}
	})

	t.Run("generation mismatch", func(t *testing.T) {
		docker := newFakeDocker()
		ctrl := newTestController(t, docker, echoPath)
		if _, err := ctrl.Ensure(ctx, requestFor("alpha", RoleSandbox, 1)); err != nil {
			t.Fatalf("seed Ensure: %v", err)
		}
		if _, err := ctrl.Ensure(ctx, requestFor("alpha", RoleSandbox, 2)); !errors.Is(err, ErrGenerationMismatch) {
			t.Fatalf("Ensure gen 2 = %v, want ErrGenerationMismatch", err)
		}
	})

	t.Run("network with the same name but no labels", func(t *testing.T) {
		docker := newFakeDocker()
		docker.networks[id.NetworkName()] = map[string]string{}
		ctrl := newTestController(t, docker, echoPath)
		if _, err := ctrl.Ensure(ctx, requestFor("alpha", RoleSandbox, 1)); !errors.Is(err, ErrForeignResource) {
			t.Fatalf("Ensure = %v, want ErrForeignResource", err)
		}
		for _, call := range docker.mutating() {
			if strings.HasPrefix(call, "create ") {
				t.Fatalf("container was created on a foreign network: %s", call)
			}
		}
	})
}

func TestEnsureReportsMissingImageAndRefusesUnlistedImagesBeforeDocker(t *testing.T) {
	ctx := context.Background()

	t.Run("image not present locally", func(t *testing.T) {
		docker := newFakeDocker()
		docker.images = map[string]bool{}
		ctrl := newTestController(t, docker, echoPath)
		if _, err := ctrl.Ensure(ctx, requestFor("alpha", RoleSandbox, 1)); !errors.Is(err, ErrImageMissing) {
			t.Fatalf("Ensure = %v, want ErrImageMissing", err)
		}
		if got := docker.mutating(); len(got) == 0 || slices.Contains(docker.calls[len(docker.calls)-1], "pull") {
			t.Fatalf("missing image must fail without pulling: %v", got)
		}
	})

	t.Run("tag instead of digest", func(t *testing.T) {
		docker := newFakeDocker()
		ctrl := newTestController(t, docker, echoPath)
		req := requestFor("alpha", RoleSandbox, 1)
		req.Image = "ghcr.io/akapi895/raptix-langgraph:stable"
		if _, err := ctrl.Ensure(ctx, req); !errors.Is(err, ErrRejectedImage) {
			t.Fatalf("Ensure = %v, want ErrRejectedImage", err)
		}
		if len(docker.calls) != 0 {
			t.Fatalf("a refused image reached docker: %v", docker.calls)
		}
	})
}

func TestEnsureRefusesPathsThatEscapeTheRootThroughSymlinks(t *testing.T) {
	docker := newFakeDocker()
	ctrl := newTestController(t, docker, func(string) (string, error) { return `D:\elsewhere\proj-alpha`, nil })
	if _, err := ctrl.Ensure(context.Background(), requestFor("alpha", RoleSandbox, 1)); !errors.Is(err, ErrRejectedPath) {
		t.Fatalf("Ensure = %v, want ErrRejectedPath", err)
	}
	if len(docker.calls) != 0 {
		t.Fatalf("a symlink escape reached docker: %v", docker.calls)
	}
}

func TestLifecycleReportsStillRunningAndNeverTouchesForeignContainers(t *testing.T) {
	ctx := context.Background()
	docker := newFakeDocker()
	ctrl := newTestController(t, docker, echoPath)
	alpha := identityFor("alpha", RoleRuntime, 1)
	if _, err := ctrl.Ensure(ctx, requestFor("alpha", RoleRuntime, 1)); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if obs, err := ctrl.Start(ctx, alpha); err != nil || !obs.Running {
		t.Fatalf("Start = %+v, %v", obs, err)
	}
	docker.stuck[alpha.ContainerName()] = true
	if obs, err := ctrl.Stop(ctx, alpha, 5); !errors.Is(err, ErrStillRunning) || !obs.Running {
		t.Fatalf("Stop with stuck container = %+v, %v; want running and ErrStillRunning", obs, err)
	}
	delete(docker.stuck, alpha.ContainerName())
	if _, err := ctrl.Stop(ctx, alpha, 5); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if err := ctrl.Remove(ctx, alpha); err != nil {
		t.Fatalf("Remove stopped: %v", err)
	}
	if _, ok := docker.containers[alpha.ContainerName()]; ok {
		t.Fatal("owned container should be gone after remove")
	}

	docker = newFakeDocker()
	ctrl = newTestController(t, docker, echoPath)
	docker.containers[alpha.ContainerName()] = &fakeContainer{labels: map[string]string{LabelManaged: "true", LabelDeployment: "other"}, running: true}
	docker.calls = nil
	for _, op := range []func() error{
		func() error { _, err := ctrl.Start(ctx, alpha); return err },
		func() error { _, err := ctrl.Stop(ctx, alpha, 5); return err },
		func() error { return ctrl.Remove(ctx, alpha) },
	} {
		if err := op(); !errors.Is(err, ErrForeignResource) {
			t.Fatalf("operation on foreign container = %v, want ErrForeignResource", err)
		}
	}
	if got := docker.mutating(); len(got) != 0 {
		t.Fatalf("foreign container was mutated: %v", got)
	}
}

func TestRemoveRefusesRunningContainerAndNeighborsSurvive(t *testing.T) {
	ctx := context.Background()
	docker := newFakeDocker()
	ctrl := newTestController(t, docker, echoPath)
	if _, err := ctrl.Ensure(ctx, requestFor("alpha", RoleSandbox, 1)); err != nil {
		t.Fatalf("Ensure alpha: %v", err)
	}
	if _, err := ctrl.Ensure(ctx, requestFor("beta", RoleSandbox, 1)); err != nil {
		t.Fatalf("Ensure beta: %v", err)
	}
	alpha := identityFor("alpha", RoleSandbox, 1)
	if _, err := ctrl.Start(ctx, alpha); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := ctrl.Remove(ctx, alpha); !errors.Is(err, ErrRunning) {
		t.Fatalf("Remove running = %v, want ErrRunning", err)
	}
	if _, err := ctrl.Stop(ctx, alpha, 5); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if err := ctrl.Remove(ctx, alpha); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, ok := docker.containers[identityFor("beta", RoleSandbox, 1).ContainerName()]; !ok {
		t.Fatal("removing alpha must not touch beta")
	}
}

func TestRecreateNeedsAStoppedContainerAndAHigherGeneration(t *testing.T) {
	ctx := context.Background()
	docker := newFakeDocker()
	ctrl := newTestController(t, docker, echoPath)
	if _, err := ctrl.Ensure(ctx, requestFor("alpha", RoleSandbox, 1)); err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if _, err := ctrl.Start(ctx, identityFor("alpha", RoleSandbox, 1)); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if _, err := ctrl.Recreate(ctx, requestFor("alpha", RoleSandbox, 2)); !errors.Is(err, ErrRunning) {
		t.Fatalf("Recreate running = %v, want ErrRunning", err)
	}
	if _, err := ctrl.Stop(ctx, identityFor("alpha", RoleSandbox, 1), 5); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if _, err := ctrl.Recreate(ctx, requestFor("alpha", RoleSandbox, 1)); !errors.Is(err, ErrGenerationMismatch) {
		t.Fatalf("Recreate same generation = %v, want ErrGenerationMismatch", err)
	}
	obs, err := ctrl.Recreate(ctx, requestFor("alpha", RoleSandbox, 2))
	if err != nil || obs.Generation != 2 {
		t.Fatalf("Recreate gen 2 = %+v, %v", obs, err)
	}
}

func TestNewRejectsUnsafeConfiguration(t *testing.T) {
	bad := []Config{
		{WorkspaceRoot: `D:\work`, ManagementNetwork: "raptix,net", Images: []string{testDigest}, MemoryBytes: 1, PidsLimit: 1},
		{WorkspaceRoot: `D:\work`, ManagementNetwork: "raptix-net", Images: []string{"ghcr.io/x:tag"}, MemoryBytes: 1, PidsLimit: 1},
		{WorkspaceRoot: "work", ManagementNetwork: "raptix-net", Images: []string{testDigest}, MemoryBytes: 1, PidsLimit: 1},
	}
	for i, cfg := range bad {
		if _, err := New(newFakeDocker(), cfg); err == nil {
			t.Fatalf("config %d accepted: %+v", i, cfg)
		}
	}
}
