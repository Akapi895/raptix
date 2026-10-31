# Prompt giao agent implement Raptix Real Web

Dùng nguyên nội dung trong khối dưới đây làm prompt. Implementation plan là nguồn chi tiết duy nhất; không cần chép các checklist cũ vào prompt.

```text
Hãy implement hoàn chỉnh Raptix Real Web trong repo hiện tại theo:
  docs/web-real-ui-implementation-plan.md

Mục tiêu giao hàng: một web thật dùng được thật tại http://127.0.0.1:3001.
Giao diện phải học kỹ màu sắc, layout, content hierarchy và interactions từ
reference/web/ rồi adapt vào domain/contracts/runtime Raptix. Không dừng ở
đọc reference, tạo checklist, đổi vài token, build thành công hoặc route render.

ĐỌC VÀ THỰC HIỆN
1. Đọc repo/app AGENTS.md, contribution/quality contract, architecture boundaries
   và frontend-backend integration execution contract được plan chỉ định.
2. Đọc plan §1–§4; dùng decisions A01…A13 làm mặc định đã chốt. Những câu hỏi
   D-01…D-09 trong checklist lịch sử không còn là lý do dừng để hỏi lại.
3. Thực hiện W00 → W13, chia tracer bullets vừa budget repo. Đọc §5 đúng miền
   khi tới wave đó, và áp dụng gate §7–§10 trước khi đánh complete.

HỌC REFERENCE Ở CẤP TỪNG TRANG
- Inventory đủ R01…R29 theo plan, kể cả trang excluded phải có disposition.
- Trước khi sửa một trang Raptix, đọc đúng HTML fragment trong
  reference/web/templates/index.html, CSS selectors/final cascade và JS module
  của trang CyberStrikeAI tương tự. Ghi reference → adaptation → data owner →
  acceptance case. Đừng chỉ nhìn một screenshot hoặc CSS :root.
- Ví dụ bắt buộc: Overview học page-dashboard + dashboard.js + dashboard CSS:
  KPI/drill-down, freshness/stale, severity distribution/legend, recent findings/
  facts, queue, tool stats, resources, recommended actions và empty-state CTA.
  Phải adapt các khối đó sang dữ liệu thật Raptix, không chỉ thay heading Dashboard.
- AI Workspace giữ cấu trúc RealConversation hiện có theo A13: conversation
  dropdown/header, chat/composer và optional Agent sidebar với Agents/Progress/
  Artifacts, toggle/resize/History drawer. Học search/composer/tool cards/scroll/
  progress/HITL từ reference để bổ sung tại các seam này; không copy fixed left
  history rail, thêm inspector thứ hai hoặc rewrite thành ba cột bên trong sidebar.
- Assets học
  cả overview/trends/coverage/inventory/filters/import/detail/discovery; các miền
  còn lại đọc theo reference map của plan.
- reference/ có thể bị search ignore: dùng đường dẫn cụ thể. Đây là tài liệu
  tham khảo, không phải backend chạy cùng app và không phải thư viện để import.

IMPLEMENT REAL, KHÔNG DỮ LIỆU GIẢ
- Giữ React/Vite/Fastify/Python runtime, hash links, accepted ADR semantics và
  evidence authority. Presentation dùng feature port/query; dữ liệu real qua
  shared contract → API/service → runtime/provider → persistence.
- Thiếu endpoint/domain/consumer cần cho required feature thì implement đúng
  owning layer, Proposed ADR/migration/validators/tests theo repo. Một trang
  unavailable, localStorage record giả hoặc toast "saved" không là feature hoàn tất.
- Knowledge mock trong proposal cũ được thay bằng real document/index/search/
  retrieval flow theo A09. Model/policy/MCP settings phải có consumer thật.
- Existing mock/test infrastructure giữ nếu cần tương thích; production real
  không dùng seed authority, fake counts/health/progress hoặc demo fallback.
  Test fixtures chỉ dùng ở tests; native gate dùng records/services thật.
- Scope đã chốt trong plan: 7 global items, 14 project items, AI Workspace
  incremental trên bố cục hiện tại (A13), ordered-step
  Playbook/Profile, real Knowledge, real accounts/config/policy và native sessions.
  Exclusions chỉ theo plan; không tự drop required features để hoàn thành nhanh.

TỰ CHỦ
- Tự chọn chi tiết kỹ thuật trong boundaries đã có và tiếp tục implement;
  không hỏi lại màu sắc/layout/scope hoặc gửi questionnaire. Ghi quyết định
  kỹ thuật nhỏ cùng rationale trong delivery record.
- Khi gặp thiếu cấu hình, dùng approved local config/actual isolated local
  services nếu có thể. Giữ secrets server-side, không ghi vào chat/evidence.
- Nếu một external dependency hoặc ADR acceptance ngoài thẩm quyền thực sự
  chặn, ghi exact blocker và tiếp tục mọi wave độc lập. Không tự đổi ADR status,
  hạ guardrail, fake provider output hoặc nhận COMPLETE khi còn required blockers.
- Theo đúng diff-size/one-concern và targeted-testing contract. Không commit,
  push, xóa user volumes hoặc chạy full repository suite nếu chưa được yêu cầu riêng.

KIỂM CHỨNG VÀ DEPLOY
- Tạo case mapping cho từng required criterion; không coi heading/200/rendered
  là full pass. Extend harness hiện có; deployed-checklist.mjs là baseline read-only,
  không phải giấy chứng nhận đầy đủ.
- Mỗi feature kiểm success + refusal + persistence; UI thay đổi kiểm light/dark,
  desktop/mobile/keyboard/contrast và so sánh reference cùng viewport/theme.
- Chạy live canary riêng: planning question → documents/handoff/scope/preflight
  → execution/subagent/tool đúng sandbox → stream/recovery → artifacts → finding
  import/classify/independent review → report/export. Có no-findings report và
  native session gates theo plan. Không dùng lab mục tiêu để debug harness.
- Build/recreate đúng Compose project/services thực sự phục vụ 3001; không chỉ
  chạy npm build/Vite 5273. Xác nhận build fingerprint/assets và browser real mode
  trên 3001, giữ data/config/runtime bindings. Rebuild không tự implement backlog.

DELIVERY
- Cập nhật progress sau từng tracer bullet/wave; ghi changed layers, exact commands,
  tested source/image, actual IDs/outcomes, screenshots và sanitized evidence.
- Tự sửa acceptance failures và chạy lại phần bị ảnh hưởng trước khi kết luận.
- Đầu ra gồm code/backend/runtime integration cần thiết, migrations/config,
  reference adaptation map, executable acceptance cases, coverage/evidence bundle,
  deployed URL/build identity và rollback instructions.
- Chỉ báo COMPLETE khi Definition of Done trong plan đạt. Nếu buộc handoff,
  ghi current failing case/repro/changed files/next command, không nhận đã hoàn tất.

Bắt đầu bằng W00 và triển khai liên tục tới delivery, không chỉ trả lời một kế hoạch.
```

