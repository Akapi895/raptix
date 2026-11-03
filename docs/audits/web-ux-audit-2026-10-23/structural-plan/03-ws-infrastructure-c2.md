# WS-3 · Làm rõ Infrastructure, Sessions và C2

UX-ID: UX-11 (chính), UX-15 (badge không nhãn ở Infrastructure), UX-10 (phần C2). Nguồn: `01-full-audit-report.md`, `02-feature-inventory.md`, `GLOSSARY.md` (đọc, không sửa), mã nguồn tại HEAD `56a29e1a`.

## 1. Kiến trúc hiện tại

### 1.1 Từ vựng đã có trong glossary (phải dùng nhất quán)

Glossary đã định nghĩa: **Access** (quyền tạm thời, có thời hạn, trên một C2 session; tách biệt với kết nối), **Single-shot command**, **Interactive console**, **Controller** (bên duy nhất được gửi input vào một console tại một thời điểm). Plan này dùng đúng các thuật ngữ đó. Trong mã, "grant" là tên kỹ thuật của Access (`grants.ts`, `C2ProviderGrant`); nên gọi là Access trong giao diện và tài liệu.

### 1.2 Mô hình miền phía provider (`features/c2/provider.ts`)

| Khái niệm | Dữ liệu | Ghi chú |
|---|---|---|
| C2 provider | Hệ thống C2 bên ngoài (Sliver trong môi trường lab) | Config-gated; thiếu thì trả 503 |
| Listener | `jobId`, `protocol` (`mtls`/`http`), `port`, `active` | Trong mock và một số tên route gọi là "channel" |
| Profile | `name`, `userAgent` | Cấu hình HTTP profile |
| Session (C2) | `hostname`, `username`, `transport`, `activeC2`, `lastCheckin`, `isDead` | Kết nối; không phải quyền |
| Access | Yêu cầu → quyết định (`approved`/`rejected`) → `revoked` hoặc `expired` | Tạo hành động; có giới hạn thời gian |
| Command | Single-shot, trạng thái `creating`/`succeeded`/`failed`/`uncertain` | Ledger bền vững; `uncertain` không được coi là thành công |

### 1.3 Bốn điểm vào, ba lớp trình bày

| Điểm vào | Thành phần | Có gì |
|---|---|---|
| Infrastructure, toàn cục (`pid = all`) | `RealGlobalResource` (`features/overview/views/global-resource.tsx`) | Rollup: access đang chờ và số command theo trạng thái (`useRealC2Rollup`); thông báo sessions trực tiếp "not integrated" |
| Infrastructure, theo engagement | `RealInfrastructureRoute` (`features/infrastructure/views/real-infrastructure.tsx`), 5 tab: `agents` → `RuntimeFleetTab`; `c2` → `InfrastructureCard`; `sessions` → `ConsoleCard`; `grants` → `GrantsCard`; `campaigns` → `RealCampaignsPanel` | Năm tab, hai bộ tên tab (xem 1.4) |
| Tab dự án `c2` (nhãn "Sessions" ở real) | `C2ProviderTab` (`features/c2/provider-tab.tsx`): `InfrastructureCard` + `C2SessionsWorkspace` + `CommandTable` | Cùng `InfrastructureCard` với điểm vào trên |
| Route `c2`, `c2-channel`, `c2-session`, `c2-console` (feature route) | Nhóm panel `c2` → `C2ProviderTab`; `campaigns` → `RealCampaignsPanel` | Bốn địa chỉ, cùng màn hình; khác nhau ở tham số deep link |
| Mock | `features/c2/views/c2-pages.tsx` (tab `infrastructure`, `channels`, `sessions`) và `session-console` | Hiện thực riêng cho demo |

Hệ quả:
- `InfrastructureCard` được mount ở hai nơi (Infrastructure và tab dự án).
- Các màn hình "session" có tên gần nhau nhưng khác file: `ConsoleCard` (Infrastructure, tab sessions) và `C2SessionsWorkspace` (tab dự án). Chưa xác minh được hai cái có cùng dữ liệu hay không; cần đọc trước khi triển khai.
- Bốn route key render cùng một màn hình. Người dùng và tài liệu thấy bốn trang khác nhau.
- Tab ID của Infrastructure không thống nhất: nhánh `c2` dùng `c2`/`sessions`, nhánh toàn cục dùng `fleet` (`global-resource.tsx`, bảng `SURFACES`), nhánh engagement dùng `agents`.

