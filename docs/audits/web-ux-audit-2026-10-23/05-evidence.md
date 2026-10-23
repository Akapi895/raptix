# 05 · Evidence

## 1. Môi trường quan sát

- Working tree `frontend` tại thời điểm audit; `git status` gồm các thay đổi chưa commit của owner (GLOSSARY, ADR, checklist và thư mục untracked). Không có thay đổi nào của audit trong source.
- Build: `vite build` của working tree, ghi ra thư mục scratchpad (không ghi đè `apps/web/dist`). Build production, mock mode mặc định.
- Phục vụ tĩnh bằng một server Node nhỏ trên `127.0.0.1` trong scratchpad; server đã được dừng sau mỗi đợt.
- Trình duyệt: Chromium có sẵn trong `node_modules` của repo (Playwright). Không cài dependency.
- Viewport: desktop 1440×900, tablet 834×1112, mobile 390×844 (touch). Light và dark.
- Dev server đang chạy của owner (cổng 5273, PID 26028) không được dùng để chụp: trả `504 Outdated Optimize Dep` cho route lazy (Projects, project detail). Không khởi động lại server đó.

## 2. Ảnh chụp (thư mục `evidence/`)

| File | Nội dung | Chứng minh | Nhãn |
|---|---|---|---|
| `B01-desk-overview-before.png` | Overview toàn cục, mock | 4 KPI; "Active operations — Not recorded"; "1 decision await your review."; nhãn "All Projects · aggregate view" | [B] |
| `B02-desk-project-overview-before.png` | Project Overview RT-2026-014 | "Running Operations 1" (đối chiếu B01); mật độ; Emergency Stop màu đỏ | [B] |
| `B03-desk-ai-workspace-before.png` | AI Workspace (desktop) | Vòng đời tool call; "Needs you (2)"; "MOCK · SIMULATED" | [B] |
| `B04-desk-findings-in-project-before.png` | `#/findings` trong project | Bố cục KPI + card (khác tab Findings của project) | [B] |
| `B05-desk-findings-all-projects-before.png` | Findings All Projects | Danh sách xuyên dự án, bộ lọc project | [B] |
| `B06-desk-dark-demo-tools-menu-before.png` | Menu profile, dark | Khối Demo Tools hiển thị trong build production mock; chữ "Prototype only, hidden in production." | [B] |
| `B07-desk-projects-before.png` | Projects | Cột TARGET/METADATA "—"; KPI Metadata to review = 0; chip "active 2" vs KPI "Active 3" | [B] |
| `B08-mobile-390-nav-drawer-before.png` | Drawer mobile | 7 mục global; không thấy nút đóng rõ ràng | [B] |
| `B09-tablet-834-ai-workspace-before.png` | AI Workspace tablet | Panel agent gập thành toggle; Ask AI còn icon | [B] |
| `B10-real-mode-no-backend-outage-before.png` | `?dataMode=real`, không backend | "Cannot reach the Raptix API"; lệnh `npm run dev:api`; nút "Switch to demo mode" | [B] (build production, không backend) |
| `B11-mock-emergency-stop-dialog.png` | Dialog Emergency Stop (mở rồi hủy) | Scope, impact, lý do, checkbox; không xác nhận | [B] |
| `B12-desk-prototype-home-scenarios-before.png` | `#/scenarios` | "Prototype Home" trong build | [B] |
| `B13-desk-states-gallery-before.png` | `#/states` | "Universal state set" | [B] |
| `B14-desk-c2-redirects-to-infrastructure.png` | `#/c2` | Chuyển sang Infrastructure (alias) | [B] |

Ảnh sau khi sửa (quick win) nằm trong `evidence/` với tiền tố `A` và được liệt kê trong `QUICK-WINS-IMPLEMENTATION-REPORT.md`.

## 3. Quan sát bổ sung (không có ảnh riêng)

- Đăng nhập mock: "Continue" với thông tin điền sẵn không phản hồi (hai lần thử). Chip persona "Alex Morgan" đăng nhập được và vào "System Overview" (`[B]`).
- Số mục sidebar dự án mock: 14, đếm từ DOM gồm các mục điều hướng (không tính nút "All projects", khối tên project và nút Collapse).
- Emergency Stop dialog: nút "Escape" đóng dialog (`[B]`).
- Không có tràn ngang trên 12 trang mobile và 5 trang tablet đã đo (`[B]`).
- Không có button không tên hoặc input không nhãn trên 12 trang mobile đã đo (kiểm tự động, `[B]`).
- Số liệu contrast (`[C]`, tính từ token): xem báo cáo 01, UX-19.

## 4. Tham chiếu source (đường dẫn trong repo, từ gốc `D:/.VTNet/redteam/raptix`)

| Nội dung | Đường dẫn |
|---|---|
| Route inventory | `apps/web/src/router/routes.ts` |
| Registry và slice | `apps/web/src/router/registry.tsx` |
| Điều hướng | `apps/web/src/shell/nav.ts` |
| Header, Demo Tools, Ask AI, chuông | `apps/web/src/shell/header.tsx` |
| Sidebar | `apps/web/src/shell/sidebar.tsx` |
| Outage và bootstrap real | `apps/web/src/shell/real-bootstrap.tsx` |
| Panel "Not connected" | `apps/web/src/shell/not-integrated.tsx` |
| Menu tài khoản real | `apps/web/src/shell/real-chrome.tsx` |
| Settings | `apps/web/src/features/settings/views/settings-page.tsx` |
| Overview | `apps/web/src/features/overview/views/overview-page.tsx`, `overview-blocks.tsx` |
| Projects | `apps/web/src/features/projects/views/portfolio-page.tsx` |
| Capabilities (copy Library) | `apps/web/src/features/capabilities/views/capabilities-pages.tsx` |
| Emergency Stop | `apps/web/src/shell/context-ribbon.tsx`, `apps/web/src/features/estop/ui.tsx` |
| Mode dữ liệu | `apps/web/src/state/mode.ts`, `apps/web/src/state/services.tsx` |
| Demo runtime | `apps/web/src/demo/runtime.ts` |
| Token màu | `apps/web/src/index.css` |
| Helper contrast | `apps/web/tools/verify/contrast.mjs` |
| Checklist owner | `docs/web-ui-completion-checklist-2026-10-22.md` (untracked) |
| Scripts | `apps/web/package.json` |

## 5. Tham chiếu ngoài

- `AGENTS.md` và `CLAUDE.md` của `apps/web` (quy ước, gate, ADR-0068 về real mode, ADR-0096 về cấu trúc feature).
- WCAG 2.2 AA cho tỉ lệ tương phản 4.5:1 với chữ thường.
