package sandboxes

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type fakeRunner struct {
	outputs map[string]string
	calls   []string
	failRun string
}

func (f *fakeRunner) Output(name string, args ...string) (string, error) {
	key := strings.Join(append([]string{name}, args...), " ")
	f.calls = append(f.calls, "out "+key)
	for k, v := range f.outputs {
		if strings.Contains(key, k) {
			return v, nil
		}
	}
	return "", nil
}

func (f *fakeRunner) Run(name string, args ...string) error {
	key := strings.Join(append([]string{name}, args...), " ")
	f.calls = append(f.calls, "run "+key)
	if f.failRun != "" && strings.Contains(key, f.failRun) {
		return os.ErrPermission
	}
	return nil
}

func TestSyncStartsOneSandboxPerProjectAndRemovesOrphans(t *testing.T) {
	home := t.TempDir()
	fr := &fakeRunner{outputs: map[string]string{
		"/w/*/": "lab-a\nweb-m1-20261016\n",
		"name=^sbx-": "sbx-gone\n",
	}}
	cfg := Config{Bin: "docker", Home: home, Runner: fr, Settings: Settings{Image: "img", Network: "net", Volume: "vol", EnvFile: "/env"}}
	started, err := Sync(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(started, []string{"lab-a", "web-m1-20261016"}) {
		t.Fatalf("started = %v", started)
	}
	for _, slug := range started {
		if _, err := os.Stat(filepath.Join(home, "web-sandboxes", slug+".compose.yml")); err != nil {
			t.Errorf("compose file for %s not written: %v", slug, err)
		}
	}
	want := "run docker compose -p raptix-sbx-lab-a -f " + filepath.Join(home, "web-sandboxes", "lab-a.compose.yml") + " --env-file /env up -d"
	if !contains(fr.calls, want) {
		t.Errorf("missing %q in calls:\n%s", want, strings.Join(fr.calls, "\n"))
	}
	if !contains(fr.calls, "run docker rm -f sbx-gone") {
		t.Errorf("orphaned sandbox was not removed:\n%s", strings.Join(fr.calls, "\n"))
	}
}

func TestSyncStopsAtTheFirstFailedStart(t *testing.T) {
	home := t.TempDir()
	fr := &fakeRunner{outputs: map[string]string{"/w/*/": "lab-a\nlab-b\n"}, failRun: "raptix-sbx-lab-a"}
	cfg := Config{Bin: "docker", Home: home, Runner: fr, Settings: Settings{Image: "img", Network: "net", Volume: "vol", EnvFile: "/env"}}
	if _, err := Sync(cfg); err == nil {
		t.Fatal("Sync = nil, want the start failure")
	}
	if contains(fr.calls, "raptix-sbx-lab-b") {
		t.Error("Sync continued after a failed start")
	}
}

func contains(calls []string, want string) bool {
	for _, c := range calls {
		if c == want {
			return true
		}
	}
	return false
}
