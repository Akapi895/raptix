# Phase 2 Fix Closure

## Status

Phase 2 acceptance is closed for the repository-local unit, contract, mock
provider, and race-test scope. No commit or stage operation was performed.

## Resolved Findings

1. **Registry concurrency and versions:** all map lookup/selection happens
   under the registry read lock. Concurrent registration and lookup are covered
   by `-race`; semver ordering selects `1.10.0` over `1.9.0`. Empty manifest
   versions resolve deterministically to `1.0.0`.
2. **Manifest contracts:** `jsonschema/v6` compiles the authoritative schemas.
   YAML decoding rejects unknown fields and multiple documents; the schemas,
   Go models, and real profile/tool fixtures agree on fields and local `$ref`.
   Negative coverage includes invalid apiVersion/executor, malformed schema
   documents, negative resource size, boolean input/output schema, and missing
   schema roots.
3. **Content containment:** loader references reject absolute/traversal paths
   and resolve existing paths through the canonical content root before reads.
   Tests cover escaping symlinks and valid bare/qualified skill references.
4. **Skill parsing:** duplicate bare names are rejected as ambiguous; qualified
   names remain valid. Parsing recognizes only full-line frontmatter delimiters,
   accepts BOM/LF/CRLF, preserves body bytes, verifies directory identity, and
   preserves supplied version metadata.
5. **Identity and provenance:** skill metadata can be read without the body and
   includes identity, deterministic SHA-256 source hash, version, and
   content-root-relative path. Hash tests cover stable and changed content.
6. **Registry lifecycle:** declaration, one-time implementation binding, and
   readiness are distinct. Declared-only entries are not available; invalid
   executor kinds and conflicting bindings fail. Immutable descriptors expose
   executor, source, schemas, runtime requirements, and readiness without
   granting execution rights.
7. **Composition and references:** configured malformed content/model setup
   fails startup; an absent content root is the disabled catalog mode. Profile
   prompt/skill/tool/resource references are resolved before profile success.
   The example configuration uses repo-relative paths for a server started from
   `backend/`.
8. **Output contract:** execution and parser outcomes are independent, failure
   details are serializable, raw evidence survives parser failure, and result
   invariants reject contradictory artifact/status combinations. `Result` no
   longer implements `error`.
9. **LLM contract:** request and URL validation reject invalid values before
   adapter conversion. Stream chunks retain finish reason and emit a terminal
   chunk with the latest known usage on provider EOF. HTTP/SSE mock tests cover
   Chat, model override, provider errors, streamed terminal usage, and EOF.
   Retry remains owned by a later orchestration/execution phase; the adapter
   does not retry a stream after emitting data.
10. **Milestone:** `phase2_milestone_test.go` uses `app.New`, a real temporary
    content catalog and prompt, an OpenAI-compatible `httptest` provider, and
    the wired `a.model` for both Chat and Stream. Missing prompt references
    fail the composition-root test.
11. **Attribution and docs:** Claude-Red source revision and full MIT notice
    are recorded in `content/skills/NOTICE.md`; nmap records its pinned source
    commit; migration manifest and README describe the implemented Phase 2
    boundary.
12. **Module hygiene:** `go mod tidy` was run; direct dependencies are recorded
    correctly and module verification passes.

## Verification

Run from `backend/` on 2026-09-21:

```text
gofmt -l internal
go vet -mod=readonly ./...
go build -mod=readonly ./...
go test -race -mod=readonly -count=1 -timeout=90s ./...
go mod verify
```

All commands passed. The `gofmt -l internal` command produced no output.

## Integration Scope

- PostgreSQL transaction integration tests were not run: Docker is unavailable
  in this WSL environment. They remain opt-in through `RAP_TEST_DATABASE_URL`
  and are covered by CI's dedicated database.
- The live VTNet provider test remains opt-in through `RAP_TEST_LLM_API_KEY`.
  It was not run; CI-safe `httptest` OpenAI/SSE regressions are part of the
  regular suite.
- Tool dispatch, sandboxing, governance, agent loop, evidence persistence, and
  verification/finding lifecycle remain later phases by design.
