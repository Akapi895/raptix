# Kiểm thử chấp nhận thủ công (UAT): console web Raptix (stack kiểm thử)

Đối tượng: một người am hiểu console. Thời gian: khoảng 60 phút. Môi trường: một stack kiểm thử cô lập, khởi động từ repository này. **Tuyệt đối không dùng production, container 3001 hoặc dev server 5273 cho lần chạy này.** Không được tác động tới bất kỳ target nào nằm ngoài stack; không chạy lệnh C2, listener hay Emergency Stop.

*(Bản tiếng Anh gốc: `MANUAL-UAT.md`. Nếu hai bản khác nhau, bản tiếng Anh là bản chuẩn.)*

## 1. Khởi động stack (từng bước)

**Bước 1. Kiểm tra Docker Desktop.** Mở Docker Desktop và chờ đến khi nó chạy hẳn (biểu tượng ở khay hệ thống không còn báo "starting").

**Bước 2. Tạo hai thư mục trống nằm ngoài repository.** Mở **PowerShell** và chạy từng dòng:

```
New-Item -ItemType Directory -Force -Path C:\raptix-uat\hold
New-Item -ItemType Directory -Force -Path C:\raptix-uat\out
```

**Bước 3. Chuyển tới thư mục `apps/web`** trong cùng cửa sổ PowerShell:

```
cd D:\.VTNet\redteam\raptix\apps\web
```

**Bước 4. Chạy lệnh khởi động.** Dán nguyên dòng này rồi nhấn Enter. Giữ cửa sổ này mở suốt quá trình kiểm thử:

```
node tools/verify/stack.mjs --modes real --hold --hold-dir "C:\raptix-uat\hold" --out "C:\raptix-uat\out"
```

**Bước 5. Chờ.** Lần đầu có thể mất vài phút. Cửa sổ có thể im lặng lâu; đó là bình thường. Khi thấy dòng sau thì stack đã sẵn sàng:

```
holding stack; the connection file is C:\raptix-uat\hold\hold.json; create ...\STOP to stop
```

**Bước 6. Lấy địa chỉ và tài khoản.** Mở file `C:\raptix-uat\hold\hold.json` bằng Notepad:

- Địa chỉ web: giá trị của `"app"` (dạng `http://127.0.0.1:<cổng>`). Dán vào thanh địa chỉ trình duyệt.
- Tài khoản owner: `verifier`. Mật khẩu: giá trị của `"adminPassword"`.
- Tài khoản khác: `viewer`, `reviewer`, `operator` đều có `username` và `password` trong file.

**Lưu ý:**

- Không đóng cửa sổ PowerShell đang chạy stack, và không nhấn Ctrl+C trong lúc kiểm thử. Khi xong, dừng theo mục 4.
- Nếu lệnh báo `must be outside the repository`: đổi sang thư mục khác, không nằm trong `D:\.VTNet\redteam\raptix`.
- Nếu báo lỗi liên quan đến docker: kiểm tra Docker Desktop đã chạy (bước 1), rồi chạy lại lệnh bước 4.
- Nếu lệnh thoát với lỗi: sao chép 10 dòng cuối trong cửa sổ PowerShell và gửi lại.
- Nếu thư mục `hold` còn file `STOP` từ lần trước, stack sẽ dừng ngay khi vừa khởi động. Khi đó xóa file `STOP` đó, hoặc dùng hai thư mục mới (ví dụ `C:\uat-lan2\hold` và `C:\uat-lan2\out`).
- Nếu `node` không được nhận diện: chạy `node -v`. Phải hiện số phiên bản; nếu không, cài Node.js rồi mở lại PowerShell.

## 2. Lấy thông tin đăng nhập kiểm thử an toàn

- Mở file `hold.json` trong thư mục `--hold-dir` bằng trình soạn thảo văn bản. File này có `app` (địa chỉ web), `owner` (`verifier`) và `adminPassword`; `viewer`, `reviewer` và `operator` mỗi tài khoản có `username` và `password`.
- Không dán các giá trị này vào chat, ticket, ảnh chụp màn hình hay repository. Mỗi lần khởi động, các giá trị này được sinh ngẫu nhiên.
- Đăng nhập bằng tài khoản owner tại địa chỉ `app`. Dùng các tài khoản khác cho những bước cần đến chúng.
- Để đổi tài khoản: mở menu tài khoản (avatar tròn ở góc trên bên phải, `Account menu`), chọn `Account / sign out`, rồi nhấn `Sign out`.

## 3. Đặt lại (reset)

Dừng rồi khởi động lại (mục 4, sau đó mục 1). Mỗi lần khởi động có một cơ sở dữ liệu mới. Reset luôn là khởi động lại; không có reset một phần. Thay đổi phạm vi (scope) trong một phiên sẽ thay thế ROE đã duyệt (xem OPEN-ISSUES OI-02), vì vậy khởi động mới cũng là cách để lấy lại ROE mẫu.

## 4. Dừng stack

Tạo một file rỗng tên `STOP` trong thư mục `--hold-dir`. Trong PowerShell, chạy `New-Item C:\raptix-uat\hold\STOP`. Terminal sẽ in các dòng dừng và trả lại dấu nhắc. Sau đó xóa `hold.json` bằng tay; stack không tự xóa file này. Kiểm tra không còn gì đang chạy:

```
docker ps --filter label=raptix.verification=stack
```

Lệnh chỉ nên in ra dòng tiêu đề.

