package platform

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestLinuxDistroParsesPrettyName(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("LinuxDistro only reads /etc/os-release on Linux")
	}
	dir := t.TempDir()
	f := filepath.Join(dir, "os-release")
	content := "NAME=\"Kali GNU/Linux\"\nPRETTY_NAME=\"Kali GNU/Linux Rolling\"\nID=kali\n"
	if err := os.WriteFile(f, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	orig := osReleasePath
	osReleasePath = f
	defer func() { osReleasePath = orig }()

	if got := LinuxDistro(); got != "Kali GNU/Linux Rolling" {
		t.Fatalf("LinuxDistro() = %q, want %q", got, "Kali GNU/Linux Rolling")
	}
}

func TestLinuxDistroMissingFile(t *testing.T) {
	orig := osReleasePath
	osReleasePath = filepath.Join(t.TempDir(), "does-not-exist")
	defer func() { osReleasePath = orig }()

	if got := LinuxDistro(); got != "" {
		t.Fatalf("LinuxDistro() = %q, want empty string", got)
	}
}

func TestDetectDockerFlags(t *testing.T) {
	origProbe := dockerProbe
	defer func() { dockerProbe = origProbe }()

	// Daemon down: info fails, compose still reports available.
	dockerProbe = func(args ...string) bool {
		return len(args) > 0 && args[0] == "compose"
	}
	si := Detect()
	if si.OS != runtime.GOOS || si.Arch != runtime.GOARCH {
		t.Fatalf("Detect() OS/Arch = %s/%s, want %s/%s", si.OS, si.Arch, runtime.GOOS, runtime.GOARCH)
	}
	if si.DockerRunning {
		t.Error("DockerRunning should be false when `docker info` fails")
	}
}

func TestSystemInfoReadyAndHint(t *testing.T) {
	ready := SystemInfo{DockerInstalled: true, DockerRunning: true, ComposeAvailable: true}
	if !ready.Ready() {
		t.Error("Ready() = false for a fully-provisioned host")
	}
	if ready.DockerHint() != "" {
		t.Errorf("DockerHint() = %q, want empty for a ready host", ready.DockerHint())
	}

	noDocker := SystemInfo{OS: "windows"}
	if noDocker.Ready() {
		t.Error("Ready() = true with Docker absent")
	}
	if noDocker.DockerHint() == "" {
		t.Error("DockerHint() should explain how to install Docker")
	}
}

func TestOSLabel(t *testing.T) {
	cases := map[string]SystemInfo{
		"Windows":                {OS: "windows"},
		"macOS":                  {OS: "darwin"},
		"Linux":                  {OS: "linux"},
		"Kali GNU/Linux Rolling": {OS: "linux", Distro: "Kali GNU/Linux Rolling"},
	}
	for want, si := range cases {
		if got := si.OSLabel(); got != want {
			t.Errorf("OSLabel() = %q, want %q", got, want)
		}
	}
}

func TestDockerHint_ComposeMissing(t *testing.T) {
	si := SystemInfo{
		OS:               "linux",
		DockerInstalled:  true,
		DockerRunning:    true,
		ComposeAvailable: false,
	}
	if si.Ready() {
		t.Error("Ready() should be false when Compose v2 is missing")
	}
	hint := si.DockerHint()
	if hint == "" {
		t.Fatal("DockerHint() should return non-empty when Compose v2 is missing")
	}
	if !contains(hint, "Compose v2") {
		t.Errorf("DockerHint() = %q, want mention of 'Compose v2'", hint)
	}
}

func TestDockerHint_LinuxDaemonStopped(t *testing.T) {
	si := SystemInfo{
		OS:              "linux",
		DockerInstalled: true,
		DockerRunning:   false,
		IsWSL:           false,
	}
	hint := si.DockerHint()
	if !contains(hint, "systemctl start docker") {
		t.Errorf("DockerHint() = %q, want mention of `systemctl start docker` for native Linux", hint)
	}
}

func TestDockerHint_WSLDaemonStopped(t *testing.T) {
	si := SystemInfo{
		OS:              "linux",
		DockerInstalled: true,
		DockerRunning:   false,
		IsWSL:           true,
	}
	hint := si.DockerHint()
	if contains(hint, "systemctl start docker") {
		t.Errorf("DockerHint() = %q, must NOT suggest systemctl when running under WSL", hint)
	}
	if !contains(hint, "Docker Desktop") {
		t.Errorf("DockerHint() = %q, want mention of 'Docker Desktop' for WSL host", hint)
	}
}

func TestDockerHint_PerOSInstallURL(t *testing.T) {
	cases := []struct {
		os       string
		wantPart string
	}{
		{"windows", "windows-install"},
		{"darwin", "mac-install"},
		{"linux", "engine/install"},
	}
	for _, c := range cases {
		hint := SystemInfo{OS: c.os}.DockerHint()
		if !contains(hint, c.wantPart) {
			t.Errorf("OS=%s: DockerHint() = %q, want substring %q", c.os, hint, c.wantPart)
		}
	}
}

func TestDetect_ComposeAvailableWhenDockerInstalled(t *testing.T) {
	origProbe := dockerProbe
	defer func() { dockerProbe = origProbe }()

	dockerProbe = func(args ...string) bool { return true }
	si := Detect()
	// Detect checks for the Docker binary before calling the stub, so skip if Docker is absent.
	if !si.DockerInstalled {
		t.Skip("docker binary not on PATH for this runner")
	}
	if !si.DockerRunning {
		t.Error("DockerRunning should be true when info probe returns true")
	}
	if !si.ComposeAvailable {
		t.Error("ComposeAvailable should be true when compose probe returns true")
	}
}

func TestLinuxDistroIgnoresQuotedValues(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("LinuxDistro only reads /etc/os-release on Linux")
	}
	dir := t.TempDir()
	f := filepath.Join(dir, "os-release")
	content := "PRETTY_NAME=Arch Linux\nID=arch\n"
	if err := os.WriteFile(f, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	orig := osReleasePath
	osReleasePath = f
	defer func() { osReleasePath = orig }()

	if got := LinuxDistro(); got != "Arch Linux" {
		t.Errorf("LinuxDistro() = %q, want %q (unquoted PRETTY_NAME)", got, "Arch Linux")
	}
}

// contains wraps strings.Contains as a tiny test helper. Kept named
// the same as Go's builtin map check to read naturally in assertions.
func contains(haystack, needle string) bool {
	return strings.Contains(haystack, needle)
}
