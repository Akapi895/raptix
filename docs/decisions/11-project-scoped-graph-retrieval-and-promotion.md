# 11. Nối truy xuất tham chiếu và finding của project qua graph API có giới hạn

## Bối cảnh

Hướng đi 4-graph đã được chấp thuận cần 1 bộ đọc tham chiếu và 1 cầu
nối theo từng project giữa quan sát runtime và finding bền vững.
Không Cypher tự do, không 1 bản sao thứ 2 của toàn bộ runtime graph,
nào là ranh giới phù hợp.

## Quyết định

Dùng template truy vấn cố định, có giới hạn, expose qua tool agent và
1 route HTTP runtime nội bộ. BFF xác thực operator và suy ra
engagement từ project đã lưu; runtime xác thực BFF bằng bearer token
runtime sẵn có. Token service cho phép BFF xuyên project, không phải
cho từng người dùng browser riêng lẻ.

Node tham chiếu chia sẻ Neo4j với AKG và Skillogy, chỉ dùng label Krg.
Loader dùng corpus YAML sẵn có và 1 manifest, không bao giờ dùng bên
ghi quan sát. Phủ các type group/software/campaign/ATLAS-tactic sẵn có
của corpus cũng như các label minh họa trong thiết kế; bản ghi không
được hỗ trợ bị báo lỗi.

Promotion đọc Neo4j và commit fact, snapshot bằng chứng bất biến có
giới hạn, và lịch sử xác minh nguyên tử trong Postgres. Revision
compare-and-set từ chối sửa đồng thời và chuyển trạng thái đồng thời.
Không có ghi Neo4j nào tham gia vào promotion.

Project có thể độc lập opt-in vào AutoIngest và TriedEdges bằng 2
boolean được lưu, cả 2 mặc định false. BFF đọc chúng từ bản ghi
project cho run streaming, đồng bộ, và batch; cờ gửi theo request
không override project. Việc assemble graph validate
`configurable.graph_toggles`, scope context assemble của nó theo đúng
run đó và ghi lại giá trị hiệu lực trong instance middleware. Thay đổi
cấu hình áp dụng cho run mới, kể cả 1 run mới trên thread đã có.
Execution không override theo project giữ nguyên default môi trường
hiện có. Các cấu hình này chỉ kiểm soát việc tự ghi AKG; tool graph thủ
công, truy xuất tham chiếu, Skillogy, và finding bền vững giữ nguyên
hành vi hiện có.

## Mô hình mối đe dọa

Nội dung từ scanner và tuyên bố do model viết vẫn là dữ liệu không tin
cậy. Parse chỉ chứng minh hình dạng, không chứng minh sự thật. Kênh
ghi runtime do server sở hữu; ghi tin cậy thấp hơn không thể ghi đè
node/quan hệ do tool sinh ra. Label dự trữ, field danh tính, output
thô, và giá trị credential được bảo vệ. Text graph trả về là dữ liệu,
không bao giờ là chỉ thị hệ thống. Truy vấn scope mọi node/quan hệ đi
qua và giới hạn độ sâu, kích thước kết quả, và thời gian transaction.
Snapshot bằng chứng giữ đúng phiên bản đã review sau khi AKG xóa; 1
node mới tạo cùng key có danh tính quan sát khác. Guard RoE và thực
thi hiện có vẫn là thẩm quyền cho hành động. AutoIngest và TriedEdges
vẫn opt-in. Học xuyên project bị loại trừ.

## Hệ quả

- Ranh giới HTTP và lưu trữ mới có test chức năng tập trung.
- Migration Neo4j và Postgres chỉ cộng thêm phải deploy trước khi
  dùng tính năng này.
- 1 graph thiếu/không khả dụng là 1 lỗi rõ ràng, không phải 1 lần
  import thành công rỗng.
- Context graph nhỏ được dựng lại theo từng request model, kể cả
  resume và compaction; truy xuất chi tiết là theo yêu cầu.

## Phương án đã xem xét và loại bỏ

- Cypher tự do: loại vì chỉ giới hạn kết quả không đủ giới hạn phạm
  vi hay khối lượng công việc.
- Ghi đôi runtime-to-Postgres: loại vì promotion cần đúng 1 chủ sở
  hữu bền vững.
- Chặn injection chỉ bằng revision: loại vì system message không tồn
  tại lâu dài.
