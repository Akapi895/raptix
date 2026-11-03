package sandboxes

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const testKey = "0123456789abcdef0123456789abcdef"

type fakeRunner struct {
	calls   []string
	failRun string
}

func (f *fakeRunner) Output(name string, args ...string) (string, error) {
	f.calls = append(f.calls, "out "+strings.Join(append([]string{name}, args...), " "))
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

func testConfig(home string, fr *fakeRunner) Config {
	return Config{Bin: "docker", Home: home, Key: testKey, Runner: fr, Settings: Settings{Image: "img", Network: "net"}}
}

func TestEnsureStartsTheComposeFileThenCreatesThePlanDirectoryInsideTheContainer(t *testing.T) {
	home := t.TempDir()
	fr := &fakeRunner{}
	if err := Ensure(testConfig(home, fr), "lab-a"); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(home, "web-sandboxes", "lab-a.compose.yml")
	wantUp := "run docker compose -p raptix-sandbox -f " + file + " up -d --wait --wait-timeout 120"
	wantExec := "run docker exec sbx-lab-a mkdir -p /workspace/plan"
	if len(fr.calls) != 2 || fr.calls[0] != wantUp || fr.calls[1] != wantExec {
		t.Fatalf("Ensure ran %q, want %q then %q", fr.calls, wantUp, wantExec)
	}
}

func TestEnsureWritesTheComposeFileOwnerOnlyWithTheProjectToken(t *testing.T) {
	home := t.TempDir()
	if err := Ensure(testConfig(home, &fakeRunner{}), "lab-a"); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(home, "web-sandboxes", "lab-a.compose.yml")
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		t.Errorf("compose file with a token is readable by others: %v", info.Mode().Perm())
	}
	body, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "SANDBOX_TOKEN: '"+TokenFor(testKey, "lab-a")+"'") {
		t.Errorf("compose file does not carry the project token:\n%s", body)
	}
}

func TestEnsureStopsBeforeTheExecWhenTheStartFails(t *testing.T) {
	home := t.TempDir()
	fr := &fakeRunner{failRun: "compose"}
	if err := Ensure(testConfig(home, fr), "lab-a"); err == nil {
		t.Fatal("Ensure = nil, want the start failure")
	}
	for _, call := range fr.calls {
		if strings.Contains(call, "mkdir") {
			t.Errorf("Ensure created the plan directory after a failed start: %v", fr.calls)
		}
	}
}

func TestEnsureRejectsAnInvalidSlugBeforeWritingAnything(t *testing.T) {
	home := t.TempDir()
	fr := &fakeRunner{}
	for _, slug := range []string{"../escape", "Upper", "a b", ""} {
		if err := Ensure(testConfig(home, fr), slug); err == nil {
			t.Errorf("Ensure(%q) = nil, want an error", slug)
		}
	}
	if len(fr.calls) != 0 {
		t.Errorf("Ensure ran a container command for an invalid slug: %v", fr.calls)
	}
	if _, err := os.Stat(filepath.Join(home, "web-sandboxes")); err == nil {
		t.Error("Ensure created the compose directory for an invalid slug")
	}
}
