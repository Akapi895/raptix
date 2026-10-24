# RESUME · Structural (vòng 5, đã đóng)

Đọc file này trước khi làm tiếp. Không cần phân tích lại dự án.

## Mốc

- Vòng 4 (đóng trước): `d67d2665` → `ffe85384`; tài liệu `692577a5`.
- Vòng 5: mã sản phẩm cuối đã kiểm: `67ddf571`. Commit mới sau đó: `bfa26841` (harness route smoke) và commit tài liệu cuối của vòng (xem `git log`).
- Gate cuối đã chạy trên `67ddf571`: xem `VERIFICATION-LOG.md` (mục "Vòng 5"). Báo cáo đóng: `FINAL-STRUCTURAL-CLOSURE.md`.

## Trạng thái

| Việc | Trạng thái |
|---|---|
| P0.1 Dark mode (bằng chứng) | VERIFIED |
| P0.2 Canary actor | VERIFIED 10/10 trên stack cô lập; draft/thread NV |
| P0.3 Real regression | VERIFIED một phần (smoke real 0 mới; Team real); Overview/drawer/tablet real NV |
| P1 WS-2 | PARTIAL: team tab và giới hạn theo loại đã làm; closure/library trong aggregate BL-03 |
| P2 WS-4B | VERIFIED (mock); severity thành disclosure |
| P3 WS-3 | PARTIAL: resolver C2, thông báo console, ownership doc; thực thi BLOCKED (BL-02) |
| P4 follow-up | GLOBAL-1, UX-15 (một phần), UX-18, UX-20, UX-25, FLAKY-1 đã làm; MOCK-1 giữ có chủ đích |

## Trạng thái worktree

- Thay đổi của owner còn nguyên, không stage, không commit: `GLOSSARY.md`, `docs/adr/0095`, `0098`, `0099`, `docs/design/2026-10-23-c2-pty-console-proposal.md`, các untracked `apps/web/.scratch/web-real-ui/`, `docs/adr/0097-…`, `docs/web-real-ui-*.md`, `docs/web-ui-completion-checklist-2026-10-22.md`, `docs/runtime-prelab-readiness-2026-10-22.md`, `infra-test.log`, `now.txt`, `report-do-an/`, `report-vdt/`, `web-sandboxes/`.
- Thuộc phiên trước (do tôi tạo, chưa commit, cần quyết định): `evidence/R03-real-settings-after.png` (đã sửa), `evidence/R03-real-settings-before-identity-fix.png`, `docs/audits/web-ux-audit-2026-10-23.zip` (gói, không commit).
- Không do phiên này tạo, giữ nguyên: `docs/audits/web-ux-audit-2026-10-23/structural-execution.zip`.
- Ngoài repo: `scratchpad/` (build, smoke, ảnh tạm). Các file `hold.json` chứa credential đã được xóa.

## Việc còn lại

1. Người dùng: quyết định redeploy 3001 (DEP-1). Container đang chạy `d3225f63`.
2. Người dùng: xóa hai file tạm `D:\Program Files\Git\final-smoke-optin.log` và `final-optin-exit.txt` (CLEAN-1).
3. Owner: duyệt hoặc từ chối ADR-0095, 0098, 0099 và chốt D-03 (BL-02).
4. Server: aggregate `/api/tasks` bổ sung closure và library, có đánh giá phân quyền (BL-03).
5. Server: thời điểm nguồn theo từng số đếm (PROV-1).
6. NV: smoke Overview real, drawer mobile real, tablet real, draft chat với runtime.

## Lệnh an toàn để tiếp tục

```
cd D:/.VTNet/redteam/raptix/apps/web
npx tsc --noEmit -p tsconfig.json
npx eslint <file đã đổi>
npx vitest run <thư mục liên quan>
node tools/check-boundaries.mjs --strict
cd server && npx vitest run --config vitest.config.ts tests/t15-inbox.test.ts
```

Build thử (không ghi `apps/web/dist`):

```
npx vite build --outDir <scratchpad>/build-default --emptyOutDir
VITE_PROTOTYPE_PAGES=true VITE_ASSET_MAP=1 npx vite build --outDir <scratchpad>/build-optin --emptyOutDir
```

Smoke mock (server tĩnh trong scratchpad, cổng riêng, không dùng 3001 hay 5273):

```
cd D:/.VTNet/redteam/raptix
RAPTIX_VERIFY_APP=http://127.0.0.1:<port> RAPTIX_VERIFY_FLAGS= node apps/web/tools/verify/route-smoke.mjs --modes mock --out <file>
```

Stack cô lập cho canary và smoke real: `apps/web/tools/verify/stack.mjs` (tự dọn container và tiến trình con). Để giữ stack sống, dùng bản sinh từ `verify-scripts/` theo cách đã ghi trong `WS-0-CANARY-REPORT.md`. Không ghi credential vào repo.

## Quyết định đã áp dụng

D-01 (nhãn "C2 Sessions"; tab id giữ), D-02 (tool approval ngoài số đếm; stop là Attention), D-04 (4 measure + Attention), D-05 (không đổi production), D-06 (mật khẩu demo không trong lỗi). Chi tiết: `DECISION-LOG.md` (DL-01 đến DL-21).

## Không làm (ràng buộc)

- Không đổi authentication, authorization, runtime; không endpoint ghi mới.
- Không chạy lệnh C2 thật, listener, Emergency Stop, payload.
- Không deploy 3001; không dùng 5273 hay 3001 để test; không sửa container của owner.
- Không stage thay đổi của owner; không sửa `GLOSSARY.md`; không nâng ADR Proposed.
- Không thêm `Co-Authored-By` (CLAUDE.md của repo cấm).
