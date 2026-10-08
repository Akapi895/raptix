# Decision 0002 — Brand token

- Ngày: 2026-10-01
- Phase: P0 (W00)
- Trạng thái: Accepted

## Bối cảnh

Design brief (`src/imports/pasted_text/raptix-dashboard-design.md`) nêu brand `#EE0033`, nhưng bản light UI đã render hoàn thiện trong code dùng `#DC2626` (`--color-brand` trong `index.css`, Sidebar/Header/user avatar). Riêng `HitlModal` (dark theme) dùng `#EE0033` với hover `#CC002B`.

## Quyết định

- **Light UI (app shell):** giữ `#DC2626` làm brand chính theo bản render người dùng đã hoàn thiện. Plan mục tiêu không phải thiết kế lại trải nghiệm.
- **Dark HITL modal:** giữ palette dark riêng (`#121821`/`#273142`/`#EE0033`) như một "alarm surface" có chủ đích — modal HITL là critical-risk surface, khác biệt về màu là hành vi thiết kế, không phải inconsistency cần thống nhất.
- Tokens được centralize vào `styles/tokens.css` ở Phase 2: `--color-brand` (light) và `--color-danger-strong` (`#EE0033`, HITL/danger emphasis).

## Hệ quả

- P2.5 thay inline color bằng tokens nhưng không đổi giá trị màu đang render.
- Không "đồng bộ" `#EE0033` → `#DC2626` trong HitlModal khi refactor.
