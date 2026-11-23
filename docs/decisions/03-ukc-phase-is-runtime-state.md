# 3. Phase UKC là state runtime, không phải cấu trúc thư mục

## Bối cảnh

Unified Kill Chain nhóm hoạt động thành 3 macro-phase: initial
foothold, network propagation, action on objectives. Một cách migrate
ngây thơ sẽ tổ chức repo thành 3 cây thư mục `initial_foothold/`,
`network_propagation/`, `action_on_objectives/`. Cách đó hard-code
phase vào cấu trúc vật lý: agent và skill trải qua nhiều phase, 1
capability (ví dụ credential access) phục vụ nhiều phase, và mỗi lần
phân loại lại trở thành việc di chuyển code thay vì chỉ sửa metadata.

## Quyết định

Phase sống dưới `orchestration/phases/` chỉ như state runtime:

- `UKCPhase` — đúng 3 thành viên với slug ổn định
  (`initial_foothold`, `network_propagation`, `action_on_objectives`)
  dùng luôn làm từ vựng metadata `ukc_phases` cho skill,
- `PhaseStateMachine` — state theo từng engagement với lịch sử chuyển
  đổi có giới hạn, triển khai ở **shadow mode**: chuyển đổi bị từ chối
  thì chỉ ghi lại và log, không có gì trong runtime chặn theo đó,
- `PhasePolicy`/`DefaultPhasePolicy` — chuyển đổi là quyết định chính
  sách (mặc định: tiến hoặc giữ nguyên, không bao giờ lùi), không phải
  control flow hard-code,
- `PhaseTransition` — bản ghi audit bất biến,
- helper slug chia sẻ với metadata skill để W8 validate được entry
  `ukc_phases` mà không cần import nội bộ framework.

Agent, skill và tool vẫn tổ chức theo capability/domain. Bộ module chỉ
dùng stdlib này không import framework nào, và chưa có gì khác trong
runtime import nó.

## Hệ quả

- Phân loại lại 1 hoạt động qua phase khác là 1 thay đổi metadata
  (W8), không bao giờ là di chuyển file.
- Việc gate theo phase (chặn/cắt bớt) vẫn ngoài phạm vi cho tới khi 1
  chính sách được benchmark; enforcement chỉ có thể chạm tới bằng cách
  bật `shadow=False` ở 1 wave sau, được review riêng.
- Contract phase có thể lên hạng vào `raptix_core.types` khi plugin
  ngoài cần tới; module runtime vẫn là chủ sở hữu orchestration.
