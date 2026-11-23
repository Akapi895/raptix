# 2. Thêm node kind `Technology` cho tín hiệu AI-surface và tech-detection

## Bối cảnh

Phân tích lỗ hổng trong #593 cho thấy điểm mù lớn nhất của Raptix là
phát hiện AI-attack-surface: plugin `llm-redteam` có thể tấn công
instance Ollama/vLLM/LangChain/MLflow/ComfyUI đang expose, nhưng recon
không có cách nào *nhận ra* chúng. Hiện tại 1 cổng mở `11434` được ghi
nhận thành `Service` với `service=unknown` (`kg_ingest_masscan`), banner
Ollama bị copy nguyên văn từ nmap, và 1 title/response header của
`httpx` gọi tên 1 stack AI chỉ lưu thành property dạng flat mà không
agent nào route theo. Các classifier rẻ, xác định được (catalog theo
header/port/title/banner/endpoint) đủ để sửa việc này, nhưng cần có nơi
ghi ra kết quả **có kiểu, truy vấn được**.

Cùng 1 primitive còn thiếu này cũng chặn việc nâng cấp tech-detection
recon rộng hơn (whatweb/Wappalyzer → sản phẩm có version mà việc đối
chiếu CVE giả định là đầu vào). Cả 2 nhóm đều muốn cùng 1 thứ: 1 node
graph hạng nhất đại diện cho "1 công nghệ cụ thể đang chạy trên/sau 1
service", có category và nguồn gốc phát hiện (provenance).

Các kind node KG sống trong `packages/raptix-core/raptix_core/types/kg.py`
và là 1 phần của type surface công khai (được test bởi
`packages/raptix-core/tests/test_public_api_stability.py` và
`packages/raptix-core/tests/test_kg_detection_types.py`). Thêm 1 kind là
quyết định schema có chủ đích, không phải thay đổi tùy tiện — vì vậy
cần ADR này thay vì chỉ thêm type khi đi qua.

## Quyết định

Thêm node kind `Technology` vào knowledge graph, kèm 1 migration đi
cùng:

- **Danh tính:** `MERGE` trên `(key, engagement)` với `key` là
  `<category>:<name>` đã chuẩn hóa (ví dụ `ai-runtime:ollama`), giữ
  đúng bất biến cách ly theo engagement mà mọi kind node khác đều theo.
- **Property:** `name`, `category` (enum gồm `ai-runtime`, `ai-proxy`,
  `ai-framework`, `ai-sdk-client`, cộng các category web-tech chung),
  `version` tùy chọn, và `detected_by` (nguồn gốc: `httpx-ai-header`,
  `port-catalog`, `nmap-banner`, `title-regex`, `whatweb`...).
- **Quan hệ:** `RUNS` từ `Service`/`Host` tới `Technology` mà nó expose.
- 1 match title/banner độ tin cậy thấp chỉ được ghi dạng hỗ trợ
  (`_guess`), không thể một mình dẫn dắt 1 chain khai thác.

Các PR classifier trong #593 (AI header/port/title/endpoint, và sau đó
tech-detection whatweb) ghi vào kind node này. Chúng chủ đích nằm ngoài
phạm vi ADR này — ADR này chỉ quyết định schema.

## Hệ quả

- **Dễ hơn:** tín hiệu AI-surface và tech-detection trở thành dữ liệu
  graph có kiểu, truy vấn được mà chain planner và plugin `llm-redteam`
  có thể route theo; mỗi PR classifier trở thành 1 thay đổi ingester
  nhỏ, tự chứa, thay vì phải tự sáng tạo property.
- **Khó hơn:** thêm 1 kind node phải duy trì trong type surface công
  khai và test ổn định của nó; enum category cần 1 từ vựng hữu hạn, có
  chủ (không muốn category dạng free-text vô hạn).
- **Đánh đổi:** không còn lưu phát hiện công nghệ dưới dạng property
  rời trên `Service`. Phương án đó bị loại bên dưới.
- **Migration:** 1 migration tiến thêm label node + constraint duy nhất
  `(key, engagement)`. Không viết lại dữ liệu cũ; kind node chỉ cộng
  thêm. Ingester hiện có không đổi cho tới khi PR riêng của chúng được
  merge.

## Phương án đã xem xét và loại bỏ

- **Property rời trên node `Service`** (ví dụ
  `service.ai_runtime = "ollama"`). Loại: 1 host có thể chạy nhiều công
  nghệ (1 AI proxy *và* framework phía sau nó), version và provenance
  không nhét vào 1 scalar được, và chain planner không thể traverse 1
  property theo cách nó traverse 1 cạnh `RUNS`.
- **Dùng lại kind `Vulnerability`/`Finding` hiện có.** Loại: 1 công
  nghệ được phát hiện không phải là 1 finding; trộn lẫn "MLflow có ở
  đây" với "MLflow ở đây có lỗ hổng" làm sai số liệu finding và lộ
  trình khắc phục.
- **1 chuỗi `category` dạng free-text.** Loại: từ vựng vô hạn phá vỡ
  thiết kế closed-label giúp truy vấn KG được tham số hóa và an toàn
  trước injection — enum chính là mục đích.
