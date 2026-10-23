# Structural Improvements — Thiết kế để duyệt (Phase B)

Trạng thái: **chỉ lập kế hoạch, chưa có code**. Mục tiêu: reviewer duyệt thiết kế trước khi sửa mã. Mọi con số và đường dẫn đều đối chiếu với mã nguồn tại HEAD `56a29e1a` (mã) và các tài liệu kiểm toán trong `docs/audits/web-ux-audit-2026-10-23/`.

## Phạm vi

| Mã | Workstream | UX-ID | Tài liệu |
|---|---|---|---|
| WS-1 | Chuẩn hóa navigation giữa mock và real | UX-06, UX-07 (một phần), UX-14 (thuật ngữ) | `01-ws-navigation.md` |
| WS-2 | Thống nhất Decisions, Approvals và Notifications | UX-08, UX-09 (một phần) | `02-ws-decisions.md` |
| WS-3 | Làm rõ Infrastructure, Sessions và C2 | UX-11 | `03-ws-infrastructure-c2.md` |
| WS-4 | Chuẩn hóa KPI, data provenance và giảm mật độ Overview | UX-12, UX-16 | `04-ws-overview-kpi.md` |

Ngoài bốn workstream, Phase A phát hiện thêm một **điều kiện tiên quyết (WS-0)**: query key và key lưu trữ dùng hằng số `local` thay vì actor. Xem `06-sequencing-risks-acceptance.md`, mục 1.

Từ vựng dùng chung đề xuất (không sửa `GLOSSARY.md`): `05-terminology.md`.

## Phương pháp

- Skill `codebase-design`: mỗi workstream được mô tả bằng một **module sâu** (interface nhỏ, nhiều hành vi phía sau), có vị trí **seam** rõ, và được kiểm bằng **deletion test**: xóa module thì độ phức tạp có quay lại ở N nơi gọi hay không.
- Skill `domain-modeling`: các thuật ngữ xung đột được gọi tên (Approval, Session, Channel, Infrastructure), từ vựng đề xuất được ghi riêng, và chỉ đề xuất ADR khi quyết định khó đảo ngược, gây bất ngờ và là kết quả của một đánh đổi thật.
- Không dùng sub-agent (`design-it-twice`) vì người dùng không yêu cầu. Nếu reviewer muốn so sánh nhiều giao diện cho WS-3, có thể bổ sung sau.

## Tóm tắt từng workstream

| Mã | Module sâu đề xuất | Lớp sở hữu | Rủi ro | Kích thước | Phụ thuộc |
|---|---|---|---|---|---|
| WS-0 | `ActorScope`: một nguồn key theo actor cho mọi query và storage real | platform, state | Cao (bảo mật) | S–M | Không |
| WS-1 | `ProjectNavigation`: một bảng mục theo mode, khai báo khả dụng, tab chính tắc | shell, router | Trung bình | M | Quyết định nhãn (D-01) |
| WS-2 | `DecisionInbox`: một read model cho mọi quyết định cần người dùng, ghi vẫn theo miền | features/tasks, server inbox | Cao (contract server, phân quyền) | L | Quyết định phạm vi tool approval (D-03) |
| WS-3 | `C2Workspace`: một nơi sở hữu listener, session, access và command; hai điểm vào | features/c2, infrastructure, shell | Cao (ngữ nghĩa access, deep link) | L | WS-2 (access là quyết định), ADR-0095/0098/0099 |
| WS-4 | `OverviewMeasures`: mỗi chỉ số có định nghĩa, nguồn, thời điểm và trạng thái | features/overview | Trung bình (đổi con số) | M | WS-2, WS-3 |

## Thứ tự đề xuất

1. WS-0 (bảo mật, nhỏ, không đổi UI).
2. WS-1 (nhãn và bảng mục, không đổi dữ liệu).
3. WS-2 (cần quyết định phạm vi và có thể cần contract server).
4. WS-4 (dùng số liệu từ WS-2 và WS-3; có thể làm phần định nghĩa và provenance trước).
5. WS-3 (lớn nhất, phụ thuộc ngữ nghĩa access và ADR C2).

## Quyết định cần reviewer (tổng hợp)

| Mã | Câu hỏi | Ai quyết | Ảnh hưởng |
|---|---|---|---|
| D-01 | Nhãn chính tắc cho mục dự án: "Sessions" hay "C2"; "Planning" hay "Plans"; "Team & Approvals" hay "Members"; có giữ "Fleet", "Governance", "Analysis", "Project Settings" ở real | Chủ sản phẩm | WS-1, WS-3 |
| D-02 | Tool approval (HITL) có đi vào hàng quyết định chung không | Chủ sản phẩm + kiến trúc server | WS-2, WS-4 |
| D-03 | "Infrastructure" có chứa Runtime agents hay chỉ C2 | Chủ sản phẩm | WS-3, WS-1 |
| D-04 | Overview có 6 KPI như đề xuất, hay 4 KPI cộng một vùng "Cần xử lý" | Chủ sản phẩm | WS-4 |
| D-05 | Thẻ "Switch to demo mode" trong menu tài khoản real: giữ, ẩn ở production, hay chỉ dev | Chủ sản phẩm | WS-1 (nhỏ) |
| D-06 | Mật khẩu demo trong thông báo sai mật khẩu ở mock (S-03) | Chủ sản phẩm | Không thuộc workstream |

## Ghi chú về trạng thái tài liệu liên quan

- `docs/adr/0095-interactive-c2-console-pty.md`, `0098-controller-lease-for-c2-sessions.md`, `0099-runtime-c2-dispatch-through-web-ledger.md` và `docs/design/2026-10-23-c2-pty-console-proposal.md` có thay đổi chưa commit của owner. Kế hoạch WS-3 dựa trên nội dung hiện có trong working tree, cần owner xác nhận trước khi duyệt.
- `docs/adr/0097-overview-operations-read-section.md` là untracked. WS-4 có thể chồng lên ADR này.
- `GLOSSARY.md` có thay đổi chưa commit của owner. Thuật ngữ đề xuất ở `05-terminology.md` chưa được ghi vào file.
