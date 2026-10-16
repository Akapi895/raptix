# Web UI Completion — Draft planning package

**Ngày:** 2026-10-13. **Trạng thái:** draft for review; plan-only, chưa triển khai hoặc publish tracker.

## Đọc theo thứ tự

1. [SPEC — đặc tả sản phẩm](SPEC.md): 56 user stories, scope, architectural/implementation decisions và test seams.
2. [IMPLEMENTATION PLAN](IMPLEMENTATION-PLAN.md): baseline, 13-page coverage, 5 milestones, priorities, 52-ticket dependency table, execution waves, decision register và Definition of Done.
3. [TEST PLAN](TEST-PLAN.md): 6 verification lanes, 20 live acceptance procedures, prerequisites, existing commands, expected outcomes và required evidence.
4. [Ticket index](tickets/README.md): một file riêng cho mỗi vertical slice, với steps/blockers/acceptance/test/evidence.

## Scope cần duyệt

- **LOCAL-FULL:** full 13-page single-user workflows. Campaigns/C2 giữ supported native provider scope; config và nghiệp vụ qua Web sau bootstrap.
- **HITL-ON:** completion/evidence riêng cho producer thật; không đổi ngầm default OFF.
- **TEAM-HOSTED:** plan bao quát auth/RBAC/crash durability nhưng implementation cần explicit scope activation, vì quyết định trước đây giữ single-user.

## Publish workflow

Hai skill `to-spec` và `to-tickets` đã được dùng để soạn bộ draft này. Không tìm thấy tracker/triage configuration. Chạy `/setup-matt-pocock-skills` trước publish, rồi duyệt:

1. Test seams: actual browser stack và scoped API fault/concurrency boundary.
2. Granularity: 52 slices có quá thô/quá nhỏ; slice vượt PR budget phải chia trước code.
3. Blocking edges và team/hosted scope activation.

Sau duyệt mới publish spec + từng ticket vào tracker và apply `ready-for-agent`; draft hiện tại không phải authorization triển khai. Nếu tracker được chọn là local files, publish approved tickets theo layout của skill; nếu tracker remote, dùng native blocking edges/sub-issues khi hỗ trợ. Không close/modify parent issue ngoài ý định đã duyệt.

## Tình trạng kiểm chứng

- Những mô tả “đã có” dựa trên khảo sát code/ADR/manifests và observations từ cuộc hội thoại.
- Commands/live gates trong TEST PLAN là **kế hoạch phải chạy ở phase implementation/acceptance**, không phải kết quả test của phiên viết tài liệu này.
- Runtime working-tree changes và tài liệu nghiên cứu workstream khác được giữ nguyên; bộ planning này không sửa code/schema/fixtures/deployment.
