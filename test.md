# test.md — Kịch bản kiểm thử Phase 7A + Phase 8 (API/SSE/CLI + review/report/jobs)

Tài liệu này là hướng dẫn chạy tay (thủ công) và chạy tự động để xác nhận:
- Phase 7A: scope binding, idempotency, HTTP API, SSE, CLI client.
- Phase 8: finding revision/review, report snapshot, River job, periodic reconcile.

Chạy **theo thứ tự tầng**. Mỗi tầng có `[ ]` checklist. Tầng 1–3 là bắt buộc; tầng 4–7 cần server/CLI chạy thật.

---

## 0. Quy ước và phạm vi

- Môi trường: **WSL Ubuntu**. Mọi lệnh chạy trong WSL (không dùng PowerShell cho Go/psql/git).
- Go: `~/go1.26/bin/go` (đừng dùng `/usr/bin/go` 1.22).
- PostgreSQL chạy trong Docker qua `deploy/compose.yaml` (service `postgres`, user/pass `raptix`).
- Thư mục làm việc repo: `/home/pat/redteam/raptix`.
- Nếu chưa mở WSL: `wsl.exe -d Ubuntu bash -lc "<lệnh>"`.
- Các khối lệnh dùng chung một shell; hãy `export` biến ở mục 2 trước.

Kết quả mong đợi được ghi là `→ EXPECT: ...`.

---

## 1. Chuẩn bị môi trường

### 1.1. Kiểm tra Go và Docker

```bash
~/go1.26/bin/go version
# → EXPECT: go version go1.26.0 linux/amd64

docker --version
docker compose version
```

### 1.2. Bật PostgreSQL

```bash
cd /home/pat/redteam/raptix
docker compose -f deploy/compose.yaml up -d --wait postgres
docker compose -f deploy/compose.yaml ps
# → EXPECT: raptix-postgres ... Up ... (healthy) ... 0.0.0.0:5432->5432/tcp
```

### 1.3. Kiểm tra kết nối DB (không cần cài psql, dùng trong container)

```bash
docker exec raptix-postgres psql -U raptix -d postgres -c "SELECT version();"
# → EXPECT: PostgreSQL 17...
```

### 1.4. Tạo database test nếu chưa có

```bash
docker exec raptix-postgres psql -U raptix -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='raptix_test'" | grep -q 1 \
  || docker exec raptix-postgres psql -U raptix -d postgres -c "CREATE DATABASE raptix_test;"
# → EXPECT: (không lỗi) database raptix_test tồn tại
```

---

## 2. Biến môi trường dùng chung (copy & chạy)

```bash
export REPO=/home/pat/redteam/raptix
export GO=~/go1.26/bin/go
export SQLC=/home/pat/go/bin/sqlc
export STATICCHECK=/home/pat/go/bin/staticcheck

export SERVER_URL=http://127.0.0.1:18080
export TOKEN=dev-token                 # development mode bỏ qua giá trị, nhưng CLI bắt buộc non-empty
export SUBJECT=development             # PHẢI khớp auth.development_principal (mặc định "development")

export DSN="postgres://raptix:raptix@localhost:5432/raptix?sslmode=disable"
export TEST_DSN="postgres://raptix:raptix@localhost:5432/raptix_test?sslmode=disable"

export CONTENT_ROOT="$REPO/content"
export ARTIFACT_ROOT="$REPO/data/artifacts"

export PROJECT_ID=11111111-1111-4111-8111-111111111111
export SCOPE_ID=22222222-2222-4222-8222-222222222222
```

Lưu ý quan trọng:
- `configs/app.yaml` đặt `content.root: ./content`; khi chạy server từ `backend/` thì đường dẫn này trỏ sai. **Luôn export `RAP_CONTENT_ROOT` và `RAP_ARTIFACT_ROOT`** (mục 5) để tránh "content catalog disabled".
- `configs/app.yaml` đã có `llm.api_key` nên agent có thể chạy thật (kết quả phụ thuộc model/mạng). Muốn test đường "không LLM", dùng tầng 4 (tạo run bằng curl, không gọi agent attempt).
- `configs/app.yaml` là file local đã gitignore; không commit.

