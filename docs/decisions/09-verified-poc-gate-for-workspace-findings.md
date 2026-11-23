# 9. 1 finding trong workspace chỉ được xác nhận bởi 1 verifier riêng, chạy lại đúng PoC đã seal

## Bối cảnh

1 finding được viết bởi agent sinh ra nó (`exploit`, `postexploit`,
`recon`) vào `findings/FIND-NNN.md` theo template tầng vận hành trong
`finding-protocol`. Template đã yêu cầu 1 phần xác minh trước khi 1
finding được đánh dấu `confirmed`, và prompt của verifier đã yêu cầu
JSON của tool phải được lưu thành
`findings/evidence/FIND-NNN_verification.json`. Không có gì thực thi
2 quy tắc đó. Trong engagement `CodePartTwo`, `FIND-001` được agent
exploit viết với status `confirmed`, không có `verification.json`, và
chỉ gọi tên PoC của nó là 1 file bằng chứng,
`FIND-001_payload.js`, không có field nào liên kết finding với file
đó.

Tool `validate_workspace_finding` đã có thể chạy 1 lệnh PoC và baseline
của nó trong sandbox rồi trả về `validated`. Role verifier
(`intelligence/agents/plugins/verifier.py`) đã có tool này trong tập
tool của mình. Nhưng role đó chỉ gắn vào orchestrator `vulnresearch`
qua `parent_agents`, nên orchestrator `raptix` chạy engagement không
bao giờ dispatch nó. Tập tool của nó còn có `bash`, nên 1 verifier có
thể tự viết lệnh thay cho lệnh của bên sinh ra finding, và prompt của
nó bảo nó "xây dựng bản tái tạo nhỏ nhất".

Chất lượng verdict phụ thuộc vào 3 thứ mà ADR này sửa: ai quyết định,
bên quyết định được phép đổi gì, và lệnh nó chạy có đúng là lệnh bên
sinh ra finding đã viết hay không.

## Quyết định

1. **Sinh ra (mức prompt).** `finding-protocol` yêu cầu mọi finding
   mới mang `status: candidate` trong frontmatter. 1 finding có PoC
   cũng mang 1 phần `## Proof of Concept` với 1 object JSON trong 1
   block fenced. Object này giữ `file` (đường dẫn PoC dưới
   `/workspace`), `poc_sha256` (SHA-256 của file PoC), `payload` (1
   chuỗi con của `command` mang theo exploit), `command` (lệnh PoC),
   `success_patterns`, `negative_command`, `negative_patterns`,
   `cvss_vector`, và `spec_sha256` (SHA-256 của JSON chuẩn của object
   không tính `spec_sha256`). Bên sinh ra finding không bao giờ viết
   `confirmed` hay `rejected`.
2. **Xác minh (tác nhân riêng).** Role `verifier` sẵn có trở thành
   tác nhân xác minh. Nó là 1 agent LLM. `parent_agents` của nó được
   thêm `raptix`, nên orchestrator engagement dispatch được nó. Prompt
   của nó chỉ phủ đúng protocol workspace. Tập tool của nó là tool
   bằng chứng chỉ-đọc cộng 1 tool mới,
   `verify_workspace_candidate(finding_id)`. Nó không có `bash`,
   `validate_workspace_finding`, hay bất kỳ tool viết nào cho finding.
3. **Verdict đến từ tool, không từ model.** `verify_workspace_candidate`
   chỉ nhận id finding. Nó đọc block đã seal từ file finding và không
   bao giờ nhận lệnh, pattern, hay vector CVSS từ model. Nó chạy PoC
   qua `validate_workspace_finding` với giá trị từ file. Nó viết
   `findings/evidence/FIND-NNN_verification.json` nguyên văn, kèm
   hash nó đã kiểm, và đặt `status` theo verdict. `confirmed` chỉ được
   viết khi tool trả về `validated=true` cho đúng PoC này.
4. **Kiểm seal.** Trước khi chạy, tool tính lại `spec_sha256` trên
   block và so với giá trị đã lưu. Sau đó hash file PoC và so với
   `poc_sha256`. Lệch là từ chối. Việc từ chối được ghi lại, và status
   trở về `candidate`, nên 1 finding bị đổi sau khi xác nhận sẽ mất
   xác nhận đó.
5. **Kiểm baseline và pattern trong code.** Payload phải xuất hiện
   đúng 1 lần trong `command`. `negative_command` phải bằng `command`
   sau khi bỏ payload, sau khi chuẩn hóa khoảng trắng. Mỗi pattern
   phải compile được, không ngắn hơn 4 ký tự, không khớp chuỗi rỗng, và
   không chứa dấu phẩy, vì tool bên dưới split theo dấu phẩy. Bất kỳ
   lỗi nào ở đây là từ chối trước khi chạy bất cứ thứ gì.
