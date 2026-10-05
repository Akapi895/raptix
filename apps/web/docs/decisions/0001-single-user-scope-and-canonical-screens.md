# Decision 0001 — Single-user scope và canonical screens

- Ngày: 2026-10-01
- Phase: P0 (W00)
- Trạng thái: Accepted

## Bối cảnh

`clients/web-raptix` là bản thiết kế Figma Make export với 23 screens, nhiều screens chỉ là mock/demo, một số không được mount. Backend `clients/web` chỉ hỗ trợ single-user (`requireAuth()` → `{ userId: "local" }`), chưa có Members/RBAC/Vault models.

## Quyết định

1. **Scope release:** single-user hoàn chỉnh (project → planning → run → outcomes → report). Members/RBAC và Credentials Vault **deferred** vào backlog; không mount như capability active trong navigation single-user; không dùng dữ liệu members giả trong real mode.
2. **Canonical screens:**
   - Project list: `Home` (Home mode) là canonical; `ProjectList` chỉ design-ref.
   - Chat/run: `AgentRun` là canonical; `Chat` chỉ design-ref.
   - Console: `OperatorConsole`.
   - Assets/environment: `InfrastructureData` tách theo feature; `Assets`/`Credentials` chỉ design-ref.
   - `Orchestrator`, `Phases` không mount; xem xét đưa vào Agent inspection/OPPLAN view ở P2+ nếu navigation đích cần.
3. **Vector Campaigns, C2 & Sessions:** không phải capability real trong release này (chưa có backend contract). Không giữ badge "3 Live" hardcode trong real mode.
4. **Screens không mount** (`Chat`, `Orchestrator`, `Phases`, `ProjectList`, `Assets`, `Credentials`) không xóa ở Phase 0/1 — chỉ loại bỏ sau khi feature refactor có canonical thay thế và inventory đối chiếu.
5. **Visual baseline:** brand light UI `#DC2626` theo code đã render hoàn thiện (decision 0002 cho brand HITL dark); screenshot capture bổ sung sau P1.

## Hệ quả

- Phase 2 refactor giữ 23 nguồn design nhưng chỉ 16 route active trong shell single-user.
- NewProjectModal cần giảm form fields về contract backend thật (`name/slug`, `targetType` ∈ {web_url, ip_range}, `targetValue`, authorization confirmation) khi vào P5.
- `myRole`, `members`, counters hardcode bị loại khỏi ProjectViewModel real mode (derive từ source có thật hoặc null).