---

## 3. Tầng 1 — Kiểm thử tự động (không cần server/CLI)

Chạy trong `backend/`.

```bash
cd "$REPO/backend"

# 3.1. Build toàn bộ
$GO build ./...
# → EXPECT: không output, exit 0

# 3.2. Vet
$GO vet ./...
# → EXPECT: không output

# 3.3. Staticcheck
$STATICCHECK ./...
# → EXPECT: không output

# 3.4. Generated SQL không drift
$SQLC diff
# → EXPECT: không output (exit 0)

# 3.5. Format
gofmt -l internal cmd
# → EXPECT: không output

# 3.6. Test không cần DB (unit + contract + eval + architecture)
$GO test -mod=readonly -count=1 ./...
# → EXPECT: tất cả "ok", không "FAIL"
```

### 3.7. Integration test với PostgreSQL thật

```bash
cd "$REPO/backend"

# Áp migration lên raptix_test (gồm goose + River)
RAP_DATABASE_URL="$TEST_DSN" $GO run ./cmd/migrate -config ../configs/app.yaml -dir migrations -command up
# → EXPECT: applied 00001..00016 + "applied river migrations"

RAP_DATABASE_URL="$TEST_DSN" $GO run ./cmd/migrate -config ../configs/app.yaml -dir migrations -command status
# → EXPECT: các dòng "applied", và "river migrations: applied"

# Chạy toàn bộ test (bao gồm opt-in DB tests)
RAP_TEST_DATABASE_URL="$TEST_DSN" $GO test -mod=readonly -count=1 -timeout=600s ./...
# → EXPECT: tất cả "ok"

# Chạy riêng các luồng quan trọng (verbose để thấy tên test)
RAP_TEST_DATABASE_URL="$TEST_DSN" $GO test -mod=readonly -count=1 -v \
  -run 'TestPhase3IntegrationDataFlow|TestPhase4InvokeCapabilityDataFlow|TestPhase5AgentDataFlow|TestPhase6|TestPhase8' \
  ./internal/app/
# → EXPECT: PASS các test:
#   TestPhase3IntegrationDataFlow
#   TestPhase4InvokeCapabilityDataFlow
#   TestPhase5AgentDataFlow
#   TestPhase6ReconcileStale / TestPhase6CancelRunCascade / TestPhase6CancelDoesNotMissConcurrentInvocationCreation / TestPhase6IdempotencyNoRerun
#   TestPhase8ReportRenderIdempotent / TestPhase8FindingRevisionReview / TestPhase8RiverReportWorker / TestPhase8HTTPReportFlow
```

### 3.8. Race detector (khuyến nghị trước khi tiếp tục)

```bash
cd "$REPO/backend"
RAP_TEST_DATABASE_URL="$TEST_DSN" $GO test -race -mod=readonly -count=1 -timeout=900s ./...
# → EXPECT: tất cả "ok", không "WARNING: DATA RACE"
```

### 3.9. check.sh (tổng hợp vet+build+test)

```bash
cd "$REPO"
bash scripts/check.sh
# → EXPECT: kết thúc bằng "OK"
```

### 3.10. Kiểm tra module

```bash
cd "$REPO/backend"
$GO mod verify
# → EXPECT: all modules verified
```

Checklist tầng 1:
- [ ] build/vet/staticcheck/sqlc diff/gofmt sạch
- [ ] `go test ./...` pass
- [ ] migrate `raptix_test` tới 00016 + River applied
- [ ] integration Phase 3–8 pass
- [ ] race pass
- [ ] check.sh OK
- [ ] go mod verify OK

---

## 4. Tầng 2 — Migration & bootstrap dữ liệu workflow

### 4.1. Migrate database dev (`raptix`)

```bash
cd "$REPO/backend"
RAP_DATABASE_URL="$DSN" $GO run ./cmd/migrate -config ../configs/app.yaml -dir migrations -command up
# → EXPECT: applied ... + "applied river migrations"

RAP_DATABASE_URL="$DSN" $GO run ./cmd/migrate -config ../configs/app.yaml -dir migrations -command status
# → EXPECT: 00014/00015/00016 applied; "river migrations: applied"
```