## Cách review kết quả agent

Mở `http://127.0.0.1:3001` trong fresh browser context và đối chiếu build identity, reference comparisons, mandatory case coverage và native outcomes. UI cần thay đổi rõ ở shell/Overview và các trang tương ứng; một report nhiều tests pass nhưng thiếu page content hoặc còn required unverified cases chưa đáp ứng prompt này.

## Prompt tiếp tục từ báo cáo W00–W03 partial

```text
Tiếp tục implementation theo docs/web-real-ui-implementation-plan.md, giữ nguyên
phạm vi real-only và các quyết định A01…A13. Đọc review mới ở §11.2 trước khi làm.
AI Workspace giữ bố cục RealConversation hiện có; bổ sung header/chat/composer/
Agents–Progress–Artifacts, không thêm fixed history rail hoặc cột thứ tư.

Baseline deployed: d2f82baa-wt-974ce59012 tại http://127.0.0.1:3001.
Review đã login được và authenticated overview/tasks reads trả 200. Blocker
"không có tài khoản" đã được gỡ; dùng approved local configuration/trusted session
không in secrets. Không dùng screenshot trang login làm nghiệm thu giao diện.

Đầu tiên đóng các acceptance còn thiếu của W02/W03:
- Settings real copy và trusted identity, blue primary/navigation hierarchy,
  canonical project navigation 14 mục với aliases giữ nguyên.
- Overview có chart/legend, freshness, recent findings/facts/events, tool/model
  telemetry, health/resources và actual aggregate metrics; Per project không thay
  agent/session KPI, static quick actions không thay data-driven recommendations.
- Reproduce và sửa source-failure của operations summary: lỗi DB không thành 0.
- Đọc reference Dashboard thật: 5 KPI source; 6 KPI là adaptation Raptix. Chụp
  before/after sau đăng nhập trên 3001, light/dark và mobile, đối chiếu reference.

Sau đó tiếp tục W04–W13 theo dependencies. Missing Knowledge backend là phần
implementation W08, không phải lý do dừng toàn bộ. Provider/PTY blocker chỉ chặn
native case tương ứng; tiếp tục các phần độc lập và không tự đổi scope/ADR status.

Không chạy lại hàng loạt mock/route tests không liên quan để thay việc implement.
Chọn targeted assertions đúng criterion; native workflow cần engagement canary
riêng với RoE thật, không dùng lab mục tiêu để debug harness.

Mỗi phần giao hàng gồm source change + real behavior + refusal/persistence check
+ screenshot/evidence trên 3001. Cập nhật progress bằng kết quả đã thực hiện.
Nếu bị giới hạn phiên/context, handoff PAUSED kèm current failing case và next
command; không tự nhận COMPLETE hoặc gọi pending implementation là BLOCKED.
Tiếp tục thực thi, không chỉ trả lời lại bằng một kế hoạch/báo cáo route smoke.
```
