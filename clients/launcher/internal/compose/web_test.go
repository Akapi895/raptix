package compose

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestWebProjectDoesNotMergeBaseOrOpscontrol(t *testing.T) {
	home := t.TempDir()
	t.Setenv("RAPTIX_STACK_NAME", "")
	t.Setenv("RAPTIX_OPSCONTROL_SOCK_HOST", "/test/socket")
	if err := os.WriteFile(filepath.Join(home, "docker-compose.opscontrol.yml"), []byte("services: {}"), 0o600); err != nil {
		t.Fatal(err)
	}
	base := &Compose{Home: home, ComposeFile: filepath.Join(home, "docker-compose.yml"), EnvFile: filepath.Join(home, ".env")}
	web := base.Web()
	want := []string{"compose", "-p", "raptix-web-raptix", "-f", filepath.Join(home, "docker-compose.web-raptix.yml"), "--env-file", base.EnvFile}
	if !reflect.DeepEqual(web.baseArgs(), want) {
		t.Fatalf("web args = %v, want %v", web.baseArgs(), want)
	}
	if base.ComposeFile != filepath.Join(home, "docker-compose.yml") {
		t.Fatal("Web() mutated the base selection")
	}
}
