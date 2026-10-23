# Web UX & Product Audit — Raptix Web (`apps/web`), 2026-10-23

Bộ tài liệu audit để một reviewer độc lập đọc và đánh giá lại. Mọi kết luận có nhãn bằng chứng; mục nào chưa kiểm được được ghi rõ trong `06`.

## Thứ tự đọc

1. `01-full-audit-report.md` — 27 phát hiện (UX-01 → UX-27), bằng chứng, ưu tiên, giải pháp.
2. `02-feature-inventory.md` — 55 route key, mục điều hướng, 35 feature, ứng viên trùng lặp.
3. `03-optimization-matrix.md` — KEEP / IMPROVE / MERGE / REMOVE / ADD với lý do.
4. `04-implementation-roadmap.md` — Quick Wins, Structural, Long-term.
5. `05-evidence.md` — ảnh chụp (thư mục `evidence/`), môi trường quan sát, đường dẫn source.
6. `06-verification-gaps.md` — chưa kiểm được gì, vì sao, và cách đóng khoảng trống.
7. `07-acceptance-closure.md` — đối chiếu UX-01 đến UX-27 và S-01 đến S-08 với nhãn CLOSED, PARTIAL, OPEN, NV.

Kế hoạch Structural (chỉ tài liệu, chưa có code) nằm ở `structural-plan/` (00 đến 06).

## Nhãn bằng chứng

| Nhãn | Nghĩa |
|---|---|
| `[B]` | Đã quan sát trong trình duyệt (Chromium, Playwright) trên build production local, mock mode, đúng viewport ghi trong `05`. |
| `[C]` | Xác nhận bằng đọc source, import graph hoặc tính toán từ token. Chưa chạy trong trình duyệt ở mode đó. |
| `[NV]` | NOT VERIFIED. Không kiểm được trong phạm vi này; lý do ở `06`. |

## Mức ưu tiên và độ phức tạp

- **P0**: rủi ro an toàn hoặc mất dữ liệu. Không có P0 đã xác minh.
- **P1**: làm sai lệch nhận thức về trạng thái thật của hệ thống, hoặc lộ nội dung demo trong real.
- **P2**: làm người dùng hiểu sai, hoặc tăng ma sát đáng kể.
- **P3**: thẩm mỹ, copy, hoặc nhất quán nhỏ.
- **S** ≤ 1 ngày; **M** vài ngày; **L** > 1 tuần hoặc cần contract mới.

## Phạm vi và giới hạn chính

- Đánh giá mock mode trong trình duyệt là chính. Real mode chỉ kiểm bằng source và trạng thái outage, vì không có backend.
- Không chỉnh sửa code trong giai đoạn audit. Các thay đổi quick win được ghi riêng trong `QUICK-WINS-IMPLEMENTATION-REPORT.md` (cùng thư mục).
- Checklist owner (`docs/web-ui-completion-checklist-2026-10-22.md`) được đối chiếu, không coi là đúng sẵn. Một số mục sai được nêu trong `06` (mục 6).

## Tái lập

- Build: `apps/web`, `vite build --outDir <thư mục ngoài repo>`.
- Phục vụ tĩnh và chụp bằng Playwright từ `node_modules` của repo.
- Dev server của owner trên cổng 5273 có thể trả 504 "Outdated Optimize Dep" cho route lazy; đây là trạng thái cache của dev server, không phải lỗi sản phẩm. Khởi động lại với `--force` nếu gặp.
- Route smoke theo cờ: `RAPTIX_VERIFY_APP=<url> RAPTIX_VERIFY_FLAGS=<prototype,assetMap | rỗng> node tools/verify/route-smoke.mjs --modes mock`. Real mode cần stack: `tools/verify/stack.mjs`.

## Sau audit: triển khai Quick Win

- `QUICK-WINS-IMPLEMENTATION-REPORT.md` — UX-ID đã xử lý, file thay đổi, commit, kết quả test/build/Playwright, ảnh before/after, vấn đề còn lại, đề xuất structural.
- `evidence/A*.png` — ảnh sau khi sửa; cặp với `evidence/B*.png` (trước).
- Đính chính: `01-full-audit-report.md` (đầu tài liệu) sửa hai điểm: header demo chỉ ở mock; UX-03 không phải lỗi real.

## Gói chia sẻ

`docs/audits/web-ux-audit-2026-10-23.zip` chứa toàn bộ thư mục này, gồm báo cáo Quick Win và ảnh sau khi sửa. Zip không được commit vào git.

## Vòng ổn định và xác minh (2026-10-23, vòng 2)

- `verification/VERIFICATION-STABILIZATION-2026-10-23.md` — gate tại HEAD `0c25420f`, route smoke theo cờ, thông báo kỹ thuật, dark mode, sidebar mobile, đăng nhập mock, real mode trên stack có backend.
- `verification/results/` — JSON và log của các lần chạy (smoke, real-mode, mobile và đăng nhập, thông điệp lỗi, typecheck, lint, boundary, build, test).
- `checklist-snapshot/` — bản snapshot của checklist owner (file gốc là untracked trong git).
- `evidence/A09`–`A13`, `R01`–`R05`, `R-E1`/`R-E3` — ảnh sau vòng này; `A09`–`A11` có cặp trước/sau.

## Vòng nghiệm thu cuối (2026-10-23, vòng 3)

- `verification/VERIFICATION-STABILIZATION-2026-10-23.md` mục 9: gate tại HEAD `56a29e1a`, route smoke, real mode và outage production.
- `verification/results/final-acceptance/`: exit code, log và JSON của lần chạy cuối.
- `structural-plan/`: kế hoạch Structural WS-0 đến WS-4 và quyết định D-01 đến D-06 chờ reviewer. Không có code.
- `evidence/A14`, `P1`, `P2`: ảnh sau thay đổi identity Settings và outage production.
