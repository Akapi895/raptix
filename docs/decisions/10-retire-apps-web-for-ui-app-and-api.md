# 10. Retire `apps/web`, chuyển sang `apps/ui-app` + backend mới `apps/api`

## Bối cảnh

`apps/web` (`@raptix/web-raptix`) là web console chính thức tính từ
đợt cutover W16/W20: frontend React 19 + Vite với backend lồng riêng
tại `apps/web/server` (`@raptix/web-raptix-server`, Fastify + Prisma),
nối với LangGraph HTTP API của runtime Python, với tích hợp
C2/sandbox/webshell, và được chi phối bởi khoảng mười ADR (0068, 0084,
0096, 0100, 0101, 0084...) cộng họ target `webraptix-*` của Makefile và
2 file compose.

1 frontend thứ hai, phát triển độc lập, `apps/ui-app`, được nhập vào
repo (commit checkpoint `1bd59088`). Đây là 1 ứng dụng TypeScript/DOM/
Vite độc lập, tách ra từ 1 sản phẩm khác ("CyberStrikeAI"), phủ cùng
không gian vấn đề — vận hành red-team hỗ trợ AI: tác vụ agent qua
chat, project, asset, lỗ hổng, C2, webshell, RBAC, skill, knowledge,
HITL — nhưng được định nghĩa theo hợp đồng API **riêng** của nó
(`apps/ui-app/docs/openapi.yaml`, 300 operation trên 229 path; xem
`apps/ui-app/docs/api-contracts.md`). Tài liệu của hợp đồng đó tự nói
rõ: *"Backend Raptix thật không có sẵn trong repo này. Các interface
API hiện có là ranh giới export, không phải hợp đồng tích hợp Raptix
đã được xác minh."* Hình dạng domain của nó (`conversations`,
`projects`, `vulnerabilities`, `assets`, `roles`, `rbac`,
`wechat-robot`...) không khớp từng chữ với domain model thật của
Raptix (OPPLAN/`EngagementContext`, capability runtime, AKG,
asset-map, governance, closure, scope, vault) mà route của `apps/web`
được xây dựng theo.

Chủ repo quyết định chọn `apps/ui-app` làm frontend web chuẩn duy nhất
từ nay, và retire `apps/web` (cả frontend React và server Fastify/
Prisma lồng của nó) ngay lập tức, thay vì chạy song song 2 bên trong 1
quá trình migrate dần. Chủ sở hữu cũng quyết định khoảng cách giữa hợp
đồng sẵn có của `apps/ui-app` và runtime Raptix thật được đóng bằng 1
**lớp adapter backend-for-frontend (BFF)** dịch domain model của
Raptix sang hình dạng mà `apps/ui-app` đã mong đợi sẵn, thay vì viết
lại `src/api/`/`src/features/` của `apps/ui-app` để khớp hình dạng
gốc của runtime. Cách này giữ nguyên surface UI lớn sẵn có của
`apps/ui-app` và gom rủi ro dịch vào đúng 1 lớp mới, rõ ràng.

Đây là 1 ràng buộc cứng, độc lập với quyết định này:
`packages/raptix/raptix/interfaces/api/auth.py` ghi rõ "Chỉ Web API
giữ token API runtime... nên runtime không bao giờ phục vụ được caller
chưa xác thực." 1 app phía browser không bao giờ được giữ
`RAPTIX_RUNTIME_API_TOKEN_FILE`; phải có 1 tiến trình phía server nào
đó đứng giữa browser và LangGraph HTTP API. `apps/web/server` đã làm
việc đó cho `apps/web`; 1 server mới phải làm việc đó cho `apps/ui-app`.

## Quyết định

1. **`apps/ui-app` là frontend web chuẩn.** `apps/web` (cả frontend và
   `server/` lồng của nó) bị xóa trong thay đổi này. Không có giai
   đoạn chạy song song/strangler — chủ sở hữu chấp nhận khoảng trống
   backend tạm thời như 1 trạng thái đã biết trước.
2. **1 package mới, `apps/api`, là backend BFF/adapter cho
   `apps/ui-app`.** Hợp đồng mục tiêu của nó là
   `apps/ui-app/docs/openapi.yaml`/`api-contracts.md` đúng như đã viết
   — mã client của `apps/ui-app` (`src/api/clients/*`,
   `src/platform/http.ts`, `src/platform/sse.ts`,
   `src/platform/ws.ts`) không bị viết lại để khớp hình dạng gốc của
   runtime. `apps/api` chịu trách nhiệm dịch theo chiều ngược lại:
   domain Raptix → hợp đồng mà `apps/ui-app` đã nói sẵn.
3. **`apps/api` giữ token runtime.** Nó là tiến trình duy nhất được
   phép đọc `RAPTIX_RUNTIME_API_TOKEN_FILE` và gọi LangGraph HTTP API
   (`/threads`, `/assistants`, `/runs`, cộng các mount tùy biến trong
   `interfaces/api/*`). `apps/ui-app` không bao giờ nhận token đó.
