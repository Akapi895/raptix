# WS-3 · Infrastructure và C2 (Trạng thái: PARTIAL; phần ghi BLOCKED)

UX-ID: UX-11.

## Lý do dừng phần lớn

- ADR-0095 (PTY console), ADR-0098 (controller lease), ADR-0099 (dispatch qua ledger) đang Proposed. Các file này có thay đổi chưa commit của owner, nên không được coi là đã duyệt (BL-02).
- Plan 03 yêu cầu xác nhận ADR trước khi đổi ownership và alias c2-*. Không thực hiện khi chưa có quyết định (D-03 chờ chủ sản phẩm).
- Không chạy lệnh C2 thật, không listener thật, không Emergency Stop thật (ràng buộc của prompt).

## Đã kiểm trên mã (không đổi code trong vòng này)

- Route `c2`, `c2-channel`, `c2-session`, `c2-console` tồn tại trong `router/routes.ts` và resolve trong route smoke mock (56/56 cả hai cờ). Phần real: NV.
- `c2-session` và `c2-channel` có nhánh render riêng (`features/c2/provider-tab.tsx`). `c2-console` đi vào màn console hiện có.
- Infrastructure toàn cục (`overview/views/global-resource.tsx`): chỉ có tab, rollup C2 chỉ đọc, và nút "Open project" (điều hướng). Không có nút ghi (A8 đạt theo mã; chưa kiểm trên trình duyệt real).
- Infrastructure real (`features/infrastructure/views/real-infrastructure.tsx`): không chọn engagement thì chỉ hiện "Select an engagement". Các thao tác ghi nằm trong panel theo engagement.

## Chưa làm

- `features/c2/workspace/` (C2Workspace một entry, `view`/`selection`): chưa làm. Cần ADR và D-03.
- Hợp nhất route c2-* thành một presentation: chưa làm. Giữ nguyên mọi địa chỉ cũ (không đổi).
- Ownership bảng (Provider, Listener, Profile, Session, Access, Command ledger, Runtime agent, Campaign): chưa có tài liệu xác nhận; xem structural-plan/03.
- Trạng thái access (approved/revoked/expired) và command (`uncertain` không phải `succeeded`): đã có trong code C2 hiện tại; chưa thêm kiểm mới.

## Rủi ro

- Nếu làm C2Workspace trước khi có ADR, sẽ phải đảo ngược khi ADR đổi ownership. Đây là lý do dừng.

## Bước tiếp theo đề xuất

1. Chủ sản phẩm chốt D-03 (Infrastructure có chứa Runtime agents và Campaigns không).
2. Owner đưa ADR-0095/0098/0099 vào trạng thái đã duyệt hoặc đã từ chối; sau đó mới làm `features/c2/workspace/`.
3. Kiểm trình duyệt với stack có provider C2 giả (503 và trạng thái active/inactive).
