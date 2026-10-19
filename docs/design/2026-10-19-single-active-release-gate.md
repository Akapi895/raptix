# Release gate: project environments, một project active (I09, bản nháp)

Trạng thái ngày 2026-10-19. Gate nào chưa đạt thì release bị chặn. Tài liệu này không tự ký gate nào. ADR-0092 và
ADR-0093 vẫn là `Proposed`.

| Gate | Yêu cầu | Trạng thái | Bằng chứng / thiếu |
|---|---|---|---|
| G1 Activate/stop trên Docker thật | Lifecycle đầy đủ trên container | Đạt một lần trên bản sao | Copy `reddish`, nhiều chu kỳ |
| G2 Admission một winner | Hai client cùng activate, một thắng | Đạt | Admission live 14 nhóm |
| G3 Stop chờ run và instance | Không cắt công việc đang chạy | Đạt (runtime status giả) | Recovery nhóm 2, 6, 7, 8 |
| G4 Restart giữa stop | Tiếp tục hoặc quay về an toàn | Đạt | Recovery nhóm 5 |
| G5 Lưu trữ qua restart runtime/sandbox (E06) | Dữ liệu còn nguyên | Đạt một lần trên bản sao | 75 tin nhắn giữ nguyên |
| G6 Crash controller khi start | Slot không `ready` giả | Đạt một lần trên bản sao | `uncertain`, owner reconcile |
| G7 Restart khi slot ready mà container mất | Không `ready` giả | Đạt (test) | Recovery nhóm 9 |
| G8 Rebind thread lịch sử | Operator, fail-closed, có audit | Đạt (unit + một lần live) | Unit 9/9, E2E 3 thread |
| G9 Migration dry-run/apply/unapply | Verify, rollback | Đạt trên bản sao | Unit 6/6, E2E `reddish` |
| G10 Cutover dữ liệu thật | Backup, quiesce, rehearsal, rollback, duyệt từng bước | **Chưa làm** | Chờ xác nhận |
| G11 P10/P11 đầy đủ | Mailbox/grant, checkpoint/question | **Chưa làm** | Ngoài phạm vi đã chốt |
| G12 Bộ restart/crash đầy đủ | Nhiều kịch bản, nhiều lần lặp | **Chưa làm** | Chỉ có một lần mỗi loại |
| G13 Server suite | Toàn bộ pass | Đạt (511/511, một worker) | Chạy sau thay đổi cuối |
| G14 Compose/installer | ADR + packaging + test WSL/Linux | **Chưa làm** | ADR-0093 nháp, chưa duyệt |
| G15 Thread và CLI/Web cùng project sau migration | Mở cùng project và thread | **Chưa làm** | Chờ G10 |
| G16 Upgrade và rollback của DB | Migration additive, rehearsal rollback | **Chưa làm** | Migration additive đã áp trên bản sao |

Điều kiện để chuyển ADR-0092 sang Accepted: G10, G12, G14 (nếu giữ trong phạm vi), G15 và G16 đạt. Người quyết định
là maintainer.