4. **Hạ tầng nền được tái sử dụng, không viết lại.**
   `apps/web/server/src/integrations/{c2,sandboxes,webshell,environments,campaigns}`
   và `src/db/client.ts` nói chuyện với hạ tầng (Docker/C2/sandbox/
   Prisma), không với hợp đồng UI của `apps/web`; chúng được khôi
   phục từ git history (commit trước khi xóa) vào `apps/api` thay vì
   viết lại từ đầu.
5. **Route không có khái niệm tương đương trong Raptix được stub, không
   bị bỏ âm thầm.** Nơi hợp đồng của `apps/ui-app` không có khái niệm
   Raptix tương ứng (ví dụ `wechat-robot`, 1 phần `builtin-tools`),
   `apps/api` trả về response "không triển khai cho deployment này" rõ
   ràng thay vì giả thành công, và khoảng trống được theo dõi trong
   implementation plan
   (`docs/design/2026-10-31-ui-app-integration-implementation-plan.md`)
   để quyết định chấp nhận/cắt bỏ rõ ràng cho mỗi nhóm route.
6. **Bề mặt build/CI/compose/launcher từng tham chiếu `apps/web` được
   cập nhật trong cùng change set xóa nó**, không bỏ treo: `Makefile`
   (target `webraptix-*`, và phụ thuộc của `quality` vào
   `webraptix-quality`), `docker-compose.web-raptix.yml`,
   `docker-compose.web-runtime.yml`,
   `infra/containers/web-raptix.Dockerfile`, và tham chiếu
   `apps/launcher/internal/sandboxes/*`.

## Hệ quả

- **Dễ hơn:** surface UI đã xây sẵn của `apps/ui-app` (31+ module
  tính năng, terminal/xterm, Cytoscape graph view, i18n, mobile-web)
  ra mắt mà không cần viết lại frontend. 1 frontend, 1 hợp đồng để
  giữ ổn định.
- **Khó hơn:** mỗi 1 trong 300 operation đã tài liệu hóa của
  `apps/ui-app` cần 1 route `apps/api` tương ứng trước khi tính năng
  đó hoạt động đầu-cuối; cho tới lúc đó, các tính năng đó chạy với
  không có gì (không cả mock cục bộ — transport demo/mock của
  `apps/ui-app` rõ ràng không chuẩn cho lần migrate này, không phải
  thay thế cho adapter thật). Lớp dịch (domain Raptix ↔ hợp đồng hình
  dạng CyberStrikeAI) là 1 đoạn code phải duy trì mãi, không phải 1
  script migrate chạy 1 lần; 1 thay đổi domain Raptix trong tương lai
  (ví dụ tái cấu trúc capability runtime) giờ phải dịch lại ở đúng
  ranh giới này.
- **Đánh đổi:** các route đã đúng domain sẵn có của `apps/web`, schema
  Prisma, và khoảng mười ADR thiết kế đã ổn định (adapter do feature
  sở hữu, ranh giới dữ liệu chỉ-real-mode, single-operator mode áp
  dụng ở đó) không còn mô tả bất cứ thứ gì đang sống. Chúng vẫn ở
  `docs/adr/` như ghi chép lịch sử cho 1 thiết kế không còn trong
  cây code.
- **Migration:** không có giai đoạn strangler/chạy song song.
  `apps/web` bị xóa trong cùng PR với việc chấp thuận ADR này.
  Implementation plan (xem Liên quan) theo dõi việc bổ sung từng
  route cho `apps/api` và là tài liệu trạng thái sống; ADR này không
  lặp lại thứ tự đó.

## Phương án đã xem xét và loại bỏ

- **Viết lại lớp client API của `apps/ui-app` để khớp hình dạng domain
  gốc của runtime (không có adapter BFF).** Bị chủ sở hữu loại: surface
  cần đổi lớn hơn trong 1 frontend vừa nhập vào đã lớn sẵn; BFF gom
  rủi ro dịch 1 lần vào đúng 1 package mới thay vì rải khắp
  `apps/ui-app/src/api/` và `service.ts` của từng feature.
- **Giữ `apps/web` chạy song song tới khi `apps/api` đạt parity
  (strangler).** Bị chủ sở hữu loại: lựa chọn rõ ràng retire
  `apps/web` ngay và chấp nhận khoảng trống backend tạm thời cho
  `apps/ui-app`, thay vì mang 2 frontend/backend qua suốt quá trình
  migrate.
- **Xóa luôn các tích hợp hạ tầng của `apps/web/server` cùng phần còn
  lại của `apps/web`.** Loại: các module đó (`c2`, `sandboxes`,
  `webshell`, `environments`, `campaigns`, `db/client.ts` của Prisma)
  là hạ tầng nền độc lập với hợp đồng UI của `apps/web`; viết lại
  chúng từ 0 trong `apps/api` là công việc lặp lại, có thể tránh được.
