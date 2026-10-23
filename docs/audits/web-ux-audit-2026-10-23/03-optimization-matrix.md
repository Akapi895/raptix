# 03 · Optimization Matrix — KEEP / IMPROVE / MERGE / REMOVE / ADD

Mỗi dòng ghi lý do, bằng chứng (UX-ID) và ảnh hưởng. "Quick Win" nghĩa là được xử lý trong giai đoạn 2 nếu an toàn; "Structural" nghĩa là ngoài phạm vi quick win.

| Tính năng / bề mặt | Đề xuất | Lý do | Bằng chứng | Ảnh hưởng | Phạm vi |
|---|---|---|---|---|---|
| Overview toàn cục | IMPROVE | KPI không định nghĩa; 4/6 KPI; "Not recorded" mâu thuẫn với dự án; jargon | UX-12, UX-14 | Dashboard chính đáng tin hơn | Quick Win (copy) + Structural (KPI, mật độ) |
| Projects (portfolio) | IMPROVE | Cột "—"; KPI Metadata hiển thị 0 giả; chip và KPI Active lệch | UX-13, UX-26 | Bảng khớp lời hứa, không có số 0 giả | Quick Win |
| Findings (global) | KEEP | Danh sách xuyên dự án, bộ lọc project, đếm đúng, AI suggestion không tính | `B05` | Giữ; real `[NV]` | — |
| Findings (tab trong project) | MERGE | Bố cục khác với Findings trong project | UX-10 | Một component | Structural |
| Assets | KEEP | Có trong cả hai mode; chưa kiểm sâu | UX-06 (nav) | — | — |
| Capabilities (tên "Library" trong copy) | IMPROVE | Ba tên cho một khu vực; semantics chưa chốt | UX-14, checklist D-02 | Từ vựng thống nhất | Quick Win (copy); Structural (semantics) |
| Infrastructure và "Sessions" (C2) | MERGE | C2 ở ba nơi; alias `c2` → Infrastructure | UX-11 | Một đường tìm | Structural |
| Tasks & Approval Inbox | MERGE + ADD | Không có mục sidebar; bốn CTA; ba tên | UX-08 | Một inbox quyết định | Structural (cần quyết định sidebar) |
| Team & Approvals (tab project) | IMPROVE | Trộn quản lý thành viên và approval | UX-08 | Tách trách nhiệm | Structural |
| Ask AI (drawer) | MERGE hoặc REMOVE | Trùng AI Workspace | UX-09 | Một luồng AI | Structural (cần quyết định) |
| AI Workspace | KEEP | Layout và vòng đời tool call tốt | `B03`, `B09` | Cải thiện tên agent và mật độ panel | Structural (nhỏ) |
| Plans / Planning | MERGE | Hai feature cho một khu vực | UX-09 | Một mục, nhiều sub-view | Structural |
| Operations | KEEP | Có CTA "Create Operation" rõ; luồng chính có | `B02` | — | — |
| Emergency Stop (header) | KEEP | Control an toàn nên luôn nhìn thấy; dialog có xác nhận | UX-24 | Giữ nguyên hành vi | Không đổi |
| Chuông thông báo | MERGE | Trùng decision queue | UX-08 | Một model "cần chú ý" | Structural |
| Workspace switcher (header) | KEEP ở mock; không áp dụng ở real (đính chính) | Chỉ mount ở mock (`shell/shell.tsx:168`); real dùng `RealTopbar`, không có switcher giả | UX-01 (đính chính) | Không đổi real | Không cần việc |
| Demo Tools (menu profile) | KEEP ở mock; không áp dụng ở real (đính chính) | Chỉ mount ở mock; real không có persona, Reset demo hay outcome giả. Copy đã đổi thành "Demo mode only" | UX-01, UX-02, UX-03 (đính chính) | Copy đúng sự thật ở mock | Quick Win (đã làm, `2b28c3b0`) |
| Prototype Home / Scenarios | REMOVE khỏi bản build mặc định | Nội dung prototype | UX-05 | Giảm bề mặt | Quick Win (gate bằng cờ) |
| States (gallery QA) | REMOVE khỏi bản build mặc định | Nội dung QA "Not click-tested" | UX-05 | Giảm bề mặt | Quick Win (gate bằng cờ) |
| Workspaces (route chỉ gõ URL) | REMOVE khỏi bản build mặc định | Trùng với switcher giả; không có backing multi-workspace | UX-01, checklist D-04 | Giảm bề mặt | Quick Win (gate bằng cờ) |
| Settings (tổ chức) | IMPROVE | Chuỗi demo ở real; "Organization" và "Project Settings" dễ nhầm | UX-01, UX-27 | Đúng nhãn và phạm vi | Quick Win (chuỗi); Structural (đổi tên) |
| Project Settings (real) | KEEP; đổi tên rõ phạm vi | Tên gần với Settings tổ chức | §3 feature inventory | — | Structural |
| Activity & Audit | KEEP | Có vai trò rõ | — | Thống nhất tên | Structural (nhỏ) |
| Closeout | KEEP | Có vai trò rõ | — | — | — |
| Asset Map (cờ) | KEEP (giữ cờ) | Chưa đủ bằng chứng để mở | `nav.ts:105` | — | — |
| Attack Analysis (real) | DECIDE | Có thể gộp vào Results | UX-06 | Cần contract | Structural |
| Đăng nhập mock | KEEP (đính chính) | Luồng hoạt động: Continue → "Verifying…" → chọn tổ chức → vào workspace. Chỉ cần ghi chú: thông báo sai mật khẩu in mật khẩu demo | UX-23 (đính chính), S-03 | Demo mở được | Follow-up S-03 (cần quyết định) |
| Mục "Switch to demo mode" (menu tài khoản real) | DECIDE | Chủ đích sản phẩm; có copy cảnh báo | UX-04 | Cần chủ sản phẩm | Không tự gỡ |
| **ADD** Aggregate read-only "Running operations" trên Overview | ADD (có lý do) | Project đã có dữ liệu; Overview ghi "Not recorded" | UX-12 | Overview đúng với project | Structural |
| **ADD** Trạng thái "Not recorded" cho KPI thiếu nguồn | ADD (nhỏ) | Không gán 0 khi không có nguồn | UX-26 | Số liệu trung thực | Quick Win |

Không đề xuất thêm tính năng nào khác trong giai đoạn này: chưa có bằng chứng nhu cầu cho các mục khác.
