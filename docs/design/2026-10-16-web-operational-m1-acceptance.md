# Web operational M1 — acceptance ledger

**Ngày:** 2026-10-16 · **Branch:** `web-improve-refactor` · **Kết luận: M1 đạt** (điều kiện còn mở ghi ở §6)

## 1. Đối tượng nghiệm thu

M1 của [mock-to-operational plan](2026-10-16-web-mock-to-operational-system-implementation-plan.md):
luồng chính chạy thật qua browser — đăng nhập, chọn project, lập kế hoạch
(Soundwave), handoff, chạy execution với HITL, theo dõi tool logs bằng modal,
xử lý câu hỏi, Vault — không run trùng sau refresh, không fallback demo data.

## 2. Release identity

`apps/web/tools/capture-operational-release.mjs` ghi
`tests/local/artifacts/operational-m1/release.json`:

- `head`: `b4b4ce97025a…`, tree digest gộp toàn bộ source đã capture
  (apps/web, apps/shared, packages, plugins, infra/containers, compose,
  pyproject/uv.lock/langgraph.json, package manifests).
- `revision`: `b4b4ce97025a-tree-02306b7d6c55766a`.
- `images`: UI (`raptix-web-raptix-ui:stable`), API (`raptix-web-raptix-api:stable`),
  runtime (`raptix-langgraph:web-m1`) — cả ba image ID sha256 và
  `org.opencontainers.image.revision` label đều khớp revision trên.
  UI/API/runtime được rebuild sau commit cuối cùng của các fix, không còn image stale.

## 3. Kết quả acceptance từng pha (`verify-operational-m1.mjs`)

Evidence: `tests/local/artifacts/operational-m1/acceptance/` (state.json,
screenshots). Actor: owner đầy đủ quyền, reviewer chỉ đọc.

| Pha | Nội dung kiểm chứng chính | Kết quả |
|---|---|---|
| `--prepare` | 2 actor thật, membership reviewer read-only, deploy identity khớp | PASS |
| `--planning` | Soundwave bundle sẵn sàng, câu hỏi planner sống qua refresh, handoff một chiều | PASS |
| `--execution` | Handoff → tạo thread; scope approval và plan binding duyệt độc lập (self-approval 403, unbound 409); HITL bash request được allow; evidence bytes đọc được; đúng 1 run sau refresh; tool-event inspector là modal centered | PASS |
| `--vault` | Store 201 metadata-only; reveal/hide in-session; audit `vault.secret_created`/`vault.secret_revealed`; revoke 200 | PASS |

Điểm ngặt đã kiểm thêm: approval theo vai trò (reviewer không duyệt được),
binding theo kế hoạch đã duyệt, idempotence sau reload (1 run), HITL deny-by-timeout.

## 4. Bằng chứng lưu trữ (`verify-operational-storage.mjs`)

- **Round-trip 3 chiều** API ↔ runtime ↔ sandbox trên dedicated volume: 9/9
  (mỗi nguồn ghi, hai nơi còn lại đọc thấy; xoá sạch sau kiểm).
- **Backup/restore**: `pg_dump -Fc` + `tar` workspace (scope
  `WORKSPACE_PATH/<slug>` — dedicated volume, tránh host bind của CLI stack
  đang có run ghi đồng thời) → restore vào DB test:
  1. Migration ledger khớp nguồn;
  2. Probe secret mã hoá bằng key sống trong API container, nằm trong dump,
     giải mã bằng **chỉ** file key đã backup (AES-256-GCM auth pass);
  3. Restore workspace archive tái tạo đúng manifest
     (path+size, sha256 digest) của workspace sống.

Evidence JSON lưu kèm từng lần chạy trong `tests/local/artifacts/operational-m1/backup-restore-*/`.

## 5. Blocker O01–O03 đã khép

| Blocker | Fix | Kiểm chứng |
|---|---|---|
| O01 mock-only UX | Tách Execution surface, modal inspector, Vault mock tab (`2012e69`); real trace + checkpoint history | Acceptance pha execution; `operations-panel.test.tsx` |
| O02 storage/runtime | Dedicated web runtime plane + slug + persistent volumes; workspace roundtrip; backup/restore | §4; ADR-0082; compose test |
| O03 cross-actor state | SSE re-attestation deadline; per-actor QueryClient; recovery key v2 scoped deployment/actor/engagement; deploymentId | Busy-stream test; login/workspace session tests; deployed probe |

## 6. Điều kiện còn mở (không chặn M1)

- **Per-subagent messaging/control** chưa có contract — observation-only,
  thuộc O08–O09/M2 (ADR-0080 ghi rõ giới hạn attribution).
- **C2** `provider_unavailable` (O12) — ngoài phạm vi M1.
- **PR budget**: thay đổi trải nhiều file (compose + server + web + python
  middleware) vượt khung ≤10 files/1 concern của
  `CONTRIBUTING_AGENT.md`; cần tách theo concern khi mở PR
  (web runtime plane / session-recovery / checkpoint history / HITL).
- Ảnh runtime/API chứa `hitl.py` mới; các deployment sau rebuild sẽ tự mang
  revision label mới nhờ `SOURCE_REVISION` build arg.
- **Full mock suite (ngoài phạm vi)**: một số test mock (evidence, notices,
  analysis, grants, c2, …) đỏ khi chạy full suite trên Windows — file test và
  component liên quan byte-identical với base, pass khi chạy riêng, số file đỏ
  dao động giữa các lần chạy (navigate/DETAIL_MAP + load sensitivity, tiền
  tồn tại từ `eba1b08`); không nằm trong phạm vi M1 real-mode và không bị
  chạm tới bởi các commit của workstream này (chỉ `src/real/**`).