### 4.2. Kiểm tra bảng mới đã có

```bash
docker exec raptix-postgres psql -U raptix -d raptix -c "\dt" | grep -E "finding_revisions|report_requests|river_job"
# → EXPECT: thấy finding_revisions, finding_revision_evidence, report_requests, river_job
```

### 4.3. Bootstrap project/scope/member/grants cho CLI

Chạy khối SQL sau. `subject` phải bằng `$SUBJECT` (development). Idempotent.

```bash
docker exec -i raptix-postgres psql -U raptix -d raptix -v ON_ERROR_STOP=1 <<SQL
-- project
INSERT INTO projects (id, name, slug)
VALUES ('${PROJECT_ID}', 'Manual Test', 'manual-test')
ON CONFLICT (id) DO NOTHING;

-- scope (version 1)
INSERT INTO scopes (id, project_id, asset_types, include)
VALUES ('${SCOPE_ID}', '${PROJECT_ID}', ARRAY['endpoint'], ARRAY['http://127.0.0.1:19090'])
ON CONFLICT (id) DO NOTHING;

-- membership
INSERT INTO project_members (project_id, subject, role)
VALUES ('${PROJECT_ID}', '${SUBJECT}', 'owner')
ON CONFLICT (project_id, subject) DO NOTHING;

-- capability grants (chỉ thêm nếu chưa có, tránh trùng khi chạy lại)
INSERT INTO capability_grants (subject, scope_id, capability, granted_by)
SELECT '${SUBJECT}', '${SCOPE_ID}', c, 'bootstrap'
FROM unnest(ARRAY[
  'run.start','run.read','run.control',
  'evidence.read','finding.read','finding.review',
  'report.create','report.read',
  'http_probe','nmap'
]) AS c
WHERE NOT EXISTS (
  SELECT 1 FROM capability_grants g
  WHERE g.subject='${SUBJECT}' AND g.scope_id='${SCOPE_ID}' AND g.capability=c AND g.revoked_at IS NULL
);
SQL
# → EXPECT: INSERT 0 1 (mỗi câu; lần chạy lại có thể INSERT 0 0)
```

### 4.4. Kiểm tra bootstrap

```bash
docker exec raptix-postgres psql -U raptix -d raptix -c \
"SELECT capability, revoked_at FROM capability_grants WHERE scope_id='${SCOPE_ID}' ORDER BY capability;"
# → EXPECT: 10 capability, revoked_at = null

docker exec raptix-postgres psql -U raptix -d raptix -c \
"SELECT subject, role FROM project_members WHERE project_id='${PROJECT_ID}';"
# → EXPECT: development | owner
```

Checklist tầng 2:
- [ ] migrate dev lên 00016 + River
- [ ] thấy các bảng mới
- [ ] project/scope/member/grants đã tạo
- [ ] 10 grants active

---

## 5. Tầng 3 — Khởi động server và health

### 5.1. Chạy server (terminal riêng để thấy log)

```bash
cd "$REPO/backend"
export RAP_CONTENT_ROOT="$CONTENT_ROOT"
export RAP_ARTIFACT_ROOT="$ARTIFACT_ROOT"
# Nếu muốn tắt agent thật (test không LLM), thêm:
# export RAP_LLM_BASE_URL="http://127.0.0.1:9" RAP_LLM_API_KEY="invalid"
$GO run ./cmd/server -config ../configs/app.yaml
```

Log mong đợi:
```
→ EXPECT:
  "bound builtin capability" tool=http_probe
  "registered tool from manifest" ...
  "jobs worker started"
  "http server listening" addr=[::]:18080
```
Nếu thấy `jobs worker did not start` → chưa chạy `cmd/migrate` (River schema thiếu).

