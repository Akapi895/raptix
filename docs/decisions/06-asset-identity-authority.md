# 6. Thẩm quyền danh tính asset và asset ID xác định (deterministic)

## Bối cảnh

Hiện tại asset được định danh theo 3 cách khác nhau: kho Web dùng
`WebAsset.id` (dạng cuid), graph Web dùng `elementId` của Neo4j, còn
knowledge graph runtime dùng `sha1(kind::key)` trên bất kỳ label nào
bên ghi đưa vào. Vì vậy 2 bên ghi cùng mô tả 1 host có thể tạo ra 2
asset khác nhau, và `elementId` của Neo4j đổi mỗi khi graph được build
lại. Runtime phải tiếp tục ghi quan sát ngay cả khi Web server đang
down, nên danh tính không thể phụ thuộc vào 1 lệnh gọi đồng bộ tới Web.

## Quyết định

1. **Thẩm quyền.** PostgreSQL (Prisma, do server Fastify sở hữu) giữ
   catalog asset: metadata danh tính, tên hiển thị, lifecycle và ràng
   buộc phạm vi. Neo4j giữ quan hệ quan sát được và tham chiếu bằng
   chứng trỏ tới ID trong catalog. Artifact giữ byte thô.
2. **`assetId` xác định (deterministic).** `assetId` được tính bởi 1
   hàm duy nhất trong `raptix_core` từ `(engagement, kind, namespace,
   canonicalKey, keyVersion)`, trong đó `engagement` là key phân vùng
   của KG (slug workspace mà runtime ghi làm `engagement`), không phải
   `Engagement.id` của Web. Runtime ghi ID đó cùng các phần của nó
   (`asset_kind`, `asset_namespace`, `asset_canonical`,
   `asset_key_version`) lên mọi node KG mang asset, nên phía Web không
   bao giờ phải tự parse key đã ghép. Catalog Web nhận ID sau khi tính
   lại và không bao giờ phát ID mới, nên 2 bên không cần round-trip để
   đồng thuận về danh tính.
3. **Canonical key được chuẩn hóa theo kind.** Địa chỉ IP dùng dạng
   nén. Tên DNS viết thường, không có dấu chấm cuối. Web origin giữ
   scheme, host và port hiệu lực; chúng là asset riêng, tách khỏi host
   của mình. Namespace mang context khiến key duy nhất (context network
   cho IP, provider/account cho cloud, platform/package cho mobile).
4. **Reconcile là upsert idempotent.** Web server đọc node KG mang
   `assetId`, upsert catalog theo key là ID đó, và ghi lại những gì
   không khớp được. Chạy lại cùng input không tạo dòng mới. Không có
   transaction phân tán trải qua cả PostgreSQL và Neo4j; 1 lần
   reconcile lỗi được thử lại từ graph.
5. **Versioning.** `ASSET_KEY_VERSION` là 1 phần của key. Đổi cách
   chuẩn hóa thì tăng version và thêm 1 alias từ ID cũ, thay vì âm
   thầm đổi danh tính.

## Hệ quả

- Không cần thêm identity service, message broker, hay ghi KG đồng bộ
  với Web.
- 2 bên ghi cùng chuẩn hóa 1 locator sẽ đồng thuận về ID mà không cần
  phối hợp.
- `WebAsset` giữ nguyên như hiện tại. Migration chỉ cộng thêm và việc
  mapping được báo cáo, không đoán (xem phase 2 của plan).
- Đổi cách suy ra ID hoặc `ASSET_KEY_VERSION` là thay đổi phá vỡ mọi
  `assetId` đã lưu, và phải đi qua 1 ADR mới.

## Phương án đã xem xét và loại bỏ

- **Runtime tự phát ID ngẫu nhiên, reconcile vào catalog sau.** Loại:
  2 bên ghi cùng 1 asset sẽ cần 1 bước merge trước khi đồng thuận
  được.
- **Neo4j làm thẩm quyền danh tính.** Loại: quyền sở hữu nghiệp vụ
  Web và ràng buộc phạm vi phải sống trong kho quan hệ sở hữu chúng.
- **Gọi Web đồng bộ trước mỗi lần ghi KG.** Loại: quan sát phải được
  ghi lại ngay cả khi Web server không khả dụng.

## Bổ sung: key version 2 (2026-10-20)

Version 1 ghép field bằng `:` và `\x1f`, nên `(namespace="a:b",
canonicalKey="c")` và `(namespace="a", canonicalKey="b:c")` cho ra
cùng 1 danh tính. Version 2 viết mỗi field dạng
`<độ dài byte UTF-8>:<giá trị>` trước khi hash, ở cả
`raptix_core.types.asset.asset_id` và `assetIdFor` phía Web server, và
`ASSET_KEY_VERSION` thành 2. Không có danh tính version-1 nào từng vào
catalog đã lưu ngoài các engagement phát triển (đã bị xóa), nên không
cần migration danh tính. Thay đổi sau này theo đúng quy tắc: tăng
version và ghi lại ở đây.

## Bổ sung: danh tính tại biên ghi KG (2026-10-21)

Bên ghi tới graph qua 4 đường: adapter cũ
(`knowledge/graph/ingest.py`), registry parser
(`knowledge/ingest/parsers`, dùng cho auto-ingest subfinder, dnsx,
ffuf, masscan và gobuster), tool agent (`kg_record`, `kg_ingest`), và
shim graph cũ (`research/_state.py`). Chỉ đường đầu tiên đóng dấu danh
tính, nên quyết định 2 chưa được thỏa với 3 đường còn lại. Quy tắc giờ
sống trong `KGStore.record_observations`, điểm vào duy nhất mọi bên
ghi dùng:

- 1 node Host hoặc Entrypoint chưa có `asset_id` nhận danh tính từ
  locator của mình: hậu tố key trước (`host::`, `entrypoint::`), rồi
  property `ip` hoặc `url`. 1 node mà locator không resolve được thì
  ghi không có danh tính, đếm vào kết quả là `unidentified`.
- Key, label, property `url` của Entrypoint và target cạnh gọi tên 1
  entrypoint được redact bằng `redact_url` trước khi ghi. 1 key không
  bao giờ giữ userinfo, fragment, hay giá trị query nhạy cảm.
- 1 node đã có `asset_id` thì giữ nguyên. Ingest đóng dấu đúng cùng
  danh tính, nên adapter không có gì thay đổi.
- Quy tắc chuẩn là quy tắc trong `asset_identity.py` (IPv4 dạng nén;
  tên DNS viết thường, không dấu chấm cuối; origin ghi rõ port mặc
  định). Catalog Web mirror quy tắc này cho định danh WebAsset kind
  `host` duy nhất (`catalogIdForWebAsset`); kind khác vẫn chưa liên
  kết.

**Vì sao:** quyết định 2 yêu cầu runtime ghi danh tính lên mọi node
mang asset, mà đường registry và đường agent chưa làm vậy. **Phương
án bị loại:** từ chối Host và Entrypoint từ `kg_record`. Việc đó mất
quan sát của agent, và quy tắc nên nằm trong code, không nằm trong
prompt của agent. **Hệ quả:** label AD (AD_USER, AD_COMPUTER và các
label còn lại) vẫn ngoài catalog cho tới mapping phase 7; coverage
matrix ghi rõ điều này.
