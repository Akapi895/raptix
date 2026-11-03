# Runbook: project environments, một project active (ADR-0092)

Trạng thái: bản nháp theo kết quả kiểm chứng đến 2026-10-19. ADR-0092 vẫn là `Proposed`. Chưa có release gate nào được ký.

## 1. Khởi động controller trên host

Controller là lệnh của launcher, chạy trên host, chỉ lắng nghe loopback.

```
raptix-launcher environment-controller \
  --listen 127.0.0.1:9100 \
  --token-file <file chứa token, tối thiểu 32 byte> \
  --workspace-root <thư mục gốc chứa mọi workspace project> \
  --management-network <network đã tồn tại mà runtime tham gia> \
  --images <ref@sha256:..., phân tách bằng dấu phẩy> \
  --runtime-env-file <file KEY=VALUE, chỉ các biến trong allowlist>
```

- Lệnh bind cổng trước, rồi mới in `listening`. Nếu cổng đã bị tiến trình khác giữ, lệnh thoát với lỗi bind.
- Dừng controller không dừng container môi trường. Container được giữ nguyên và controller nhận lại khi khởi động.
- Container API gọi controller qua `host.docker.internal`. Token chỉ được mount vào container API.

Thư mục gốc phải tồn tại. Thư mục workspace của từng project được tạo khi activate lần đầu, bên trong gốc đó.

## 2. Vòng đời project

| Lệnh | Điều kiện | Kết quả |
|---|---|---|
| activate | Slot rỗng, project chưa archive | `starting` → `ready` khi cả hai container chạy, health tốt và runtime trả lời `/ok` |
| stop | Project đang giữ slot | Chờ run đang chạy kết thúc (drain). Hết timeout thì quay về `ready`, lý do `run_active` |
| archive | Project không giữ slot và môi trường đã dừng | Giữ dữ liệu, chặn activate và run |
| unarchive | Project đang archive | Cho phép activate lại |

Trạng thái chuyển tiếp (`starting`, `stopping`) được ghi vào row ngay khi slot đổi. Client hỏi lại trạng thái cho tới khi ổn định.

Khi API khởi động lại giữa lúc activate hoặc stop, tiến trình được tiếp tục từ những gì slot ghi nhận.

## 3. Đọc lý do khi thất bại

`lastError` của project là mã ngắn, không phải thông báo tự do. Các mã đã gặp:

| Mã | Ý nghĩa | Hành động |
|---|---|---|
| `rejected_path` | Đường dẫn workspace nằm ngoài root, hoặc root không tồn tại | Kiểm tra `--workspace-root` và quyền thư mục |
| `image_missing` | Image chưa có trên máy | Pull image theo digest đã pin, rồi activate lại |
| `rejected_image` | Image không nằm trong danh sách digest | Kiểm tra `--images` |
| `foreign_resource` | Tên container trùng với tài nguyên không thuộc môi trường này | Điều tra trước khi xóa, không xóa tự động |
| `generation_mismatch` | Container còn ở generation khác | Hệ thống tự recreate khi dừng |
| `not_ready` | Không sẵn sàng trong thời gian chờ | Xem log container runtime |
| `controller_unreachable` | Controller không trả lời | Kiểm tra controller đang chạy |
| `run_active` | Stop bị hoãn vì còn run | Đợi run kết thúc, rồi stop lại |

Lệnh `stop` bị hoãn vẫn được ghi trong `EnvironmentCommand` với outcome `refused`.

## 4. Orphan (chỉ đọc)

```
raptix-launcher environment-orphans --deployment <id> --known-file <file id môi trường còn biết>
```

Lệnh in JSON các container của deployment mà môi trường không còn được biết. Nó không xóa gì. Quyết định xóa là của người vận hành, sau khi đã đối chiếu với báo cáo.

## 5. Migrate một project legacy (I07)

Công cụ: `apps/web/server/scripts/legacy-migration/migrate_legacy_project.py`.

Quy trình đã kiểm chứng trên `reddish`:

1. Xuất danh sách thread id của project từ DB web (chỉ đọc) ra JSON.
2. `dry-run` từ snapshot chỉ đọc (volume state và workspace của runtime legacy) vào một thư mục đích mới. Kết quả là `report.json` với số dòng, hash, và `verified`.
3. Dừng môi trường đích. Môi trường phải có store, tức là đã từng khởi động ít nhất một lần.
4. `apply` ghi các dòng checkpoint và workspace vào store và thư mục đích. Từ chối nếu dry-run chưa verified, schema khác, hoặc thread đã có lịch sử.
5. `unapply` gỡ đúng những gì `apply` đã ghi.
6. `rollback` xóa thư mục đích, chỉ khi có marker của dry-run.

Lưu ý:

- Snapshot chưa quiesce: runtime legacy vẫn chạy khi chụp. Cutover thật cần dừng nguồn và cần duyệt riêng.
- Các file pickle toàn cục (`.langgraph_ops.pckl`, `store.pckl`, ...) không được copy. Bản ghi thread nằm ở đó, nên thread chưa đọc được trong môi trường. Xem mục 12 của bản ghi thiết kế.
- Thread có cấu hình legacy bị từ chối trong môi trường (409). Đây là guard đúng, cho tới khi có quyết định rebind.

## 6. Chẩn đoán

- Trạng thái và lý do của project: `GET /api/engagements/<id>/environment`, trường `environment.lastError`.
- Lệnh gần nhất và lý do: bảng `EnvironmentCommand`.
- Log controller: dòng `docker ... failed` là chẩn đoán của người vận hành. Lỗi trả về client luôn là mã ngắn.
- Container môi trường: `docker ps -a --filter label=raptix.deployment=<id>`.

## 7. Không làm

- Không dùng `docker compose down -v` hoặc `make clean` trên deployment đang dùng.
- Không xóa volume state của môi trường. Nó chứa lịch sử của project.
- Không chạy migrate trên DB và volume thật mà chưa có duyệt riêng và bản backup đã kiểm restore được.
