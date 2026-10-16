# Web completion — lỗi tồn đọng và gap nghiệm thu

Ngày tổng hợp: **2026-10-20**. Baseline review: **`884e872`** (branch `web-improve-refactor`).
Nguồn: rà soát `docs/design/2026-10-15-web-completion-implementation-plan.md`, hai vòng code review
(Standards + Spec) và các probe browser/PostgreSQL thật.

Tài liệu này **chỉ liệt kê việc còn lại**. Các lỗi đã fix nằm ở các commit từ `094d67b` đến `884e872`.

Trạng thái gate hiện tại: **server 400/400 test**, **web affected-area 223/223**, typecheck + lint
sạch cả hai package. Test xanh không thay thế nghiệm thu browser/DB/runtime/provider thật.

---

## 1. Lỗi source đã tái hiện, **chưa fix**

| # | Mức | Khu vực | Vị trí | Bằng chứng / tái hiện | Ảnh hưởng | Hướng xử lý đề xuất |
|---|-----|---------|--------|----------------------|-----------|---------------------|
| R1 | P1 | SSE không re-check membership | `apps/web/server/src/services/runtime/stream-service.ts:20-42` | Sub-agent repro: gỡ membership nhưng stream vẫn gửi frame; chỉ 1 lần authorize lúc mở | Member bị thu hồi vẫn tiếp tục nhận output của engagement | Thêm cơ chế re-attestation khi revoke (đóng stream/annotate) — cần quyết định contract + ADR; test 2 browser |
| R2 | P1 | Recovery identity dùng chung giữa actor | `apps/web/src/real/workspace-session.ts:8,12-37` (key theo `REAL_IDENTITY.id`), consumer `apps/web/src/real/screens/workspace.tsx:79-83` | Sub-agent source-confirmed: login/logout chỉ xoá query, không reset selected thread/pending request theo actor | Actor B khôi phục selection/pending request của A trên cùng engagement | Khoá state theo actor id thật (session/deployment identity); dọn khi logout/session đổi (W04) |
| R3 | P2 | Schedule cancel thiếu version CAS | `apps/web/server/src/services/schedule-service.ts:150-157` | Sub-agent repro: cancel chỉ condition theo `status`, không nhận `expectedVersion`; ADR-0073 yêu cầu CAS cho cancel/reschedule | Cancel cũ có thể áp lên intent đã được dời lịch | Thêm `expectedVersion` cho cancel + test stale version |
| R4 | P2 | Stop finalization không bump `concurrencyVersion` | `apps/web/server/src/services/governance-service.ts:407-468` | Sub-agent source-confirmed | Resolver giữ version cũ vẫn resolve được stop đã finalize | Cân nhắc: hiện được coi là chấp nhận (resolve stop active là luồng hợp lệ). Nếu muốn strict: bump version khi finalize + reload-yêu-cầu |

> Ghi chú R4: CAS hiện tại đã chặn finalize ghi đè resolution mới (đã fix). Chiều ngược lại
> (resolver cũ resolve stop đã finalize) là chủ đích chấp nhận, không phải lỗi chức năng.

---

## 2. Hạng mục cần quyết định contract (trước khi coi là hoàn thiện)

| # | Mục | Hiện trạng | Cần chốt |
|---|-----|-----------|----------|
| D1 | SSE revoke/recovery policy | Chưa có re-attestation (R1) | Cách đóng/annotate stream khi mất quyền; ADR |
| D2 | Multi-user recovery identity | State còn theo `local` (R2) | Nguồn actor identity tin cậy + lifecycle reset |
| D3 | Model fallback chain trong assistant readiness | `main.ts` chỉ xác minh assistant role có trong catalog; chưa có nguồn public cho fallback chain | Có thêm endpoint runtime để verify fallback, hay ghi nhận exclusion |

---

## 3. Gap nghiệm thu (implementation có, chưa có bằng chứng live trên tree cuối)

Các mục này **không phải lỗi đã repro**; cần chạy trên môi trường thật (DB/runtime/provider/browser)
trước khi tuyên bố hoàn thiện.