### 1.4 Infrastructure đang chứa cả hai thứ không cùng miền

Tab `agents` (Runtime agents, `RuntimeFleetTab`) là fleet của runtime LangGraph, không phải hạ tầng C2. Tab `campaigns` cũng là khái niệm riêng. Việc gộp vào "Infrastructure" làm nhãn mơ hồ (D-03).

### 1.5 Mock và real có tên khác nhau cho cùng khái niệm

Mock dùng `channels` và `sessions`; real dùng `c2`, `c2-channel`, `c2-session`, `c2-console`. Glossary và provider dùng "listener" cho thực thể provider. "Channel" không được định nghĩa trong glossary và không khớp với thực thể nào của provider.

## 2. Kiến trúc đề xuất

### 2.1 Tách theo miền, không theo trang

| Thực thể | Chủ sở hữu | Hiển thị ở đâu |
|---|---|---|
| Listener, Profile (hạ tầng do provider báo cáo) | View **Infrastructure** của C2 | Infrastructure (engagement) và điểm vào trong dự án, cùng component |
| Session, Access, Command | View **Sessions** | Tab Sessions của dự án; Infrastructure chỉ liên kết sang |
| Runtime agents | Không thuộc C2 (D-03) | Nhóm "Agents" hoặc giữ trong Infrastructure với nhãn rõ |
| Campaigns | Không thuộc C2 (D-03) | Operations hoặc Infrastructure với nhãn rõ |

Mỗi thực thể có một chủ sở hữu. Điểm vào khác nhau chỉ là tham số (view).

### 2.2 Module sâu `C2Workspace`

Đặt tại `features/c2/workspace/`. Một entry component và một bộ phần chung.

```
<C2Workspace engagementId view="infrastructure" | "sessions" selection? />
```

- `selection` gồm `sessionId?`, `listenerId?`, `tab?`. Địa chỉ cũ được chuyển thành selection bằng alias.
- Bên trong: đọc provider một lần (`useProviderSurface`), áp quy tắc access (một nơi), hiển thị command ledger (một nơi), trạng thái provider không khả dụng (một nơi).
- Deletion test: xóa module thì các màn hình `InfrastructureCard`, `ConsoleCard`, `C2SessionsWorkspace`, `GrantsCard` phải tự xử lý trạng thái provider, access và command. Độ phức tạp đó hiện đã bị nhân ở các điểm vào.
- Seam: không thêm port mới. Real là adapter duy nhất của provider; mock có hiện thực riêng ở `c2-pages.tsx`. Đây là hai adapter thật (real và mock) nên seam ở mức `C2Workspace` là hợp lệ. Mock chỉ cần cung cấp cùng `view`/`selection`.

### 2.3 Route

| Địa chỉ | Sau thay đổi |
|---|---|
| `#/c2` | Canonical; `?view=infrastructure` hoặc `?view=sessions` |
| `#/c2-session/:id` | Alias → `#/c2?view=sessions&session=:id` |
| `#/c2-console/:id` | Alias → `#/c2?view=sessions&session=:id&console=1` (console tương tác là WS sau, theo ADR-0095) |
| `#/c2-channel/:id` | Alias → `#/c2?view=infrastructure&listener=:id` |
| `#/infrastructure` (toàn cục) | Chỉ rollup và liên kết; không có nút ghi, không liệt kê session |

Alias giữ nguyên qua `RouteHost` (cơ chế thay một lần đã có ở Round 1).

### 2.4 Toàn cục: chỉ rollup

Infrastructure ở `pid = all` chỉ hiện: số Access đang chờ theo engagement, số command theo trạng thái (ledger), trạng thái provider theo engagement (có/không khả dụng, kèm lý do). Mỗi dòng dẫn tới engagement. Không có session list, không có nút ghi. Đây là aggregate đọc, có provenance (lý do và thời điểm).

### 2.5 Thuật ngữ trong giao diện