### 5.2. Health check (terminal khác)

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/healthz
# → EXPECT: 200
curl -sS http://127.0.0.1:18080/healthz
# → EXPECT: ok
```

Checklist tầng 3:
- [ ] log "jobs worker started" và "http server listening" addr=:18080
- [ ] `/healthz` trả 200 "ok"

---

## 6. Tầng 4 — CLI smoke workflow (KHÔNG cần LLM)

Mục tiêu: xác nhận CLI nối server, tạo run, đọc state, tạo report, lấy nội dung report — tất cả qua HTTP/SSE, không dùng agent/LLM.
Ở đây tạo run bằng `curl` (để không gọi agent attempt); sau đó thao tác bằng CLI.

### 6.1. Build CLI

```bash
cd "$REPO/backend"
$GO build -o /tmp/raptix ./cmd/cli
/tmp/raptix --help
# → EXPECT: các nhóm lệnh run, evidence, finding, report, completion
```

### 6.2. Tạo run bằng HTTP (không agent)

```bash
RUN_JSON=$(curl -sS -X POST "$SERVER_URL/api/v1/projects/$PROJECT_ID/runs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: manual-run-1" \
  -H "Content-Type: application/json" \
  -d "{\"scopeId\":\"$SCOPE_ID\",\"name\":\"manual run\"}")
