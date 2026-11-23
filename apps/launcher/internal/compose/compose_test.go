package compose

import (
	"path/filepath"
	"testing"
)

func TestNew(t *testing.T) {
	home := t.TempDir()
	t.Setenv("RAPTIX_HOME", home)
	c := New()
	if c.Home != home {
		t.Errorf("Home = %q, want %q", c.Home, home)
	}
	if want := filepath.Join(home, "docker-compose.yml"); c.ComposeFile != want {
		t.Errorf("ComposeFile = %q, want %q", c.ComposeFile, want)
	}
	if want := filepath.Join(home, ".env"); c.EnvFile != want {
		t.Errorf("EnvFile = %q, want %q", c.EnvFile, want)
	}
}

func TestAllProfiles(t *testing.T) {
	profiles := AllProfiles()
	expected := []string{
		"--profile", "c2-sliver",
		"--profile", "ad",
		"--profile", "reversing",
	}
	if len(profiles) != len(expected) {
		t.Fatalf("AllProfiles() len = %d, want %d", len(profiles), len(expected))
	}
	for i, v := range expected {
		if profiles[i] != v {
			t.Errorf("profiles[%d] = %q, want %q", i, profiles[i], v)
		}
	}
}

func TestBaseArgs(t *testing.T) {
	t.Setenv("RAPTIX_STACK_NAME", "")
	c := &Compose{
		Home:        "/test",
		ComposeFile: "/test/docker-compose.yml",
		EnvFile:     "/test/.env",
	}
	args := c.baseArgs()
	// Keep the project name explicit so the launcher and host daemon target the same stack.
	want := []string{
		"compose",
		"-p", "raptix",
		"-f", "/test/docker-compose.yml",
		"--env-file", "/test/.env",
	}
	if len(args) != len(want) {
		t.Fatalf("baseArgs len = %d (%v); want %d (%v)", len(args), args, len(want), want)
	}
	for i, v := range want {
		if args[i] != v {
			t.Errorf("args[%d] = %q, want %q", i, args[i], v)
		}
	}
}

func TestBaseArgs_StackNameOverridesProjectName(t *testing.T) {
	t.Setenv("RAPTIX_STACK_NAME", "stack2")
	c := &Compose{
		Home:        "/test",
		ComposeFile: "/test/docker-compose.yml",
		EnvFile:     "/test/.env",
	}
	args := c.baseArgs()
	if args[2] != "raptix-stack2" {
		t.Errorf("expected -p raptix-stack2 for RAPTIX_STACK_NAME=stack2; got args=%v", args)
	}
}

func TestImageTag(t *testing.T) {
	tests := map[string]string{
		"v1.0.21":  "1.0.21",
		"1.0.21":   "1.0.21",
		" latest ": "latest",
	}
	for input, want := range tests {
		if got := imageTag(input); got != want {
			t.Errorf("imageTag(%q) = %q, want %q", input, got, want)
		}
	}
}
