# RESUME · Structural (vòng 4)

Đọc file này trước khi làm tiếp. Không cần phân tích lại dự án.

## Mốc

- Base commit (tài liệu audit): `d3225f63`.
- Mã sản phẩm cuối đã kiểm: `ffe85384` (gate đầy đủ đã chạy trên đây).
- Commit mới của vòng này (theo thứ tự): `d67d2665` (WS-0), `b9d28f3c` (WS-1), `349bcbc5` (WS-4A), `76826809` (WS-2 server), `b3195015` (WS-2 client), `837e1d9d` (WS-4B), `304df2e8` (ảnh WS-4B), `ffe85384` (S-03).

## Trạng thái workstream

| WS | Trạng thái | Ghi chú |
|---|---|---|
| WS-0 | IMPLEMENTED | Canary trình duyệt BLOCKED (BL-01) |
| WS-1 | VERIFIED (mock) | Real smoke NV |
| WS-4A | VERIFIED (mock) | Provenance asOf chưa có nguồn (PROV-1) |
| WS-2 | PARTIAL | Team tab (TEAM-1), closure/library (BL-03) |
| WS-4B | VERIFIED (mock) | Ảnh trong evidence |
| WS-3 | PARTIAL (BLOCKED một phần) | ADR chờ (BL-02) |

## Trạng thái worktree

- Working tree của owner còn nguyên. Không stage, không commit, không đụng: `GLOSSARY.md`, `docs/adr/0095`, `0098`, `0099`, `docs/design/2026-10-23-c2-pty-console-proposal.md`, và các untracked gồm `apps/web/.scratch/web-real-ui/`, `docs/adr/0097-…`, `docs/web-real-ui-*.md`, `docs/web-ui-completion-checklist-2026-10-22.md`, `docs/runtime-prelab-readiness-2026-10-22.md`, `infra-test.log`, `now.txt`, `report-do-an/`, `report-vdt/`, `web-sandboxes/`, `docs/audits/web-ux-audit-2026-10-23.zip`.
- Thuộc phiên trước (do tôi tạo, chưa commit, cần quyết định): `docs/audits/web-ux-audit-2026-10-23/evidence/R03-real-settings-after.png` (sửa lại), `evidence/R03-real-settings-before-identity-fix.png` (mới), và `docs/audits/web-ux-audit-2026-10-23.zip` (gói cũ, sẽ tạo lại).
- Thư mục `structural-execution/` của vòng này: đã commit ở commit tài liệu cuối (xem git log).
- Ngoài repo: `scratchpad/ws1/` (build, smoke, ảnh tạm). Không chứa credential.

## Việc tiếp theo (theo thứ tự ưu tiên)

1. Người dùng: chốt DEP-1 (redeploy 3001 hay không) và xóa CLEAN-1 (hai file tạm trong `D:\Program Files\Git\`).
2. Chạy real route smoke và canary khi có stack (NV-1, BL-01).
3. WS-2: làm rõ tab Team & Approvals (TEAM-1), sau khi chủ sản phẩm xác nhận nội dung.
4. WS-3: chờ D-03 và quyết định ADR-0095/0098/0099 (BL-02). Sau đó làm `features/c2/workspace/`.
5. Follow-up nhỏ mục 11 (UX-15, 18, 20, 25) kèm kiểm trình duyệt từng mục.

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

Route smoke mock (server tĩnh trong scratchpad, cổng riêng, không dùng 5273):

```
RAPTIX_VERIFY_APP=http://127.0.0.1:<port> RAPTIX_VERIFY_FLAGS= node apps/web/tools/verify/route-smoke.mjs --modes mock --out <file>
```

Chạy từ thư mục gốc repo, đường dẫn tới `apps/web/tools/verify/route-smoke.mjs`.

## Quyết định đã áp dụng

D-01 (thuật ngữ: "C2 Sessions"; tab id giữ nguyên), D-02 (A: tool approval ngoài số đếm; stop là Attention), D-04 (4 measure + Attention), D-06 (mật khẩu demo không trong lỗi). D-03 và D-05 chưa đổi code (D-05: quick win trước đã gate theo mode). Chi tiết: `DECISION-LOG.md`.

## Không làm (ràng buộc)

- Không đổi authentication, authorization, hay contract ngoài trường `limited` (tương thích).
- Không chạy lệnh C2 thật, không listener, không Emergency Stop, không payload.
- Không đụng dev server 5273 của owner; không `npm run build` ghi vào `apps/web/dist`.
- Không deploy, không đổi container hay image trong vòng này.
- Không sửa `GLOSSARY.md`; không nâng ADR Proposed.
- Không thêm `Co-Authored-By` (CLAUDE.md của repo cấm).
- Không tạo tài khoản trên 3001; không ghi credential vào repo.
