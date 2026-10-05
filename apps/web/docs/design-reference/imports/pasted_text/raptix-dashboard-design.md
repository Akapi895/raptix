Thiết kế một web app dashboard cho sản phẩm “Raptix” — nền tảng hỗ trợ pentest / red team có kiểm soát, nơi con người điều phối và giám sát agent AI trong suốt một security engagement.

1) Mục tiêu sản phẩm

Raptix là một nền tảng giúp pentester, security lead và stakeholder:

tạo và quản lý các project pentest/red team,
chat với root agent,
theo dõi subagent được spawn,
kiểm soát orchestrator, skills và MCP/tools,
theo dõi phase và tiến độ,
xem log / tool output,
quản lý credentials,
lưu assets và findings,
xử lý các bước HITL (human-in-the-loop) cho các hành động rủi ro cao.
2) Phong cách thiết kế

Tạo giao diện theo phong cách:

Modern SaaS dashboard
Cybersecurity / enterprise / professional
Clean, high trust, minimal but powerful
UI rõ ràng, có cấu trúc, nhiều thông tin nhưng không rối
cảm giác “AI-assisted security operations center”, nhưng vẫn thân thiện để thao tác hằng ngày.
3) Tone màu

Sử dụng tone chủ đạo:

Primary Red: #EE0033
White: #FFFFFF

Màu phụ trợ nên tinh tế để tăng khả năng đọc:

Dark text / heading: #111111 hoặc #1F2937
Light background section: #F8F9FB
Border / divider: #E5E7EB
Success: #16A34A
Warning: #F59E0B
Critical / risk highlight: dùng biến thể của đỏ chủ đạo

Yêu cầu:

màu đỏ #EE0033 dùng làm accent chính cho button primary, trạng thái active, highlight, chip, progress emphasis, card emphasis.
nền tổng thể sáng, sạch, ưu tiên white-first UI.
tránh làm UI quá nặng hoặc quá “gaming”.
4) Bố cục tổng thể

Thiết kế theo desktop web app, responsive-first nhưng ưu tiên canvas desktop 1440px.

Cấu trúc chính:

Left sidebar navigation
Top header
Main content area
Các màn hình dùng cards, tables, tabs, chips, timeline, log panels

Sidebar gồm:

Projects
Overview
Chat
Orchestrator
Phases
Logs / Tool Output
Credentials
Assets
Findings
Settings

Topbar gồm:

tên project hiện tại
scope/status badge
search
notifications
user profile / team access
quick action button “New Chat”
5) Thiết kế system / component style

Tạo design system sơ bộ gồm:

typography hierarchy rõ ràng
button variants: primary / secondary / ghost / danger
badges: active / pending / blocked / completed / needs approval
cards
tables
tabs
input / search / dropdown / modal
timeline / stepper / progress bar
activity feed
approval modal for HITL
chat bubbles / agent panels / subchat accordion

Style chi tiết:

bo góc vừa phải: 10–14px
shadow nhẹ, hiện đại
spacing thoáng
icon line style hiện đại
cards có phân cấp rõ, không quá nhiều màu
6) Các màn hình chính cần vẽ
A. Project List

Thiết kế màn hình danh sách project:

danh sách các pentest engagements
mỗi card/project row có:
project name
target/scope summary
role của user
status
số findings
số assets
số chats
số agents
thành viên chính
có nút “Create Project”
có bộ lọc theo status / role / recent activity
B. Project Overview

Thiết kế màn hình overview cho một project:

project objective
scope summary
project status
team members
phase progress overview
số lượng agents đã spawn
số findings
số assets
recent logs / recent activity
cards tổng quan dạng executive summary
C. Chat (Root Agent + Sub-chat)

Đây là màn hình trọng tâm.
Thiết kế giao diện chat gồm:

khung chat chính với root agent
bên dưới hoặc cạnh bên hiển thị subagent tree / sub-chat list
thể hiện rõ root agent có thể spawn nhiều subagent
mỗi subagent có:
name
current task
status
last activity
cho phép user click vào từng sub-chat để tiếp tục gửi query trực tiếp
có panel bên phải hiển thị:
agent info
attached skills
MCP/tools đang dùng
quick outputs / artifacts

Yêu cầu trải nghiệm:

cảm giác đây là AI orchestration workspace, không chỉ là một chat app thông thường
cần hiển thị được mối quan hệ root chat → sub-chat một cách trực quan
D. Orchestrator

Thiết kế màn hình điều phối agent:

overview số lượng agents
trạng thái từng agent
quan hệ cha-con giữa root agent và subagent
skills gắn cho agent
MCP/tools gắn cho agent
actions: attach / detach skill, enable / disable MCP, inspect task
có thể dùng tree view hoặc node-based card layout nhẹ nhàng
E. Phases

Thiết kế màn hình quản lý phases:

phase list / timeline
ví dụ các phase: intake, reconnaissance, assessment, exploitation, post-exploitation
mỗi phase có:
status
progress
owner/agent
logs summary
checkpoint
thể hiện rõ phase nào cần HITL approval
có checkpoint cards nổi bật cho action nguy hiểm
F. Logs / Tool Output

Thiết kế màn hình quan sát execution:

live activity feed
log table / terminal-like viewer
tool invocation history
output detail panel
filter theo agent / phase / tool / time
hỗ trợ xem trace từng bước
thẩm mỹ giống observability / debugging panel nhưng dễ đọc
G. Credentials

Thiết kế màn hình quản lý credentials:

list credentials trong project
loại credential: username/password, token, session, cookie, API key
status / last rotated / owner
actions: add / view / rotate / revoke
nhấn mạnh tính bảo mật, không hiển thị secret quá lộ liễu
H. Assets

Thiết kế màn hình assets:

bảng hoặc card list các tài sản phát hiện được
ví dụ hostname, subdomain, URL, endpoint, IP, service
có severity / type / source / related findings
có search, filter, tags
I. Findings

Thiết kế màn hình findings:

list findings theo severity
mỗi finding có:
title
severity
affected asset
evidence summary
status
reviewer
có chi tiết finding side panel hoặc detail page
nhìn chuyên nghiệp, phục vụ review và reporting
J. HITL Modal / Approval Flow

Thiết kế một modal hoặc checkpoint UI cho Human-in-the-Loop:

cảnh báo action rủi ro cao
mô tả hành động agent muốn thực hiện
lý do / bối cảnh / liên quan phase nào
nút:
Approve
Reject
Ask for more detail
visual mạnh, rõ ràng, dùng đỏ nhấn rủi ro
7) Trải nghiệm mong muốn

Ưu tiên UX như sau:

dễ theo dõi một chiến dịch pentest từ đầu tới cuối
dễ hiểu mối liên hệ giữa chat, agent, phase, logs, findings
dễ kiểm soát AI thay vì để AI chạy “mù”
thể hiện được tính “controlled offensive security platform”
cân bằng giữa cảm giác kỹ thuật sâu và giao diện SaaS chuyên nghiệp
8) Deliverables

Tạo:

1 design system sơ bộ
1 dashboard overview
1 chat screen chi tiết
1 orchestrator screen
1 phases screen
1 logs screen
1 assets screen
1 findings screen
1 credentials screen
1 HITL modal/state
9) Từ khóa thẩm mỹ

Dùng các keyword:

clean enterprise cybersecurity dashboard
modern SaaS
AI orchestration workspace
red and white brand identity
structured information hierarchy
trust, control, visibility, auditability
minimal but powerful