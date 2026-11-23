# Blue Cell — kiểm chứng độ che phủ phát hiện

Blue Cell đánh giá rule kiểu Sigma đối chiếu với hoạt động thật của
agent, đo thời gian tới khi bị phát hiện (MTTD), ghi kết quả vào
knowledge graph của engagement.

## Vì sao cần cái này

Pipeline Scanner → Detector → Verifier → Exploiter → Patcher đã sinh ra
Defense Brief (rule Sigma, PoC, bản vá đề xuất) — nhưng nếu không có gì
chạy thử lại các rule đó trên chính hoạt động tấn công của agent, team
SOC chỉ nhận 1 bản PDF mà không ai chứng minh rule thật sự bắt được gì.
Blue Cell đọc lại hoạt động của phía Red Cell, chấm điểm rule của
Detector trên đó, và sinh ra 1 báo cáo "Detection Coverage" dạng "rule
này bắt được kỹ thuật X trong 3.2s; rule này bỏ lọt 4 kỹ thuật khác" —
khác biệt giữa "chúng tôi viết vài rule Sigma" và "chúng tôi viết rule
Sigma VÀ đã xác minh chúng trên đúng kill-chain đã chạy".

## Luồng dữ liệu

Sandbox/target ghi log (qua tap sidecar tùy chọn) → `BlueCellTap` chuẩn
hóa thành `TapEvent` → `RuleMatcher` so khớp với rule Sigma-style từ
Detector → mỗi lần khớp ghi 1 node `DetectionFired` vào Neo4j, nối cạnh
`DETECTED`→`Finding` (kỹ thuật tấn công nào bị bắt) và
`USES_RULE`→`DefenseAction` (rule nào bắt được). `Finding` không có
cạnh `DetectionFired` nào là **lỗ hổng phát hiện** — deliverable quan
trọng nhất cho blue team.

## Rule matcher

Matcher Sigma-style tối giản, hỗ trợ 2 dạng: match đơn giản (1 selection,
condition ngầm định) và multi-selection kiểu Sigma thật (nhiều
`selections` + biểu thức `condition` dùng `and`/`or`/`not`). Pattern mặc
định là substring, prefix `re:` chuyển sang regex. Bộ matcher này phủ
được khoảng 80% rule Sigma thật trong thực tế mà không cần phụ thuộc
`pysigma` đầy đủ — có sẵn 10 rule mẫu cho các kỹ thuật phổ biến
(Kerberoast, AS-REP roast, DCSync, Pass-the-Hash, web-shell drop,
PowerShell download cradle, password spray, nmap timing aggressive,
LSASS dump, curl-piped-to-bash).

## Báo cáo Defense Brief

Ở cuối engagement, Blue Cell sinh báo cáo dạng: tổng số kỹ thuật quan
sát được, số bị phát hiện/bỏ lọt (%), MTTD trung vị/p95, danh sách kỹ
thuật bị phát hiện (kèm rule + thời gian), danh sách kỹ thuật bỏ lọt
(kèm lý do — chưa có rule, hay rule có nhưng điều kiện quá hẹp), và đề
xuất cải thiện rule cụ thể.

## Trạng thái

Agent factory (`create_blue_cell_agent`,
`intelligence/agents/standard/blue_cell.py`) đã tồn tại trong code hiện
tại — không còn là "follow-up" như tài liệu gốc từng ghi. Một số phần
khác vẫn ở mức thiết kế, chưa chắc đã triển khai đầy đủ: vòng lặp phản
hồi thích ứng (hạ `opsec_level` khi MTTD thấp), bộ nạp rule dựa trên
`pysigma` đầy đủ, sidecar telemetry phía target, export ATT&CK
Navigator — kiểm tra trực tiếp `packages/raptix/raptix/blue_cell/` để
biết trạng thái mới nhất trước khi dựa vào các phần này.

## Tham khảo

[SigmaHQ/sigma](https://github.com/SigmaHQ/sigma) — chuẩn rule mà
matcher này theo quy ước đặt tên · [Mordor](https://github.com/OTRF/mordor)
— dataset hoạt động tấn công dùng làm test hồi quy cho Blue Cell ·
[Mô hình mối đe dọa](threat-model.md) — Red Cell phía tấn công, Blue Cell
phía xác minh phát hiện.