echo "$RUN_JSON"
RUN_ID=$(echo "$RUN_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "RUN_ID=$RUN_ID"
# → EXPECT: JSON có id, projectId, scopeId, status "queued"
```

### 6.3. Idempotency của create run (cùng key + cùng payload)

```bash
RUN_JSON2=$(curl -sS -X POST "$SERVER_URL/api/v1/projects/$PROJECT_ID/runs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: manual-run-1" \
  -H "Content-Type: application/json" \
  -d "{\"scopeId\":\"$SCOPE_ID\",\"name\":\"manual run\"}")
RUN_ID2=$(echo "$RUN_JSON2" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
[ "$RUN_ID" = "$RUN_ID2" ] && echo "IDEMPOTENT OK" || echo "FAIL: tạo run trùng"
# → EXPECT: IDEMPOTENT OK
```

### 6.4. Idempotency conflict (cùng key, payload khác) — curl

```bash
curl -sS -o /tmp/conflict.json -w '%{http_code}\n' -X POST "$SERVER_URL/api/v1/projects/$PROJECT_ID/runs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: manual-run-1" \
  -H "Content-Type: application/json" \
  -d "{\"scopeId\":\"$SCOPE_ID\",\"name\":\"different name\"}"
cat /tmp/conflict.json
# → EXPECT: 409, body problem+json code "conflict"
```

### 6.5. CLI đọc run (status + JSON)

```bash
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" run status "$RUN_ID"
# → EXPECT: "<RUN_ID>\tqueued\tmanual run"

/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" --json run status "$RUN_ID" | python3 -m json.tool
# → EXPECT: JSON run, không lẫn dòng "progress ..." trong stdout
```

### 6.6. CLI watch SSE (rồi Ctrl-C)

```bash
timeout 5 /tmp/raptix --server "$SERVER_URL" --token "$TOKEN" run watch "$RUN_ID" || true
# → EXPECT: nhận ít nhất event "snapshot" (in ra stderr dạng "progress snapshot"); timeout dừng.
```

### 6.7. CLI evidence list (rỗng với run không agent)

```bash
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" evidence list "$RUN_ID"
# → EXPECT: không có item (run chưa có evidence)
```

### 6.8. CLI tạo report + watch + lấy nội dung

```bash
REPORT_JSON=$(/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" --json \
  report create "$RUN_ID" --template-id default --template-version 1)
echo "$REPORT_JSON"
REPORT_ID=$(echo "$REPORT_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
# → EXPECT: JSON report status "queued", templateHash khớp
#   (default.yaml hash = 2d1c981d89081fed51d2a74577b817ee146d0aa6e45882bf3d11658bbda935ff)

# Worker River render (có thể mất vài giây)
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" report watch "$REPORT_ID"
# → EXPECT: in trạng thái queued → rendering → completed (stderr), cuối cùng in report summary

/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" report get "$REPORT_ID"
# → EXPECT: "<REPORT_ID>\tcompleted\t"

/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" report get "$REPORT_ID" --content
# → EXPECT: Markdown report:
#   "# Security Assessment Report"
#   "**Run:** manual run"
#   "No findings recorded."
```

### 6.9. Idempotency report (tạo lại cùng run → cùng report)

```bash
REPORT_JSON2=$(/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" --json \
  report create "$RUN_ID" --template-id default --template-version 1)
REPORT_ID2=$(echo "$REPORT_JSON2" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
[ "$REPORT_ID" = "$REPORT_ID2" ] && echo "REPORT IDEMPOTENT OK" || echo "FAIL"
# → EXPECT: REPORT IDEMPOTENT OK
```

### 6.10. CLI cancel (idempotent, 2 lần)

```bash
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" run cancel "$RUN_ID"
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" run cancel "$RUN_ID"
# → EXPECT: cả hai in status "cancelled", không lỗi
```

Checklist tầng 4:
- [ ] CLI build và `--help` có đủ nhóm lệnh
- [ ] tạo run qua curl, idempotent cùng key
- [ ] conflict 409 cùng key khác payload
- [ ] `run status` (text + json, stdout sạch)
- [ ] `run watch` nhận snapshot
- [ ] `evidence list` chạy
- [ ] `report create/watch/get --content` ra Markdown đúng
- [ ] report idempotent
- [ ] `run cancel` hai lần đều cancelled

---

## 7. Tầng 5 — CLI full workflow có LLM (agent → finding → review → report)

Phần này phụ thuộc model thật (`llm.api_key` trong `configs/app.yaml`) nên **không deterministic**. Dùng để xác nhận luồng end-to-end; các assert chính xác đã có ở test Go (TestPhase5/Phase8).

Điều kiện:
- Server chạy **có** LLM hợp lệ (không set `RAP_LLM_BASE_URL` giả).
- Có lab HTTP để `http_probe` gọi (tùy chọn). Có thể chạy lab đơn giản:

```bash
# Terminal riêng
python3 -m http.server 19090 --bind 127.0.0.1
```

### 7.1. Chạy agent qua CLI

```bash
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" --json \
  run start \
  --project "$PROJECT_ID" \
  --scope "$SCOPE_ID" \
  --name "agent run" \
  --profile recon \
  --task "Probe http://127.0.0.1:19090 and report missing security headers"
# → EXPECT: JSON gồm run/agent/attempt; attempt.status "succeeded" hoặc "failed".
#   RUN_ID lấy từ JSON: run.id
```

Ghi lại RUN_ID:
```bash
AGENT_RUN_ID=$(... )   # lấy "id" trong object "run" của output trên
echo "$AGENT_RUN_ID"
```

### 7.2. Đọc finding do agent tạo (nếu có)

```bash
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" finding list "$AGENT_RUN_ID"
# → EXPECT: 0 hoặc nhiều finding; nếu có, lấy FINDING_ID
FINDING_ID=$(...)
```

Nếu agent không tạo finding (model không gọi tool/final JSON), có thể bỏ qua 7.3–7.5 và dùng test Go để xác nhận.

### 7.3. Xem revisions

```bash
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" finding revisions "$FINDING_ID"
# → EXPECT: revision 1 (draft), evidence (nếu có)
```

### 7.4. Revise finding (tạo revision mới, expected-version)

```bash
VERSION=$(/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" --json finding get "$FINDING_ID" | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])')
echo "VERSION=$VERSION"

/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" finding revise "$FINDING_ID" \
  --expected-version "$VERSION" \
  --title "Missing security headers (revised)" \
  --description "Updated after manual review" \
  --severity high --confidence high \
  --reason "manual revision"
# → EXPECT: version tăng 1; revisions có thêm bản mới
```

### 7.5. Review finding (confirmed/rejected/inconclusive)

```bash
VERSION=$(/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" --json finding get "$FINDING_ID" | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])')
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" finding review "$FINDING_ID" \
  --expected-version "$VERSION" --decision confirmed --reason "evidence sufficient"
# → EXPECT: status "confirmed"
```

### 7.6. Report từ run có finding + snapshot bất biến

```bash
AGENT_REPORT_ID=$(/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" --json \
  report create "$AGENT_RUN_ID" --template-id default --template-version 1 \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" report watch "$AGENT_REPORT_ID"
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" report get "$AGENT_REPORT_ID" --content
# → EXPECT: nội dung chứa title/severity/status của finding tại thời điểm snapshot

# Sửa finding SAU khi report completed
VERSION=$(/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" --json finding get "$FINDING_ID" | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])')
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" finding revise "$FINDING_ID" \
  --expected-version "$VERSION" --title "CHANGED AFTER REPORT" --severity low --confidence low --reason "post-report"

# Lấy lại report: nội dung KHÔNG đổi
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" report get "$AGENT_REPORT_ID" --content | grep -q "CHANGED AFTER REPORT" \
  && echo "FAIL: report đổi theo finding" || echo "SNAPSHOT IMMUTABLE OK"
# → EXPECT: SNAPSHOT IMMUTABLE OK
```

Checklist tầng 5:
- [ ] `run start` chạy agent (attempt succeeded/failed có ghi nhận)
- [ ] `finding list/get/revisions` hoạt động
- [ ] `finding revise` tăng version, thêm revision
- [ ] `finding review` đổi status
- [ ] report chứa dữ liệu finding
- [ ] revise sau report không đổi nội dung report

---

## 8. Tầng 6 — Hành vi lỗi / bảo mật / SSE

### 8.1. CLI thiếu token

```bash
/tmp/raptix --server "$SERVER_URL" run status "$RUN_ID"; echo "exit=$?"
# → EXPECT: lỗi "API token is required", exit=2
```
(`run status` ở đây chỉ cần để kích hoạt client; nếu chưa có RUN_ID, dùng UUID bất kỳ.)

### 8.2. CLI sai URL server

```bash
/tmp/raptix --server http://127.0.0.1:1 --token "$TOKEN" run status "$PROJECT_ID"; echo "exit=$?"
# → EXPECT: exit=6 (lỗi kết nối)
```

### 8.3. CLI UUID sai

```bash
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" run status not-a-uuid; echo "exit=$?"
# → EXPECT: "run ID must be a UUID", exit=2
```

### 8.4. HTTP không token → 401

```bash
curl -sS -o /tmp/unauth.json -w '%{http_code}\n' "$SERVER_URL/api/v1/projects"
cat /tmp/unauth.json
# → EXPECT: 401, problem+json code "unauthenticated"
```

### 8.5. Không có grant → 403

Tạo một project/scope khác **không** cấp grant cho `$SUBJECT` rồi thử tạo run bằng curl:
```bash
# (tùy chọn) tạo nhanh project/scope phụ và thử
# → EXPECT: 403 forbidden
```
Hoặc dùng test Go `TestPhase3IntegrationDataFlow` (đã có deny-path) để xác nhận tự động.

### 8.6. SSE reconnect lấy snapshot (cursor cũ/sai)

```bash
timeout 5 /tmp/raptix --server "$SERVER_URL" --token "$TOKEN" run watch "$RUN_ID" --cursor "deadbeef:1" || true
# → EXPECT: nhận event "snapshot" trước (fallback khi cursor không liên tục)
```

### 8.7. Evidence `secret` không tải được

Tạo artifact secret bằng SQL rồi thử tải qua CLI (tùy chọn):
```bash
# Ghi artifact metadata secret trỏ tới bytes có thể không tồn tại; chỉ để test 403 trước khi đọc.
docker exec -i raptix-postgres psql -U raptix -d raptix -v ON_ERROR_STOP=1 <<SQL
INSERT INTO artifacts (run_id, kind, mime, size, sha256, sensitivity, storage_key)
VALUES ('${RUN_ID}', 'raw', 'text/plain', 1,
        encode(digest('x','sha256'),'hex'), 'secret', 'sha256/nonexistent');
SQL

EVID=$(docker exec raptix-postgres psql -U raptix -d raptix -tAc \
  "SELECT id FROM artifacts WHERE run_id='${RUN_ID}' AND sensitivity='secret' ORDER BY created_at DESC LIMIT 1")
curl -sS -o /tmp/secret.json -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" "$SERVER_URL/api/v1/evidence/$EVID/content"
cat /tmp/secret.json
# → EXPECT: 403 forbidden (không trả bytes)
```
(Nếu user chưa có `$RUN_ID` hợp lệ ở tầng này, bỏ qua 8.7 hoặc chạy lại tầng 4 để tạo run.)

### 8.8. Cancel idempotent và không replay execution

```bash
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" run cancel "$RUN_ID"
/tmp/raptix --server "$SERVER_URL" --token "$TOKEN" run cancel "$RUN_ID"
# → EXPECT: cả hai 200/cancelled; không tạo invocation/attempt mới
```

Checklist tầng 6:
- [ ] thiếu token exit=2
- [ ] sai URL exit=6
- [ ] UUID sai exit=2
- [ ] HTTP không token 401
- [ ] grant thiếu 403 (qua test Go hoặc bootstrap phụ)
- [ ] SSE cursor sai → snapshot
- [ ] evidence secret 403
- [ ] cancel idempotent

---

## 9. Tầng 7 — Kiểm tra DB sau workflow

Dùng biến `$RUN_ID` / `$AGENT_RUN_ID` / `$REPORT_ID` từ trên.

### 9.1. Run có scope (Phase 7A)

```bash
docker exec raptix-postgres psql -U raptix -d raptix -c \
"SELECT id, status, scope_id IS NOT NULL AS has_scope FROM runs WHERE id='${RUN_ID}';"
# → EXPECT: has_scope = t
```

### 9.2. Audit decisions

```bash
docker exec raptix-postgres psql -U raptix -d raptix -c \
"SELECT action, outcome, actor, correlation FROM audit_records
 WHERE correlation='${RUN_ID}' ORDER BY created_at;"
# → EXPECT: run.start (allowed), run.cancel (allowed, actor=$SUBJECT)
```

### 9.3. Report request + output artifact

```bash
docker exec raptix-postgres psql -U raptix -d raptix -c \
"SELECT status, output_artifact_id IS NOT NULL AS has_output, template_id, template_version
 FROM report_requests WHERE id='${REPORT_ID}';"
# → EXPECT: status completed, has_output = t, default / 1
```

### 9.4. River job đã chạy

```bash
docker exec raptix-postgres psql -U raptix -d raptix -c \
"SELECT kind, state, attempt, args->>'reportRequestId' AS report
 FROM river_job WHERE kind='report_render' ORDER BY created_at DESC LIMIT 5;"
# → EXPECT: 1 job cho report, state "completed", attempt >= 1
```

### 9.5. Finding revisions (Phase 8)

```bash
docker exec raptix-postgres psql -U raptix -d raptix -c \
"SELECT finding_id, revision_no, status, change_reason FROM finding_revisions
 WHERE finding_id='${FINDING_ID}' ORDER BY revision_no;"
# → EXPECT: revision tăng dần; status phản ánh review
```

### 9.6. Verdict bind revision

```bash
docker exec raptix-postgres psql -U raptix -d raptix -c \
"SELECT revision_no, verdict, produced_by, legacy FROM finding_verdicts
 WHERE finding_id='${FINDING_ID}' ORDER BY created_at;"
# → EXPECT: revision_no trỏ tới revision đã verify (legacy=false)
```

Checklist tầng 7:
- [ ] runs.scope_id not null
- [ ] audit run.start + run.cancel
- [ ] report completed + output
- [ ] river job completed
- [ ] finding_revisions đúng thứ tự
- [ ] verdict bind revision

---

## 10. Cleanup / reset

### 10.1. Dừng server
Ctrl-C ở terminal server (chờ log "http server stopped"; worker dừng trước khi đóng pool).

### 10.2. Xóa dữ liệu test theo project (cascade)

```bash
docker exec raptix-postgres psql -U raptix -d raptix -c \
"DELETE FROM projects WHERE id='${PROJECT_ID}';"
# → EXPECT: DELETE 1; runs/findings/revisions/report_requests cascade.
# Lưu ý: artifacts.run_id ON DELETE SET NULL nên metadata artifact còn lại; dọn thủ công nếu muốn:
docker exec raptix-postgres psql -U raptix -d raptix -c \
"DELETE FROM artifacts WHERE run_id IS NULL AND created_at > now() - interval '1 day';"
```

### 10.3. Dọn artifact trên đĩa (tùy chọn)

```bash
rm -rf "$ARTIFACT_ROOT"/sha256 "$ARTIFACT_ROOT"/pending 2>/dev/null || true
```

### 10.4. Dừng PostgreSQL (tùy chọn)

```bash
docker compose -f deploy/compose.yaml stop postgres
```

### 10.5. Reset hoàn toàn database dev (CẢNH BÁO: mất dữ liệu)

```bash
docker exec raptix-postgres psql -U raptix -d postgres -c "DROP DATABASE raptix;" -c "CREATE DATABASE raptix;"
cd "$REPO/backend" && RAP_DATABASE_URL="$DSN" $GO run ./cmd/migrate -config ../configs/app.yaml -dir migrations -command up
```

Checklist cleanup:
- [ ] server dừng sạch
- [ ] project test đã xóa
- [ ] (tùy chọn) artifact/db đã reset

---

## 11. Troubleshooting

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `content catalog disabled; root not present` | `content.root=./content` khi chạy từ `backend/` | `export RAP_CONTENT_ROOT="$REPO/content"` |
| `jobs worker did not start` / report mãi `queued` | River schema chưa migrate | `RAP_DATABASE_URL="$DSN" go run ./cmd/migrate ... up`; kiểm tra `\dt river_job` |
| Report `queued` không chuyển `rendering` | Server không chạy jobs / chỉ chạy migrate | Chạy `cmd/server`, xem log "jobs worker started" |
| `agent loop disabled: no model configured` | Không có `llm.api_key` | Thêm key hoặc dùng tầng 4 |
| Report template bị từ chối (`hash does not match`) | Sửa `body` mà chưa cập nhật `hash` | `python3 -c "import hashlib;print(hashlib.sha256(open('body.txt','rb').read()).hexdigest())"` rồi cập nhật `hash` |
| `403 forbidden` khi tạo run/report | thiếu grant hoặc `subject` khác `development_principal` | Chạy lại SQL 4.3 với đúng `$SUBJECT` |
| `401 unauthenticated` | OIDC mode đang bật nhưng không gửi token hợp lệ | Dùng `auth.mode=development` hoặc cấp Bearer JWT thật |
| Port 8080 bận | tiến trình khác chiếm | Dùng `:18080` (đã cấu hình) hoặc `RAP_SERVER_ADDR` |
| CLI exit=6 với mọi lệnh | sai `--server` hoặc server chưa chạy | `curl $SERVER_URL/healthz` |
| `go` là 1.22 | shell chưa source `~/.profile` | Gọi `~/go1.26/bin/go` hoặc `bash -lc` |

---

## 12. Checklist tổng (dùng để xác nhận "workflow tốt")

Automated:
- [ ] build/vet/staticcheck/sqlc/gofmt sạch
- [ ] `go test ./...` pass
- [ ] migrate `raptix_test` + integration Phase 3–8 pass
- [ ] `go test -race` pass
- [ ] `scripts/check.sh` OK

Manual (CLI + server):
- [ ] health 200
- [ ] bootstrap project/scope/grants đúng subject
- [ ] tạo run idempotent; conflict 409
- [ ] `run status/watch` hoạt động, stdout JSON sạch
- [ ] report create → watch → get --content ra Markdown
- [ ] report idempotent (1 run = 1 report)
- [ ] report snapshot bất biến sau khi revise finding
- [ ] `finding revisions/revise/review` hoạt động
- [ ] `run cancel` idempotent, không replay execution
- [ ] SSE cursor sai → snapshot
- [ ] evidence secret bị chặn 403
- [ ] DB: audit, report_requests completed, river_job completed, finding_revisions/verdict đúng

---

## 13. Tài liệu tham khảo

- Kế hoạch & quyết định: `docs/fixing.md`.
- Kiến trúc/ownership: `docs/repository_structure_v1.md`.
- Tiến độ migration: `docs/migration_manifest_v1.md`.
- Contract: `contracts/openapi.yaml`, `contracts/events/v1.schema.json`.
- Lệnh/phạm vi API: `internal/cli/commands.go`, `internal/api/router.go`.
- Endpoint Phase 8: `POST /api/v1/runs/{runId}/reports`, `GET /api/v1/reports/{reportId}[/content]`, `GET|POST /api/v1/findings/{findingId}/revisions`, `POST /api/v1/findings/{findingId}/reviews`.
