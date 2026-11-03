# Kế hoạch thực thi Structural (vòng 4)

Base commit: `d3225f63` (chỉ tài liệu trên mã `56a29e1a`). Nhánh `frontend`.
Phạm vi: WS-0, WS-1, WS-4A, WS-2, WS-4B, WS-3 theo `../structural-plan/`.
Quy tắc: `CLAUDE.md` gốc (không `Co-Authored-By`, diff ≤ 400 dòng runtime và ≤ 10 file mỗi commit), `apps/web/AGENTS.md`, `CONTRIBUTING_AGENT.md`.

## Ràng buộc không được vượt

- Không đổi authentication, authorization, API contract ngoài phạm vi có ADR.
- Không chạy `npm run build` ghi vào `apps/web/dist`. Build thử dùng `vite build --outDir` trong scratchpad.
- Không khởi động lại, không gửi tín hiệu tới dev server của owner (cổng 5273).
- Không đụng container/image/3001 đã deploy trong phiên này. Không tạo tài khoản trên 3001.
- Không chạy lệnh C2 thật, không listener thật, không Emergency Stop thật, không payload.
- Không sửa `GLOSSARY.md`, không nâng ADR Proposed lên Accepted.
- Không `git add -A`, không `reset --hard`, không `clean`. Stage đúng file của phiên.
- Không dùng sub-agent cho việc sửa cùng file.

## Dependency graph đã kiểm trên mã

```
WS-0 (cache/storage theo actor)           độc lập
WS-1 (navigation một bảng)                độc lập với WS-0; alias giữ nguyên
WS-4A (measures + provenance)             độc lập; đọc port hiện có
WS-2 (decision read model)                cần kiểm kê nguồn; server aggregate chỉ khi cần
WS-4B (layout Overview)                   cần WS-4A; phần Decisions cần WS-2
WS-3 (C2 workspace)                       cần ADR-0095/0098/0099 được chấp thuận cho phần ghi;
                                          phần đọc và tổ chức presentation làm được trước
```

Thứ tự thực tế: WS-0 → WS-1 → WS-4A → WS-2 → WS-4B → WS-3. Điều chỉnh nếu kiểm kê cho thấy phương án khác ít rủi ro hơn.

## Mốc baseline (lấy từ `../verification/results/final-acceptance/`)

- Typecheck, lint, boundary, test, build mặc định và build bật cờ: exit 0 tại `56a29e1a`.
- Test: 183 file, 1616 test.
- Boundary: ratchet theo `tools/boundaries-baseline.json` (tổng 411).
- Route smoke mock: 56/56, cả hai cấu hình cờ.
- Route smoke real trên stack có graph: 42 pass, 14 ngoại lệ môi trường khai báo.

## Cách làm mỗi thay đổi

DISCOVER → CHARACTERIZE (test trước khi đổi) → IMPLEMENT → TEST đích → typecheck, lint, boundary → review diff → commit có một concern → cập nhật PROGRESS, VERIFICATION-LOG, RESUME.