## 5. Các điểm kiểm tra

Với mỗi dòng, ghi PASS, FAIL hoặc NOT RUN kèm lý do. Với FAIL, ghi thêm ghi chú.

| # | Hành trình | Các bước | Kỳ vọng | Kết quả |
|---|---|---|---|---|
| 1 | Đăng nhập bằng owner | Đăng nhập bằng tài khoản owner | Danh sách project hiện "Stack verification project" | |
| 2 | Số liệu Overview | Mở Overview | "Awaiting decisions" hiện một con số, hoặc "26+" nếu có hộp thư bị giới hạn; không bao giờ để trống | |
| 3 | Phạm vi viewer | Đăng xuất, đăng nhập bằng `viewer` | Chỉ thấy project dùng chung; không thấy tên project nào khác | |
| 4 | Nút điều khiển của viewer | Sau dòng 6 (phải có một plan đã propose), đăng nhập bằng `viewer`; mở tab Governance | Không có nút Approve, Reject, Propose hay Revise, và không có form nháp | |
| 5 | Operator soạn plan | Đăng nhập bằng `operator`; Governance → Draft plan | Dòng hiện `draft` | |
| 6 | Operator propose | Propose bản nháp | Dòng hiện `proposed` sau khi tải lại trang | |
| 7 | Tác giả không tự duyệt | Với tư cách operator, xem dòng `proposed` | Không có nút Approve hay Reject; dòng hiện "You wrote this plan; an independent reviewer decides it." | |
| 8 | Reviewer duyệt | Đăng nhập bằng `reviewer`; Approve plan đã propose | Dòng hiện `approved` sau khi tải lại trang | |
| 9 | Thay đổi phạm vi | Với tư cách operator, gửi một thay đổi scope trong Scope & ROE | Tab Team hiện một quyết định đang chờ; số đếm trên Overview tăng một | |
| 10 | Reviewer quyết định revision | Với tư cách reviewer, duyệt từ tab Team | Số đếm giảm về như cũ; revision ở trạng thái đã duyệt | |
| 11 | Findings | Mở Findings | "Stack verification finding" hiện là đã xác nhận (confirmed) | |
| 12 | Assets | Mở Assets | `stack-host-01.verify.example.test` được liệt kê | |
| 13 | Xuất báo cáo | Mở báo cáo trên trang Reports. Nút xuất (`Export PDF`, `Export DOCX`) chỉ xuất hiện khi báo cáo đã được duyệt (xem ghi chú 2) | File DOCX mở được và có tiêu đề báo cáo cùng tiêu đề finding | |
| 14 | Chiều rộng điện thoại | Trình duyệt ở 390 px: Overview và Governance | Không có cuộn ngang | |
| 15 | Form C2, không dispatch | Infrastructure → Sessions | Form và nhãn hiện; **không nhấn Dispatch** | |

Ghi chú:

1. Các dòng 2, 4 và 10 phụ thuộc vào các bước trước trong cùng lần chạy. Dòng 4 cần plan đã propose từ dòng 5 và 6. Dòng 10 cần revision đang chờ từ dòng 9.
2. Dòng 13 chưa được mô tả đầy đủ. Trang báo cáo chỉ hiện `Export PDF` và `Export DOCX` cho báo cáo đã duyệt, và việc duyệt là một bước riêng (gửi xét duyệt, sau đó reviewer nhấn `Approve Report`). Luồng duyệt chưa được thực hiện trong lần kiểm tra này, nên dòng này ghi NOT RUN trừ khi bạn tự thực hiện. Xuất markdown là định dạng API, không có nút tương ứng trong giao diện.
3. Sau bước 9, phần preflight trên Governance có thể báo chưa có ROE đã duyệt cho đến khi revision được quyết định (OI-02). Đây là hành vi dự kiến, không phải lỗi.

## 6. Ghi nhận lỗi

Mỗi lỗi một mục:

```
ID:        UAT-<số>
Dòng kiểm tra: <số dòng>
Vai trò:   owner | operator | reviewer | viewer
Chiều rộng: <px>
Các bước:  <bạn đã làm gì>
Kỳ vọng:   <lẽ ra phải xảy ra gì>
Thực tế:   <đã xảy ra gì, kèm nguyên văn thông báo>
Bằng chứng: <file ảnh chụp ngoài repo, hoặc none>
```

## 7. Kết luận

Chọn một và ghi lý do trong một câu:

- **PASS**: mọi điểm kiểm tra đều đạt.
- **PASS WITH ISSUES**: mọi điểm kiểm tra đạt, chỉ trừ các lỗi nội dung hoặc bố cục không chặn hành trình nào.
- **FAIL**: một điểm kiểm tra thất bại ở quy tắc phân quyền, dữ liệu hoặc duyệt.

PASS ở đây chỉ có nghĩa là các hành trình chạy đúng trên stack kiểm thử. Nó không phải là sẵn sàng production, và không nói gì về runtime thật, operations, hội thoại AI hay C2 provider; các phần này không có trên stack (xem OPEN-ISSUES NV-01 đến NV-03).

## Các lệnh trong hướng dẫn này

Đã kiểm chứng trong lần này: lệnh khởi động (mục 1), các trường của file hold (mục 2), file `STOP` và kiểm tra container (mục 4), và khởi động lại như reset (mục 3). Mỗi lệnh đã được chạy trên một stack khởi động và dừng sạch sẽ.