- "Access" cho quyền tạm thời (glossary).
- "Listener" cho thực thể provider (thay "channel"); D-03 xác nhận.
- "Sessions" chỉ cho C2 session trong dự án; không dùng cho phiên đăng nhập (xem `05-terminology.md`).
- Không đổi tên "Single-shot command" và "Interactive console".

## 3. Phụ thuộc

- ADR-0095 (PTY, **Proposed**), ADR-0098 (controller lease), ADR-0099 (dispatch qua ledger web): nằm ở trạng thái thay đổi chưa commit của owner. Trước khi làm WS-3, cần xác nhận trạng thái ADR và phạm vi "console tương tác". Plan này không tự nâng trạng thái nào.
- Provider config-gated: mọi trạng thái "không khả dụng" phải dùng cùng một thông điệp ở mọi điểm vào.
- WS-2: Access là một decision (`c2-grant`). Quyết định access phải đi qua inbox và ghi ở module của C2.
- WS-1: mục "Sessions" và highlight của Infrastructure thuộc bảng mục.
- Glossary: "Access", "Controller", "Interactive console", "Single-shot command" đã có; "Listener" và "Session (C2)" chưa có, cần thêm khi quyết định (không sửa trong plan này).

## 4. Tác động UX

- Một nơi để làm việc với session; Infrastructure trả lại đúng việc của nó (hạ tầng).
- Access và kết nối được hiển thị tách bạch: session có thể còn kết nối khi access đã hết hạn (glossary).
- Người dùng không còn thấy bốn trang khác nhau cho cùng một màn hình.

## 5. Rủi ro hồi quy

| Rủi ro | Giảm thiểu |
|---|---|
| Deep link theo id session (`c2-session/:id`) bị hỏng | Alias và test cho từng địa chỉ trong `routes.json` |
| Hiển thị "kết nối" như thể là quyền | Test: session kết nối với access hết hạn hiển thị hai trạng thái riêng |
| Command `uncertain` bị coi là thành công | Giữ nguyên trạng thái ledger; test với mỗi trạng thái |
| Provider không khả dụng: thông điệp khác nhau theo điểm vào | Một hàm thông điệp trong module; test với 503 |
| Dừng khẩn cấp (E-stop) không phản ánh lên session | Kiểm tra tương tác E-stop và session (test ngoài phạm vi, cần canary) |
| Mock lệch real sau khi đổi tab | Test song song tên view giữa mock và real |
| Bắt đầu console tương tác trước khi ADR được chấp nhận | Không làm trong WS-3; chỉ chuẩn bị chỗ chứa |

## 6. Tiêu chí nghiệm thu

1. Mỗi thực thể (listener, profile, session, access, command) có đúng một component sở hữu. Kiểm bằng `grep`: `InfrastructureCard` chỉ được tham chiếu từ `C2Workspace`.
2. Bốn địa chỉ cũ resolve sang view đúng và giữ tham số (test + trình duyệt).
3. `#/infrastructure` ở `pid = all` không có nút ghi và không có danh sách session.
4. Provider không khả dụng cho cùng thông điệp ở mọi điểm vào.
5. Access và kết nối hiển thị tách bạch (test).
6. Mock và real dùng cùng tên view; nhãn khớp D-01 và D-03.
7. Route smoke mock và real không có lỗi mới; các địa chỉ C2 có cờ hoặc khai báo sẵn được cập nhật có lý do.

## 7. Trình tự triển khai

0. Xác nhận trạng thái ADR-0095/0098/0099 và glossary với owner; quyết định D-03.
1. Characterization: ghi lại nội dung từng điểm vào (real và mock) trên stack có Sliver giả hoặc trạng thái 503.
2. Thêm `C2Workspace` và chuyển tab dự án `c2` sang nó (không đổi hành vi).
3. Chuyển Infrastructure tab `c2`/`sessions` sang `C2Workspace` với `view`.
4. Chuyển bốn route key sang alias (routes và aliases) và thêm test.
5. Thu gọn Infrastructure toàn cục về rollup.
6. Đổi nhãn và tên tab theo D-01/D-03; mock đổi tương ứng.
7. Ghi ADR (ứng viên): "Ownership của C2 infrastructure và C2 sessions". Lý do ADR: quyết định khó đảo ngược, cần lý do để người đọc sau hiểu vì sao tách như vậy.