| ID | Cần nghiệm thu | Vì sao chưa đóng |
|----|----------------|------------------|
| E01 | Multi-user login qua nginx (không chỉ Vite), create + invite 3 role, 2 owner collision | Mới chạy qua Vite dev + Chromium; chưa dựng production nginx |
| E02 | Fresh planning → question → 8 docs → handoff → execution marker | Cần runtime + model thật với workspace riêng |
| E03 | Tool HITL allow/deny do runtime sinh | Chưa có runtime HITL trong môi trường test tách biệt |
| E05 | Scope removal/timezone/ROE-only window + runtime enforcement | Mới chạy subset approve/refuse HTTP |
| E06 | Schedule dispatch đúng giờ qua worker sau khi đóng browser/restart | Mới test race reschedule–claim trên DB |
| E07 | Upload/attach/download evidence bytes + provenance đầy đủ | Mới test four-eyes + edit-after-confirm |
| E08 | Report revision/conflict lifecycle đầy đủ | Mới test download digest + viewer download |
| E09 | Live Sliver/campaign provider (không dùng stand-in) | Provider chưa cấu hình trong môi trường tách biệt |
| E10 | Neo4j real topology + browser library proposal lifecycle | Mới test constraint PostgreSQL |
| E11 | Vault settings/closure end-to-end + audit actor-filter | Một phần đã test |
| E12 | Deployed UI/API restart, 53-route browser matrix, themes/keyboard, 5 performance samples | Chưa chạy trên production build |
| W27/W28 | Deployment runbook, preserved-data cutover/rollback, harness/ledger trung thực | Chưa đóng |

---

## 4. Nghiệm thu thủ công đề xuất (trước khi cải tiến)

Chạy theo thứ tự, ghi lại kết quả thực tế (không dùng test xanh thay thế):

1. **Khởi động Web** theo `docs/design/2026-10-15-web-completion-implementation-plan.md` §8.4
   (dev: API `npm run dev --workspace=@raptix/web-raptix-server`, UI với `VITE_DATA_MODE=real`).
2. **Multi-user**: login owner → invite operator/reviewer/viewer → xác nhận operator đọc được
   threads/C2 history, không cancel/reveal/approve được; gỡ membership rồi kiểm tra stream (R1).
3. **Create/Settings**: tạo project có brief; đổi display name qua Settings (PATCH phải 200).
4. **Report**: viewer tải report (phải tải được); owner tải qua editor (digest khớp DB).
5. **Dirty/save**: mở 2 form cùng lúc, sửa cả hai, thoát → Save Draft phải lưu cả hai (không mất draft).
6. **Session expiry**: để session hết hạn giữa lúc đang mở console → phải quay về sign-in.
7. **Governance**: preflight với thread đã bind plan hết hạn → `playbook` phải fail.
8. **Vault**: store → reveal → revoke; plaintext biến mất, không tái hiện sau reveal ACK muộn.

Ghi lại: URL, HTTP status, ID resource, ảnh chụp/digest, và chỗ lệch kỳ vọng. Các lỗi R1–R3 nên
được tái hiện thủ công trước khi quyết định fix.

---

## 5. Đã fix (tham chiếu, không cần làm lại)

- `094d67b` stop finalization CAS, workspace-stop báo failure thật, closure blocker (+`stopped`, library, schedule), scheduler claim/reschedule CAS.
- `4438545` member đọc runtime/C2, C2 pre-invoke nhả slot, TTL legacy clamp.
- `fc008bc` 401 reset gate, dirty guard trung thực, viewer download, create/settings contract, library version pin, inbox tasks.
- `3a4e4f1` reader download tạo file thật từ export.
- `961b857` W12 session→scope target mapping, W08 bound-assistant readiness.
- `279f3ba` W24 status/graph bounds, W25 vault actor.
- `5f0a3af` cancel/terminal-read authorization cho member.
- `884e872` preflight/vault/fleet/save/401 nhất quán.
