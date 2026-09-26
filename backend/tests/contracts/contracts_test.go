// Package contracts validates the versioned Phase 7A external contracts without
// generating transport code or adding a contract-specific dependency.
package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"gopkg.in/yaml.v3"
)

func TestOpenAPIPhase7ARoutesAndOperationIDs(t *testing.T) {
	var document map[string]any
	readYAML(t, filepath.Join(repoRoot(t), "contracts", "openapi.yaml"), &document)

	if got, _ := document["openapi"].(string); got != "3.1.0" {
		t.Fatalf("openapi version = %q, want 3.1.0", got)
	}
	assertBearerOIDCSecurity(t, document)
	validateReferences(t, document, document, filepath.Join(repoRoot(t), "contracts"))

	paths, ok := document["paths"].(map[string]any)
	if !ok {
		t.Fatal("paths is not an object")
	}
	want := map[string][]string{
		"/healthz":                              {"get"},
		"/api/v1/projects":                      {"get"},
		"/api/v1/projects/{projectId}":          {"get"},
		"/api/v1/projects/{projectId}/scopes":   {"get"},
		"/api/v1/projects/{projectId}/runs":     {"get", "post"},
		"/api/v1/runs/{runId}":                  {"get"},
		"/api/v1/runs/{runId}/tasks":            {"get"},
		"/api/v1/runs/{runId}/agents":           {"get", "post"},
		"/api/v1/agents/{agentId}/attempts":     {"post"},
		"/api/v1/runs/{runId}/cancel":           {"post"},
		"/api/v1/runs/{runId}/evidence":         {"get"},
		"/api/v1/evidence/{evidenceId}":         {"get"},
		"/api/v1/evidence/{evidenceId}/content": {"get"},
		"/api/v1/runs/{runId}/findings":         {"get"},
		"/api/v1/findings/{findingId}":          {"get"},
		"/api/v1/findings/{findingId}/revisions": {"get", "post"},
		"/api/v1/findings/{findingId}/reviews":   {"post"},
		"/api/v1/runs/{runId}/reports":           {"post"},
		"/api/v1/reports/{reportId}":             {"get"},
		"/api/v1/reports/{reportId}/content":     {"get"},
		"/api/v1/runs/{runId}/events":            {"get"},
	}
	if len(paths) != len(want) {
		t.Fatalf("route count = %d, want %d", len(paths), len(want))
	}

	operationIDs := map[string]string{}
	for route, methods := range want {
		pathItem, ok := paths[route].(map[string]any)
		if !ok {
			t.Errorf("missing path %s", route)
			continue
		}
		for _, method := range methods {
			op, ok := pathItem[method].(map[string]any)
			if !ok {
				t.Errorf("missing %s %s", method, route)
				continue
			}
			operationID, ok := op["operationId"].(string)
			if !ok || operationID == "" {
				t.Errorf("%s %s has no operationId", method, route)
				continue
			}
			if previous, exists := operationIDs[operationID]; exists {
				t.Errorf("operationId %q reused by %s and %s %s", operationID, previous, method, route)
			}
			operationIDs[operationID] = method + " " + route
		}
	}
	for route := range paths {
		if _, ok := want[route]; !ok {
			t.Errorf("route outside Phase 7A contract: %s", route)
		}
	}

	for _, route := range []string{
		"/api/v1/projects/{projectId}/runs",
		"/api/v1/runs/{runId}/agents",
		"/api/v1/agents/{agentId}/attempts",
		"/api/v1/findings/{findingId}/revisions",
		"/api/v1/findings/{findingId}/reviews",
		"/api/v1/runs/{runId}/reports",
	} {
		pathItem := paths[route].(map[string]any)
		if !hasRequiredParameter(pathItem["post"].(map[string]any), "Idempotency-Key") {
			t.Errorf("POST %s must require Idempotency-Key", route)
		}
	}
}

func assertBearerOIDCSecurity(t *testing.T, document map[string]any) {
	t.Helper()
	components, ok := document["components"].(map[string]any)
	if !ok {
		t.Fatal("components is not an object")
	}
	schemes, ok := components["securitySchemes"].(map[string]any)
	if !ok {
		t.Fatal("security schemes are missing")
	}
	bearer, ok := schemes["bearerOidc"].(map[string]any)
	if !ok || bearer["type"] != "http" || bearer["scheme"] != "bearer" || bearer["bearerFormat"] != "JWT" {
		t.Error("bearerOidc must be an HTTP Bearer JWT scheme")
	}
	capabilities, ok := document["x-capabilities"].([]any)
	if !ok || len(capabilities) != 8 {
		t.Error("x-capabilities must lock the eight authorization capability names")
	}
}

func validateReferences(t *testing.T, value any, root map[string]any, contractsRoot string) {
	t.Helper()
	switch node := value.(type) {
	case map[string]any:
		if ref, ok := node["$ref"].(string); ok {
			switch {
			case strings.HasPrefix(ref, "#/"):
				if !hasJSONPointer(root, strings.TrimPrefix(ref, "#/")) {
					t.Errorf("unresolved OpenAPI reference %q", ref)
				}
			case strings.HasPrefix(ref, "./"):
				path := strings.SplitN(strings.TrimPrefix(ref, "./"), "#", 2)[0]
				if _, err := os.Stat(filepath.Join(contractsRoot, path)); err != nil {
					t.Errorf("unresolved external OpenAPI reference %q: %v", ref, err)
				}
			default:
				t.Errorf("unsupported OpenAPI reference %q", ref)
			}
		}
		for _, child := range node {
			validateReferences(t, child, root, contractsRoot)
		}
	case []any:
		for _, child := range node {
			validateReferences(t, child, root, contractsRoot)
		}
	}
}

func hasJSONPointer(root map[string]any, pointer string) bool {
	var value any = root
	for _, segment := range strings.Split(pointer, "/") {
		segment = strings.ReplaceAll(strings.ReplaceAll(segment, "~1", "/"), "~0", "~")
		object, ok := value.(map[string]any)
		if !ok {
			return false
		}
		var exists bool
		value, exists = object[segment]
		if !exists {
			return false
		}
	}
	return true
}

func TestEventFixturesValidate(t *testing.T) {
	contractsRoot := filepath.Join(repoRoot(t), "contracts", "events")
	schema, err := jsonschema.NewCompiler().Compile(filepath.Join(contractsRoot, "v1.schema.json"))
	if err != nil {
		t.Fatalf("compile event schema: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(contractsRoot, "fixtures", "v1.events.json"))
	if err != nil {
		t.Fatalf("read event fixtures: %v", err)
	}
	var fixtures []any
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatalf("decode event fixtures: %v", err)
	}
	if len(fixtures) != 14 {
		t.Fatalf("fixture count = %d, want 14 event types", len(fixtures))
	}
	for i, fixture := range fixtures {
		if err := schema.Validate(fixture); err != nil {
			t.Errorf("fixture %d: %v", i, err)
		}
	}
}

func hasRequiredParameter(operation map[string]any, name string) bool {
	parameters, _ := operation["parameters"].([]any)
	for _, value := range parameters {
		parameter, ok := value.(map[string]any)
		if !ok {
			continue
		}
		if parameter["$ref"] == "#/components/parameters/IdempotencyKey" {
			return true
		}
		if parameter["name"] == name && parameter["required"] == true {
			return true
		}
	}
	return false
}

func readYAML(t *testing.T, path string, destination any) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := yaml.Unmarshal(data, destination); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
}

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "contracts", "openapi.yaml")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not locate repository root")
		}
		dir = parent
	}
}
