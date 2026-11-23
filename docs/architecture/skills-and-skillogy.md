# Skills và Skillogy

Raptix có một corpus kỹ năng dạng văn bản (`SKILL.md`) — mỗi file là một
"cẩm nang" cho một kỹ thuật cụ thể (lệnh mẫu, khi nào dùng, ánh xạ MITRE
ATT&CK, cảnh báo OPSEC). Corpus này được đọc theo 2 cách hoàn toàn khác
nhau tùy backend: nạp tĩnh theo đường dẫn thư mục (`SkillsMiddleware`,
mặc định khi không có Neo4j) hoặc tra cứu qua graph có ranking
(`SkillogyMiddleware`, mặc định khi có Neo4j — xem dưới).

## Nạp theo 3 cấp (progressive disclosure)

| Cấp | Nạp gì | Chi phí token | Khi nào |
|---|---|---|---|
| 1 | Chỉ `name` + `description` trong frontmatter | ~50-100 | Lúc agent khởi tạo — tiêm vào system prompt cho mọi skill liên quan |
| 2 | Toàn bộ nội dung `SKILL.md` | ~500-2000 | Agent gọi `load_skill()` sau khi thấy skill liên quan |
| 3 | Tài liệu trong `references/` | tùy | Agent đọc thêm khi thân skill yêu cầu |

Agent chỉ thấy frontmatter ban đầu; chỉ khi khớp mô tả mới nạp toàn văn —
giữ context nhỏ mà vẫn có kiến thức sâu khi cần. `load_skill()` nhận
đường dẫn tuyệt đối (`/skills/standard/recon/passive-recon/SKILL.md`),
tương đối, hoặc slug (`passive-recon`) — slug không rõ ràng thì trả về
danh sách, không tự đoán.

## Cây thư mục skill

Ba gốc dưới `/skills/`: `standard/<role>/` (role OSS mặc định),
`plugins/<name>/` (chuyên gia plugin — các agent này truyền thẳng
`skill_sources=` chứ không dùng fallback theo role), `shared/` (OPSEC,
defense evasion, giao thức báo cáo — gắn vào mọi role chuẩn).

> **Lưu ý về lệch tên role↔thư mục**: 4 role có tên khác thư mục thật
> trên đĩa — `postexploit`→`post-exploit/`, `ad_operator`→`ad/`,
> `cloud_hunter`→`cloud/`, `contract_auditor`→`contracts/`. Đây là một
> lỗi code đã biết, đang chờ sửa riêng, không phải do tài liệu sai.
> `mobile_operator`/`wireless_operator` không bị ảnh hưởng vì factory của
> chúng truyền `skill_sources=` rõ ràng.

Mỗi skill là 1 thư mục: `SKILL.md` (bắt buộc) + `references/` (tài liệu
sâu, tùy chọn) + `scripts/` (script tự động hóa, tùy chọn) + `assets/`
(template/config, tùy chọn).

## Schema frontmatter (chuẩn)

```yaml
---
name: passive-recon
description: "Use when gathering intelligence WITHOUT touching the target..."
metadata:
  subdomain: reconnaissance        # phải nằm trong danh sách canonical dưới đây
  when_to_use: "passive recon, WHOIS, subdomain, amass"
  mitre_attack: T1590, T1591       # bắt buộc trừ khi nằm dưới reporting/ hoặc analyst/
  tags: passive, dns, subdomain-enum
  fanout:                          # tùy chọn — DUY NHẤT field này được runtime đọc thật
    effects: read
    resources: ["host:*"]
    fragile_target: true
---
```

**`name`**: 1-64 ký tự, lowercase+hyphen, phải khớp tên thư mục.
**`description`**: bắt buộc, dạng `"Use when {điều kiện}: {hành động}. Triggers on: '{kw}'."`.

Danh sách `subdomain` canonical (từ `skills/audit/subdomains.yaml` — mọi
giá trị khác phải đi qua bảng alias, ví dụ author viết `ad`/`contracts`/
`phish`/`c2` sẽ tự được chuẩn hóa thành `active-directory`/
`smart-contracts`/`phishing`/`command-and-control`):

