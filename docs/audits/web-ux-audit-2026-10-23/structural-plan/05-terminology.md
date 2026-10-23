# 05 · Từ vựng đề xuất (domain-modeling) — chưa ghi vào GLOSSARY.md

Trạng thái: **đề xuất**. `GLOSSARY.md` có thay đổi chưa commit của owner và yêu cầu của người dùng là không sửa trong giai đoạn này. Khi được duyệt, các mục dưới đây được thêm theo đúng định dạng của glossary (`**Term**:` + định nghĩa + `_Avoid_:`), không có chi tiết cài đặt.

## A. Thuật ngữ đã có trong glossary (giữ nguyên)

- **Access**: quyền tạm thời của một actor trên một C2 session. Nó tách biệt với kết nối của session.
- **Single-shot command**, **Interactive console**, **Controller**: giữ nguyên.

Lưu ý: trong mã, "grant" là tên kỹ thuật của Access. Giao diện và tài liệu dùng "Access".

## B. Thuật ngữ đề xuất thêm

**Decision**:
A request that a named role must answer, and whose answer changes the state of one domain action: a scope revision, a business plan, a C2 access request, a closure, a library proposal, a report or finding in review.
_Avoid_: Approval (khi nói chung), task, ticket

**Tool approval**:
A decision that lets one specific runtime action in one conversation continue. It is the only kind of decision called an approval.
_Avoid_: Approval (khi nói về sign-off nghiệp vụ), HITL prompt

**Notification**:
A message about an event for one actor, with a read state. Answering it is not required and it never closes a decision.
_Avoid_: Notice (trong giao diện), alert, inbox item

**Attention item**:
Something that needs the actor now: a pending decision, an active emergency stop, a failed run, or a source that is unavailable. It is a presentation grouping, not a stored record.
_Avoid_: Task, notification

**Emergency stop**:
A request to halt the running work of an engagement or the whole workspace. It has a state: requested, acknowledged, stopped, failed, or unknown. A stop is not a decision.
_Avoid_: Kill, abort, "stop" when the state is meant

**Listener**:
An endpoint that a C2 provider opens to accept connections, with a protocol and a port. It belongs to the provider's infrastructure.
_Avoid_: Channel, endpoint (khi nói chung), C2 listener

**C2 provider**:
The external command-and-control system behind the console. It may be unavailable, and then the console says so.
_Avoid_: C2 server (khi nói về phần mềm cụ thể), backend

**C2 session**:
A connection from a host to a C2 provider, as the provider reports it. Being connected is not the same as having Access.
_Avoid_: Session (không kèm "C2"), connection, implant

**Measure**:
A number shown on a summary, with its definition, its source and its state (value, zero, not recorded, unavailable, pending).
_Avoid_: KPI (khi nói về cách trình bày), metric

**Provenance**:
Where a number comes from and as of when: the source that answered and the time of the read. A missing source is shown as not recorded, never as zero.
_Avoid_: Source (khi nói về cả thời điểm), lineage (khi nói về bằng chứng)

**Curated finding**:
A finding a user has confirmed as a finding. AI suggestions and drafts are not curated findings.
_Avoid_: Finding (khi nói về suggestion), confirmed finding (khi còn ở trạng thái khác)

## C. Mâu thuẫn tìm thấy trong mã và giao diện

| # | Từ | Các nghĩa đang dùng | Đề xuất |
|---|---|---|---|
| 1 | Approval | Tool HITL (`features/approvals`, `/approvals`) và sign-off nghiệp vụ (Team "Approvals", `ApprovalInbox`, mock `APR.scope/plan/access`) | Giữ "Tool approval" cho HITL; sign-off nghiệp vụ là "Decision" |
| 2 | Session | Phiên đăng nhập (`SESSION_KEY`, `AuthSessionView`); C2 session (provider); thread hội thoại (`aichat/session.ts`); nhãn "Sessions" của dự án | "Sign-in session", "C2 session", "Conversation" (thread) — mỗi nơi một từ đầy đủ |
| 3 | Channel | Mock tab `channels`; route `c2-channel`; không khớp thực thể provider nào | Bỏ; dùng "Listener" |
| 4 | Infrastructure | Gồm cả Runtime agents (LangGraph fleet, không phải C2) và listener/profile (C2) | Tách (D-03 trong WS-3) |
| 5 | Grant / Access | Glossary: Access; mã: grant | Dùng "Access" trong giao diện |
| 6 | Project / Engagement | Nhãn dự án là "Project"; API và trang Overview dùng "engagement" ("All engagements") | Giao diện dùng "Project"; "Engagement" chỉ trong kỹ thuật và tài liệu API (theo checklist X-07) |
| 7 | Notice / Notification | Mã dùng "notice" (`features/notices`, `/api/notices`); giao diện nói "Notifications" | Giao diện: "Notifications"; mã giữ "notice" cho đến khi có quyết định đổi |
| 8 | Stop | "Emergency stop" (thao tác), "stop request" (form), "Stop now" (nút), trạng thái stop | Thao tác: "Emergency stop"; trạng thái: giữ nguyên các trạng thái đã định |
| 9 | Severity / Risk | Donut theo severity; "Risk level" theo trọng số | Hai khái niệm: severity của finding; risk level là chỉ số tổng hợp có định nghĩa riêng |
| 10 | Status / Stage | "Status" (trạng thái project), "stage" (giai đoạn), "lifecycle" | Giữ theo định nghĩa của từng trang; không đổi trong giai đoạn này |

## D. Quan hệ (đề xuất)

- Một Engagement (Project) có nhiều **Decision**; mỗi Decision thuộc một miền nghiệp vụ.
- Một **Tool approval** thuộc một **Conversation** trong một Engagement. Nó không phải Decision theo nghĩa miền.
- Một **Notification** thuộc một actor; có thể trỏ tới một Decision, nhưng đọc hoặc bỏ nó không thay đổi Decision.
- Một **Attention item** được tổng hợp từ Decision, Emergency stop đang hoạt động, run thất bại và nguồn không khả dụng.
- Một **Measure** được tính từ một read port và mang **Provenance** của lần đọc đó.
- Một **C2 provider** có các **Listener** và **C2 session**. Một **Access** cho một actor quyền thao tác trên một C2 session trong một khoảng thời gian.

## E. Điều chưa quyết (cần reviewer)

- Có đưa Tool approval vào tầm nhìn chung hay không (WS-2, D-02).
- Có giữ từ "Overview" cho trang tổng quan toàn cục không (không thuộc phạm vi này).
- Định nghĩa "unresolved" của server (WS-4): cần đọc trước khi ghi vào glossary.
