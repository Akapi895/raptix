# Phase 3 - Dữ liệu lõi + quyền tối thiểu (closure & hardening)

## Trạng thái

Phase 3 da hoan thien, HARDENED va VALIDATE LIVE tren PostgreSQL that. Gap trong audit da duoc sua het, integration repeatable, DB tu choi du lieu sai. Chua commit/stage.

## Cac lang chang da sua (tu audit)

- `tests/architecture/imports_test.go` truoc false-pass do matcher chuoi address dung dau cham thay vi slash. Da dung bien directory dung (co/khong co slash duoi), them assert tung luat inspect >=1 package, storegen match theo path segment.
- `Scope versioning`: `CreateScope` cap version bang counter nguyen tu `projects.scope_version` (migration 00010; thay cho MAX(version) cung statement voi FOR UPDATE, khong an toan READ COMMITTED) + UNIQUE(project_id, version). Verify: 8 goroutine tao scope dong thoi ra version 1..8.
- `Governance scope validity`: GrantCapability/CheckActiveGrant/CreateApproval goi ScopeAuthority (projects service contract) - scope het han hoac project archived thi quyen va approval khong con hieu luc; approval het han phai superseded.
- `Authorized run start`: StartAuthorizedRun (app) ep membership + scope active + grant run.start truoc khi tao run, audit allow/deny. Run doc lai duoc qua Runs.GetRun.
- `Evidence bytes that`: Register nhan io.Reader, service tinh size+SHA-256 tu bytes, ghi qua filesystem.Store, verify doc lai roi moi insert metadata, rollback bytes neu metadata fail. ReadRef doc bytes.
- `Finding atomic`: TransitionFindingWithHistory (CTE mot statement) - status/version va review history khong the tach roi; stale version => optimistic lock, khong ghi history le.
- `Runs lifecycle`: CreateTask chi nhan trang thai khoi dau hop le; CreateAgent xac nhan task thuoc run; AddTaskDependency la service method chan cross-run.
- `Assessment service`: them RecordHypothesis + reads (Get/List); verified_negative bat buoc co evidence.
- `Schema constraints` (migration 00009 + 00010): CHECK/UNIQUE version>0, status/severity/confidence enum, sha256 format, size>=0, raw/derived parent rule, audit outcome; parent FK RESTRICT; index cho sha256/run_id/finding_id/grant. DB tu choi du lieu sai (verify truc tiep bang psql).
- `Review round 2 fixes`: findings from_status lay tu row update (khong tin caller) + assert version==current; **evidence chuyen content-addressed storage** (key sha256/<checksum> tu bytes, dedup an toan, het lo ghi de storage key); LinkEvidence validate role + upsert; DecideApproval tai kiem tra scope; Revoke idempotent; audit.Record validate outcome; assessment nil properties -> {}; test doubles dung ID duy nhat; milestone test bat wiring hong; architecture test guard vacuity + inspect test imports; test filesystem.Rename va dedup tren real store.
- `Integration repeatable + CI`: slug/bytes unique, lookup SHA theo run (GetBySHA256InRun), CI chay cmd/migrate up truoc test.

## Kiem chung (tat ca pass)

### DB-free
gofmt -l internal tests (can), staticcheck ./..., go vet -mod=readonly ./..., go build -mod=readonly ./..., go test -race -mod=readonly -count=1 -timeout=300s ./..., go mod verify.

### Integration (PostgreSQL 17 qua Docker Desktop)

- docker compose -f deploy/compose.yaml up -d postgres; cmd/migrate -command up applied 10/10 migration (00001-00010).
- RAP_TEST_DATABASE_URL=... go test -race -count=1 -run TestPhase3 ./internal/app/ : PASS (data-flow + concurrent-scope + milestone), chay lap nhieu lan tren cung DB (repeatable).
- Luong: project+scope{1,2} -> member -> denied run(no grant) -> grant -> authorized run -> read-back -> task/agent -> artifact bytes write+checksum+read -> observation/hypothesis/coverage -> finding draft+evidence+atomic review+verdict(no flip).
- DB constraints tu choi insert sai (sha ngang, status bogus) - verify truc tiep bang psql.

## Ngoai pham vi Phase 3

- execution/invocation + sandbox + dispatch (scope/grant/budget tai dispatch) - Phase 4.
- Agent loop, verifier, context build - Phase 5.
- Review workflow day du / finding revision rieng - Phase 8.
- Memory, vault, MCP, reporting/jobs/River, CLI/API/UI - Phase 7/9/11.
- Policy engine chap hanh content/policies/default.yaml - Phase 4.