6. **Verdict.** `validated=true` cho `confirmed`. 1 lần chạy hoàn tất
   mà không validate cho `rejected`. 1 lần chạy không hoàn tất
   (timeout, lỗi sandbox) hoặc 1 lần từ chối cho `candidate`, nên
   finding có thể được xác minh lại.
7. **RoE áp dụng cho lần chạy lại.** `verify_workspace_candidate` gia
   nhập tập tool bị RoE gate, nên marker abort, khung thời gian, và
   audit ledger đều áp dụng cho nó. Bên trong tool, target của cả 2
   lệnh được kiểm bằng đúng hàm RoE mà middleware dùng cho `bash`
   (`evaluate_command`, `extract_targets`, `evaluate_target`). 1 tài
   liệu RoE không đọc được thì từ chối lệnh gọi.

## Hệ quả

- **Dễ hơn:** 1 finding đã confirmed có 1 bản ghi xác minh gọi tên
  đúng byte PoC và lệnh đã chạy. Verdict là output của tool, nên 2
  lần chạy cùng 1 PoC đã seal cho cùng verdict. Orchestrator có thể
  dispatch xác minh cho cả engagement, không chỉ riêng pipeline
  vulnresearch.
- **Khó hơn:** bên sinh ra finding phải tính 2 hash và viết 1 block
  JSON. 1 PoC không chạy được khi bỏ payload thì không xác minh được,
  vì kiểm baseline yêu cầu payload phải gỡ bỏ được.
- **Đánh đổi:** 1 verifier không thể chỉnh PoC, khởi động target, hay
  sửa 1 lệnh hỏng. Trường hợp đó được ghi `candidate` kèm lý do, và
  bên sinh ra finding phải viết 1 PoC đã seal mới.
- **Migration:** prompt của `verifier` được viết lại cho protocol
  workspace. Quyền `bash` của nó bị gỡ, nên pipeline `vulnresearch`
  mất khả năng dùng `bash` dựng PoC của verifier. File `FIND-*.md` cũ
  không có block PoC vẫn giữ `candidate` tới khi được xác minh hoặc
  sinh lại.

### Giới hạn thiết kế này chưa đóng được

- Không có gì trong code kiểm tra 1 success pattern có chứng minh
  đúng impact mà finding tuyên bố. Tool chỉ kiểm pattern khớp output
  bằng chứng và không khớp baseline. Việc khớp đó có cho thấy đúng
  impact đã tuyên bố hay không vẫn là việc review, được review
  four-eyes trong ADR-0100 phủ trước khi finding vào báo cáo.
- 1 bên sinh ra finding viết lại cả file PoC và seal của nó trước khi
  xác minh thì không bị seal phát hiện. Seal chỉ phát hiện thay đổi
  sau khi seal được viết.
- 1 bên sinh ra finding có `bash` vẫn có thể viết trực tiếp
  `status: confirmed` vào file finding. Đóng lỗ hổng này cần 1 cổng
  phía server hoặc web yêu cầu `verification.json` với
  `validated=true` trước khi hiện finding là confirmed. Cổng đó là
  việc làm tiếp theo, không thuộc ADR này.
- Ứng dụng web chưa hiển thị verdict.

## Mô hình mối đe dọa

Verifier chạy lại 1 exploit chống lại 1 target, nên đây là 1 hành
động chủ động trên target. Phạm vi của nó được kiểm soát ở 3 nơi:
cổng RoE trên tool call, kiểm target bên trong tool trên cả 2 lệnh, và
lệnh đã seal, mà verifier không thể đổi. Timeout 60 giây của sandbox
runner giới hạn mỗi lần chạy. Kiểm RoE và abort fail-closed khi sandbox
project không đọc được. 1 PoC đã seal không thể mở rộng sang host khác
sau khi sinh ra, vì seal phủ cả lệnh, và bất kỳ thay đổi nào phá vỡ
seal.

## Phương án đã xem xét và loại bỏ

- **1 verifier xác định (deterministic), không LLM.** Loại hiện tại:
  verifier cần quyết định khi nào từ chối và cách báo cáo 1 lần từ
  chối, và role verifier có sẵn của repo đã cung cấp điều đó. Verdict
  vẫn do tool quyết định, nên LLM không thể đổi nó.
- **1 role verifier mới, tách khỏi `verifier`.** Loại vì role đã có
  sẵn, và 2 role cùng 1 việc sẽ trôi dần khỏi nhau.
- **Bên sinh ra finding viết verdict.** Loại vì nó xóa bỏ chính sự
  tách biệt mà ADR này tồn tại để tạo ra.
