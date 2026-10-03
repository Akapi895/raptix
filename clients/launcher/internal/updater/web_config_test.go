package updater

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestWebConfigSyncVerifiesAllFilesBeforeReplacementAndRetainsEnv(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		t.Run(fmt.Sprint(corrupt), func(t *testing.T) {
			home := t.TempDir()
			t.Setenv("RAPTIX_HOME", home)
			files := map[string]string{"docker-compose.yml": "base-new", "docker-compose.web-raptix.yml": "web-new", "config/litellm.yaml": "proxy-new"}
			for name := range files {
				dst := filepath.Join(home, filepath.FromSlash(name))
				if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(dst, []byte("original"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(home, ".env"), []byte("VAULT_ENCRYPTION_KEY=retain-private-key\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/manifest" {
					for name, body := range files {
						if corrupt && name == "docker-compose.web-raptix.yml" {
							body = "mismatched"
						}
						fmt.Fprintf(w, "%x  %s\n", sha256.Sum256([]byte(body)), name)
					}
					return
				}
				name := r.URL.Path[len("/v1.2.3/"):]
				body, ok := files[name]
				if !ok {
					http.NotFound(w, r)
					return
				}
				fmt.Fprint(w, body)
			}))
			defer server.Close()
			old := RawBaseURL
			RawBaseURL = server.URL
			defer func() { RawBaseURL = old }()
			err := SyncConfigFiles("v1.2.3", &Release{TagName: "v1.2.3", Assets: []Asset{{Name: ConfigManifestAsset, BrowserDownloadURL: server.URL + "/manifest"}}})
			if (err != nil) != corrupt {
				t.Fatalf("sync error = %v; corrupt = %v", err, corrupt)
			}
			for name, body := range files {
				actual, readErr := os.ReadFile(filepath.Join(home, filepath.FromSlash(name)))
				if readErr != nil {
					t.Fatal(readErr)
				}
				if corrupt {
					body = "original"
				}
				if string(actual) != body {
					t.Fatalf("%s = %q, want %q", name, actual, body)
				}
			}
			env, err := os.ReadFile(filepath.Join(home, ".env"))
			if err != nil || string(env) != "VAULT_ENCRYPTION_KEY=retain-private-key\n" {
				t.Fatal("operator .env changed")
			}
		})
	}
}