`reconnaissance, initial-access, execution, persistence,
privilege-escalation, defense-evasion, credential-access, discovery,
lateral-movement, collection, command-and-control, exfiltration, impact`
(theo kill-chain ATT&CK) — cộng `active-directory, cloud,
web-exploitation, mobile, ics-ot, iot, wireless, ai-security,
reverse-engineering, dfir, osint, phishing, smart-contracts` (theo chuyên
ngành) — cộng `supply-chain, post-exploit, reporting, planning,
orchestration, adversary-emulation, analyst, opsec, benchmark` (meta,
phi tấn công).

**Field `allowed-tools` KHÔNG còn hiệu lực** — dù một số `SKILL.md` cũ
vẫn khai báo nó, middleware hiện tại không đọc field này; việc gọi tool
không bị giới hạn bởi skill. Tương tự `metadata.kind`,
`metadata.safety_critical`, `metadata.gated_by_conops` là các field đã
đề xuất ở thiết kế v0.1 nhưng không có code nào đọc — coi là dư, sẽ bị
dọn. Ngoại lệ duy nhất là `metadata.fanout`: đây là field có hệ quả thật
— `fanout_admission.py` đọc trực tiếp `effects`/`resources`/
`parallel_safe`/`fragile_target` để quyết định một dispatch có được chạy
song song hay không (xem [quyết định 5](../decisions/05-generic-fanout-admission.md)).

## Cơ chế Skillogy — graph hóa corpus skill

Khi có Neo4j (mặc định bật, biến `RAPTIX_USE_SKILLOGY=0` để tắt),
Skillogy thay `SkillsMiddleware` bằng một backend graph thật:

- **Builder** (`skills/engine/builder/`) đọc toàn bộ `SKILL.md`, biến mỗi
  skill thành 1 node `:Skill` + cạnh `IN_PHASE`→`:Phase`,
  `TAGGED`→`:Tag`, `IMPLEMENTS`→`:Technique`/`:Tactic` (MITRE ATT&CK
  Enterprise, từ bundle STIX đã pin sẵn), và (khi phase chỉ có đúng 1
  MoC) `BELONGS_TO`→`:MoC`. Kết quả được serialize thành 1 file Cypher
  tĩnh, xác định (`skills.cypher`), build xong là nạp 1 lần lúc container
  Skillogy khởi động nếu graph còn trống — không build lại Cypher này
  lúc chạy.
- **"MoC" = Map-of-Concepts** (không phải Mixture of Context) — một bảng
  mục lục ngắn, biên soạn tay theo từng phase (`seeds/moc.yaml`), được
  `SkillogyMiddleware` render 1 lần lúc tạo agent thành đoạn
  "[Phase context]" ngắn trong system prompt. Đây là phần **tĩnh**, không
  có ranking.
- **Tool `find_skill`** (agent tự gọi khi cần) mới là phần có ranking
  thật: AND các filter cứng (subdomain/tag/MITRE) với kết quả **hybrid
  lexical + semantic** — nhánh lexical dò CONTAINS theo từ khóa, nhánh
  semantic dùng cosine k-NN trên vector index Neo4j (embedding qua
  endpoint `/v1/embeddings` của LiteLLM proxy), hợp nhất bằng
  reciprocal-rank fusion. Thiếu proxy embedding → tự rơi về lexical thuần
  (im lặng, không lỗi).
- **Fail-open toàn diện**: Skillogy là service riêng
  (`http://skillogy:9100`, chỉ phân giải được trong network compose).
  Nếu không kết nối được, agent chỉ mất đoạn "[Phase context]" và 3 tool
  `find_skill`/`load_skill`/`traverse` trả về lỗi dạng JSON thay vì
  crash — không ảnh hưởng runtime.

Tóm lại: tầng tĩnh (nạp theo role/thư mục, đoạn MoC) không có ranking;
tầng động (`find_skill`) có ranking thật nhưng chỉ phát huy khi có đủ hạ
tầng (Neo4j + LiteLLM embedding) — không chạy hạ tầng đó không phải lỗi,
chỉ là rơi về mức cơ bản.

## Viết skill mới

1. Tạo thư mục dưới category phù hợp: `skills/standard/recon/my-skill/`.
2. Viết `SKILL.md` theo schema trên, dưới 500 dòng (nội dung dài hơn đưa
   vào `references/`).
3. `make audit-skills` kiểm tra cục bộ trước khi mở PR — CI chạy lại ở
   mode strict.
4. Khởi động lại Raptix để middleware nạp skill mới — không cần đăng ký
   thủ công, chỉ cần nằm trong thư mục nguồn của role đó.
