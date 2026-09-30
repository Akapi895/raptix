# Hướng dẫn: Đổi tên `decepticon → raptix` + Thiết kế lại kiến trúc

> **Mục đích của tài liệu này:** hướng dẫn **từng bước, sao chép‑dán được**, để đổi toàn bộ tên
> `decepticon` thành `raptix` VÀ áp dụng các cải tiến cấu trúc, theo cách **không phá guardrail**
> và **có thể kiểm chứng**. Viết đủ chi tiết để một người/agent chưa quen repo vẫn theo được.
>
> **Quy tắc vàng:** KHÔNG chạy "find & replace" toàn cục. `decepticon` xuất hiện trong
> **~1040+ file / ~8000 dòng** thuộc **6 lớp ngữ cảnh khác nhau**; vài lớp là dữ liệu có state
> hoặc định danh bên ngoài, đổi bừa sẽ mất dữ liệu hoặc hỏng deploy.
> *(Con số này DỊCH CHUYỂN khi `main` tiến triển — luôn quét lại bằng lệnh ở Phần 8/G0
> ngay trước khi bắt đầu, đừng tin con số tĩnh.)*
>
> **Nếu bạn là agent yếu:** làm đúng thứ tự các Phần 0 → 9. Không nhảy cóc. Mỗi bước có
> "Kỳ vọng" (expected) và "Nếu hỏng" (on‑fail). Không bao giờ tự ý sửa file trong danh sách
> `KHÔNG ĐỘNG VÀO` (Phần 3). Khi gặp mục `[QUYẾT ĐỊNH]`, **dừng lại hỏi con người** — không tự đoán.

---

## Phần 0 — Trước khi bắt đầu (bắt buộc đọc)

### 0.1. Đây là một CHIẾN DỊCH nhiều PR, không phải một PR

`AGENTS.md` của repo quy định: **1 concern / PR, ≤ 400 dòng runtime, ≤ 10 file mỗi PR**, và
**không được nới lỏng guardrail nếu chưa có ADR + threat model**. Một cuộc rename toàn repo
vi phạm hết các giới hạn này. Vì vậy:

- Phải có **một ADR** (Phần 4, PR‑0) tuyên bố đây là "mechanical migration" ngoại lệ và được
  con người **sign‑off** trước.
- Chia thành **6 PR** (PR‑0 … PR‑E), mỗi PR có cổng kiểm tra riêng (Phần 8).

### 0.2. Các quyết định cần con người chốt TRƯỚC khi gõ phím `[QUYẾT ĐỊNH]`

| # | Câu hỏi | Vì sao quan trọng | Mặc định đề xuất |
|---|---|---|---|
| D1 | Đổi **tiền tố env** `DECEPTICON_* → RAPTIX_*`? | Phá mọi `.env`/secret/CI đang chạy (~100 biến) | Có, **kèm shim đọc biến cũ + cảnh báo** |
| D2 | Đổi **key graph** `"decepticon"` trong `langgraph.json`? | Là API key client gọi → breaking | Giữ key, chỉ đổi đường dẫn module *(an toàn hơn)* |
| D3 | Đổi **tên agent flagship** `decepticon` (agent, không phải namespace)? | Đổi persona + prompt + ảnh + skill | Hỏi con người |
| D4 | **Registry image** `ghcr.io/bittersecurity/decepticon-*`? | Không thuộc quyền bạn | Trỏ registry bạn sở hữu, vd `ghcr.io/<org>/raptix-*` |
| D5 | **Domain** `decepticon.red/.com/.dev`? | Không thuộc quyền bạn | Giữ, hoặc thay bằng domain bạn sở hữu |
| D6 | Đổi **tên event telemetry**? | Phá dashboard PostHog downstream | Mặc định KHÔNG đổi ở giai đoạn này |

> Ghi câu trả lời D1–D6 vào ADR (PR‑0). Phần còn lại của hướng dẫn giả định:
> **D1 = có + shim, D2 = giữ key, D3/D4/D5/D6 = chờ chốt.**

### 0.2.1. Ghi chú sau khi merge `main` (cập nhật thực tế)

- **`main` là nhánh SỐNG, đang tiến triển.** Lần merge gần nhất đã thêm cơ chế
  `agents/standard/_surface_dispatch.py` + `_surface_registry.py` và sửa prompt
  `agents/prompts/standard/decepticon.md`. Vì vậy: **giữ mỗi PR nhỏ, merge nhanh, và
  `git merge origin/main` lại trước MỖI PR** để tránh xung đột khổng lồ.
- **Prompt/agent flagship `decepticon` đang được sửa chủ động** ⇒ quyết định **D3**
  (đổi tên agent) càng cần chốt sớm; đừng đổi tên agent khi main còn đụng vào nó.

### 0.2.2. Toolchain cho khâu verify (đã kiểm tra trong môi trường này)

| Công cụ | Trạng thái | Ghi chú |
|---|---|---|
| `uv`, `node`, `go`, `docker` | Có sẵn | dùng trực tiếp |
| `semgrep` | **KHÔNG có global** | chạy qua `uv run semgrep` (nằm trong nhóm lint) |
| `.venv` | **Chưa tạo** | phải `uv sync --dev` trước khi chạy `make ci-*` |
| Cổng G11 (docker end‑to‑end), G13 (data), G14 (replay) | **Khó verify trong CI/sandbox** | cần môi trường có Docker daemon + volume thật; đánh dấu là "chạy ở môi trường tích hợp" |

### 0.3. Chuẩn bị môi trường

```bash
cd /home/user/raptix
git checkout claude/analyze-directory-structure-ieplhm   # nhánh phát triển đã chỉ định
git pull --ff-only || true
git status                                                # PHẢI sạch trước khi bắt đầu

# Sao lưu an toàn: tag mốc để rollback nhanh
git tag pre-raptix-rename
```

**Kỳ vọng:** `git status` báo "working tree clean".
**Nếu hỏng:** commit hoặc stash thay đổi đang dở trước khi tiếp tục.

---

## Phần 1 — Bảng ánh xạ tên (case‑map) & danh sách "survivor"

### 1.1. Case‑map (dùng đúng 6 quy tắc này, KHÔNG lowercase mù)

| Bối cảnh | Từ | Thành |
|---|---|---|
| module / path thường | `decepticon` | `raptix` |
| python module (gạch dưới) | `decepticon_` | `raptix_` |
| distribution / npm / docker (gạch ngang) | `decepticon-` | `raptix-` |
| npm scope | `@decepticon/` | `@raptix/` |
| brand trong văn bản/UI | `Decepticon` | `Raptix` |
| biến môi trường | `DECEPTICON_` | `RAPTIX_` |

### 1.2. SURVIVOR — tuyệt đối KHÔNG đổi (đưa vào allowlist của codemod)

- URL/domain ngoài: `decepticon.red`, `decepticon.com`, `decepticon.dev`, `app.decepticon…`, `docs.decepticon…`
- Registry ngoài: bất kỳ chuỗi chứa `bittersecurity/decepticon`
- `CHANGELOG.md` — lịch sử phát hành, giữ nguyên
- Migration đã chạy: `packages/*/middleware/kg_internal/migrations/V0*.cypher`
- Tên **agent** `decepticon` — chỉ đổi nếu D3 = có
- File nhị phân/sinh tự động: `uv.lock`, `package-lock.json`, `*.png`, ảnh (regenerate/đổi riêng)

---

## Phần 2 — Kiến trúc mục tiêu (thiết kế lại)

Ngoài rename, các cải tiến cấu trúc — **đã cập nhật sau khi đọc mã thực tế**:

1. **`raptix/core/` → `raptix/foundation/` — KHÔNG THỰC HIỆN (đảo ngược khuyến nghị ban đầu).**
   > Khi triển khai mới phát hiện: `raptix/core/{config,logging,schemas}.py` **không phải** module
   > hạ tầng — chúng là **shim deprecation** (`__getattr__` PEP 562 cảnh báo mỗi lần import) trỏ về
   > `raptix_core.*`, và **sẽ bị xóa ở 2.0.0** (Phase‑1 core/framework/sdk split). Nội dung thật đã
   > nằm ở `raptix_core`. Vì vậy đổi `core→foundation` sẽ **phá đúng các legacy import path mà lớp
   > này tồn tại để giữ** (`raptix.core.config`, `raptix.core.schemas`, …) và phải đụng
   > `compat/register_legacy_imports`. Sự "trùng tên khái niệm" tự biến mất khi 2.0.0 dọn `raptix/core/`.
   > ⇒ Để nguyên; không đổi tên.

2. **Gộp 3 thư mục "skill*" thành 1 namespace** `raptix/skills/` — **KHÔNG làm standalone; gộp vào PR hạ tầng (PR‑D).**
   - Ý định: `skills/*` (dữ liệu) → `skills/defs/`; `skillogy/` → `skills/graph/`; `skill_audit/` → `skills/audit/`
   > **Phát hiện khi triển khai:** `skillogy` **là một SERVICE triển khai**, không phải module nội bộ:
   > có `containers/skillogy.Dockerfile` (`CMD python -m …skillogy`, `COPY packages/…/skillogy`),
   > service riêng trong `docker-compose.yml` (image `…-skillogy`), và bị tham chiếu trong **5 workflow**
   > release/CI cộng `ci.yml` builder. `skills.cypher` được **build vào trong container skillogy**, và
   > dữ liệu `skills/` được nạp theo ĐƯỜNG DẪN + copy vào image. Vì vậy đổi `raptix.skillogy` →
   > `raptix.skills.graph` (và `skills/` → `skills/defs/`) là **thay đổi hạ tầng/release**, không phải
   > dọn cấu trúc thuần, và **không verify trọn vẹn được** ngoài môi trường tích hợp (không build được
   > container / chạy workflow ở đây). ⇒ Làm **cùng PR‑D** (khi đã đụng Dockerfile/compose/workflow),
   > verify bằng `make audit-skills-strict` + `make check-skill-graph` + build container. Lợi ích thuần
   > tuý là thẩm mỹ namespace, không đáng để tách riêng và gây rủi ro release.

3. **`raptix/tools/` giữ PHẲNG + thêm `README.md` mục lục — ĐÃ LÀM.**
   > KHÔNG tách/di chuyển thư mục con của `tools/`, vì `AGENTS.md` cấm đụng `tools/bash/*`.
   > Tách một phần mà chừa `bash` sẽ không nhất quán. Cải tiến ở đây chỉ là **tài liệu**.

> **Bài học codemod (đã sửa khi triển khai):**
> - Regex bảo vệ `decepticon\.(red|com|dev)` khớp NHẦM `decepticon.com` bên trong `decepticon.compat`
>   → module `decepticon.com*` không được đổi. Phải thêm ranh giới từ: `decepticon\.(red|com|dev)\b`.
> - Dotted‑rule `\bdecepticon\.` đổi nhầm **filename** (`decepticon.md`/`.py` của agent) và **thuộc tính
>   biến local** — phải loại trừ (agent files + biến local giữ tên).
> - **Chỉ codemod `.py` là CHƯA ĐỦ.** Rename package làm hỏng các tham chiếu **path/module chạy trên
>   runner** ngoài `.py`: `Makefile` (`python -m …`), `.github/workflows/*.yml` (paths‑filter, pytest
>   path, builder module), `.pre-commit-config.yaml`, `.yamllint.yaml`. Phải quét và sửa cả nhóm này
>   trong cùng đợt rename, nếu không CI **âm thầm skip job** (paths‑filter không khớp) hoặc đỏ.
> - **Cẩn thận `git checkout <file>` giữa chừng:** revert bước G5 đã khôi phục 1 file về bản git‑mv
>   *chưa* qua codemod (`raptix_core/__init__.py` còn `from decepticon_core import`); basedpyright chỉ
>   coi là *warning* nên lọt qua gate. Sau mỗi revert thủ công phải chạy lại import‑smoke + test.

### 2.1. Vì sao cấu trúc 2 cấp `packages/raptix-core/raptix_core/` là ĐÚNG (đừng "sửa")

- Cấp ngoài `raptix-core/` = **project/distribution** (dấu `-`), chứa `pyproject.toml`,
  `README.md`, `tests/`. Tên dùng `-` theo chuẩn PyPI.
- Cấp trong `raptix_core/` = **import package** (dấu `_`), là thứ code `import`. Python
  không cho phép `-` trong tên module nên buộc dùng `_`.
- **Không bỏ được 1 cấp** vì cấp ngoài phải có chỗ chứa `pyproject.toml` + `tests/`; nếu gộp,
  `tests/` sẽ nằm trong gói import và bị đóng gói ship ra ngoài (sai).

---

## Phần 3 — GUARDRAIL: những gì KHÔNG được phá (đọc kỹ)

Rename **vẫn phải sửa dòng `import`** bên trong các đường dẫn nhạy cảm. Điều đó được phép
**chỉ khi** thay đổi là đổi định danh thuần, **không đổi logic**, và đã có sign‑off.

### 3.1. KHÔNG đổi LOGIC (chỉ đổi định danh, cần sign‑off theo AGENTS.md)

- `raptix/tools/bash/*`, sandbox dispatch, tích hợp Sliver/msf/impacket
- `raptix/sandbox_kernel/`, `raptix/sandbox_server/`
- `SafeCommand`, RoE, `EngagementContext`, egress, HITL, container hardening

### 3.2. Guardrail được thực thi bằng CÔNG CỤ — phải giữ hiệu lực sau rename

Có **hai** cơ chế chặn "core import framework". Nếu rename mà quên cập nhật, guardrail sẽ
**âm thầm mất tác dụng** — đây là rủi ro nguy hiểm nhất:

1. **Semgrep:** `.semgrep/decepticon-rules.yml` (đổi tên → `raptix-rules.yml`). Pattern bên
   trong nhắm `decepticon_core` → phải sửa thành `raptix_core`.
2. **Ruff banned‑api:** trong `pyproject.toml`, mục `[tool.ruff.lint.flake8-tidy-imports.banned-api]`
   cấm `langchain/httpx/fastapi/...` cho tầng core, và `[tool.ruff.lint.per-file-ignores]`
   giới hạn luật vào **đường dẫn** của core. Sau khi đổi thư mục, **đường dẫn trong
   per‑file‑ignores phải trỏ `packages/raptix-core/...`**, nếu không luật sẽ áp sai phạm vi.
3. **isort first‑party:** `known-first-party = ["decepticon", "decepticon_core", "decepticon_sdk"]`
   → đổi thành `["raptix", "raptix_core", "raptix_sdk"]`.

> **Cổng G5 (Phần 8)** kiểm chứng hai guardrail này còn sống bằng cách cố tình vi phạm.

---

## Phần 4 — Chia PR & thứ tự thực hiện

| PR | Nội dung | File chính | Cổng kiểm tra |
|---|---|---|---|
| **PR‑0** | ADR: quyết định rename + chốt D1–D6 | `docs/adr/NNNN-rename-to-raptix.md` | review người |
| **PR‑A** | Rename package/import Python + regenerate lock | `packages/**`, `pyproject.toml`, `langgraph.json` | G0–G4 |
| **PR‑B** | Guardrail (semgrep/ruff) + skills gộp + proto/cypher regen | `.semgrep/`, `pyproject.toml`, `skills/**` | G5–G8 |
| **PR‑C** | Clients: Node (@raptix) + Go launcher | `clients/**`, `package.json` | G9–G10 |
| **PR‑D** | Hạ tầng: compose/env/data + shim | `docker-compose*.yml`, `.env.example`, `containers/**` | G11–G13 |
| **PR‑E** | Brand/telemetry/registry/domain (thủ công) | `README*.md`, `telemetry-gateway/**` | G14–G15 |

> Cấu trúc lại (foundation, skills gộp, tools README) đi kèm PR‑A/PR‑B tương ứng.

---

## Phần 5 — Codemod an toàn (script sao chép‑dán)

Script Python dưới đây thay tên theo case‑map **nhưng bảo vệ survivor** bằng cách thay tạm
survivor bằng "sentinel" trước, rồi khôi phục sau. Chỉ chạm **file đã track trong git** và
**bỏ qua nhị phân/generated**.

Lưu vào `scripts/rename_to_raptix.py`:

```python
#!/usr/bin/env python3
"""Codemod nội dung decepticon -> raptix, bảo vệ survivor. KHÔNG rename file/thư mục
(việc đó dùng `git mv` ở bước riêng để giữ history)."""
import re, subprocess, sys
from pathlib import Path

# 1) File/đuôi KHÔNG chạm nội dung
SKIP_PATHS = (
    ".git/", "node_modules/", "uv.lock", "package-lock.json",
    "CHANGELOG.md",
    "middleware/kg_internal/migrations/",   # migration đã chạy
    "docs/migration/raptix-rename-and-redesign.md",  # chính file này
)
SKIP_SUFFIX = (".png", ".jpg", ".jpeg", ".ico", ".lock", ".woff", ".woff2", ".ttf")

# 2) Survivor -> sentinel (bảo vệ khỏi bị đổi)
PROTECT = [
    r"bittersecurity/decepticon[\w-]*",
    r"decepticon\.red", r"decepticon\.com", r"decepticon\.dev",
    r"app\.decepticon[\w.]*", r"docs\.decepticon[\w.]*",
]
# Nếu D3 = giữ tên agent, bảo vệ thêm (bỏ comment khi cần):
# PROTECT += [r"standard/decepticon\.py", r"\"decepticon\"\s*:"]

# 3) Case-map (thứ tự QUAN TRỌNG: cụ thể trước, chung sau)
REPLACERS = [
    (r"@decepticon/", "@raptix/"),
    (r"DECEPTICON_", "RAPTIX_"),
    (r"decepticon_", "raptix_"),
    (r"decepticon-", "raptix-"),
    (r"Decepticon", "Raptix"),
    (r"decepticon", "raptix"),
]

def tracked_files():
    out = subprocess.check_output(["git", "ls-files"], text=True)
    return [Path(p) for p in out.splitlines()]

def process(text: str) -> str:
    # 3a. giấu survivor
    stash = {}
    def hide(m):
        key = f"\x00{len(stash)}\x00"
        stash[key] = m.group(0)
        return key
    for pat in PROTECT:
        text = re.sub(pat, hide, text)
    # 3b. đổi tên
    for pat, rep in REPLACERS:
        text = re.sub(pat, rep, text)
    # 3c. khôi phục survivor
    for key, val in stash.items():
        text = text.replace(key, val)
    return text

def main():
    changed = 0
    for f in tracked_files():
        s = str(f)
        if any(s.startswith(p) or (p in s) for p in SKIP_PATHS): continue
        if f.suffix in SKIP_SUFFIX: continue
        try:
            orig = f.read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        new = process(orig)
        if new != orig:
            f.write_text(new, encoding="utf-8"); changed += 1
    print(f"Đã sửa nội dung {changed} file")

if __name__ == "__main__":
    sys.exit(main())
```

`git mv` cho 25 path mang tên (chạy TRƯỚC codemod để giữ history) — lưu `scripts/rename_paths.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mv() { git mv "$1" "$2"; echo "mv $1 -> $2"; }

# --- packages (đổi cả cấp ngoài lẫn cấp trong) ---
mv packages/decepticon-core/decepticon_core packages/decepticon-core/raptix_core
mv packages/decepticon-core                  packages/raptix-core
mv packages/decepticon-sdk/decepticon_sdk    packages/decepticon-sdk/raptix_sdk
mv packages/decepticon-sdk                   packages/raptix-sdk
mv packages/decepticon/decepticon            packages/decepticon/raptix
mv packages/decepticon                       packages/raptix

# --- cấu trúc lại bên trong runtime ---
mv packages/raptix/raptix/core        packages/raptix/raptix/foundation
mkdir -p packages/raptix/raptix/skills_new
git mv packages/raptix/raptix/skills  packages/raptix/raptix/skills_new/defs
git mv packages/raptix/raptix/skillogy    packages/raptix/raptix/skills_new/graph
git mv packages/raptix/raptix/skill_audit packages/raptix/raptix/skills_new/audit
git mv packages/raptix/raptix/skills_new  packages/raptix/raptix/skills

# --- SDK examples ---
for d in agent callback middleware prompt skill tool; do
  mv "packages/raptix-sdk/examples/$d/src/decepticon_example_$d" \
     "packages/raptix-sdk/examples/$d/src/raptix_example_$d"
done

# --- các path lẻ ---
mv .github/actions/decepticon-scan             .github/actions/raptix-scan
mv .semgrep/decepticon-rules.yml               .semgrep/raptix-rules.yml
mv assets/benchmark/decepticon_donut.png       assets/benchmark/raptix_donut.png
mv assets/decepticon_infra.svg                 assets/raptix_infra.svg
mv benchmark/configs/decepticon-bench-v1.yaml  benchmark/configs/raptix-bench-v1.yaml
mv clients/instruction.decepticon.txt          clients/instruction.raptix.txt
mv clients/web/public/agents/decepticon.png    clients/web/public/agents/raptix.png
mv docs/security/decepticon-threat-model.md    docs/security/raptix-threat-model.md
mv integrations/agent-skills/decepticon        integrations/agent-skills/raptix
mv packages/raptix/raptix/skills/graph/proto/skillogy.proto \
   packages/raptix/raptix/skills/graph/proto/raptix_graph.proto

# --- tên agent flagship: CHỈ chạy khi D3 = có ---
# mv packages/raptix/raptix/agents/standard/decepticon.py       packages/raptix/raptix/agents/standard/raptix.py
# mv packages/raptix/raptix/agents/prompts/standard/decepticon.md   packages/raptix/raptix/agents/prompts/standard/raptix.md
# mv packages/raptix/raptix/agents/prompts/workflows/decepticon.md  packages/raptix/raptix/agents/prompts/workflows/raptix.md
# mv packages/raptix/raptix/skills/defs/standard/decepticon         packages/raptix/raptix/skills/defs/standard/raptix

echo "== git mv xong. Chạy codemod nội dung tiếp theo. =="
```

> **Thứ tự chạy:** `bash scripts/rename_paths.sh` **trước**, rồi `uv run python scripts/rename_to_raptix.py`.
> Codemod sau sẽ vá các đường dẫn/import bên trong file (bao gồm `per-file-ignores`, `tool.uv.sources`,
> `known-first-party`, `[tool.decepticon.plugins] → [tool.raptix.plugins]`, `langgraph.json`).

---

## Phần 6 — Các sửa THỦ CÔNG mà codemod không lo hết

Sau codemod, **kiểm và sửa tay** các điểm sau (codemod dễ bỏ sót hoặc cần quyết định):

1. **`pyproject.toml` gốc:**
   - `name = "decepticon-workspace"` → `"raptix-workspace"`
   - `[tool.uv.sources]`: `decepticon/-core/-sdk` → `raptix/-core/-sdk`
   - `[tool.decepticon.plugins]` → `[tool.raptix.plugins]` (comment đề cập `decepticon.plugin_loader`, `DECEPTICON_PLUGINS`)
   - `[tool.ruff.lint.isort] known-first-party` → `["raptix", "raptix_core", "raptix_sdk"]`
   - `[tool.ruff.lint.per-file-ignores]`: đường dẫn scope core → `packages/raptix-core/...`
   - banned‑api `.msg`: đổi chữ "decepticon-core" trong thông điệp
2. **`langgraph.json`:** `dependencies: ["./packages/raptix"]`, đường dẫn module graph →
   `./packages/raptix/raptix/agents/standard/*.py`. **Key graph:** theo D2 (mặc định giữ `"decepticon"`).
3. **`.semgrep/raptix-rules.yml`:** pattern `decepticon_core` → `raptix_core`.
4. **Docker Compose (`docker-compose*.yml`) — CÓ STATE, cẩn thận (xem Phần 7).**
5. **`.env.example`:** `DECEPTICON_* → RAPTIX_*` + thêm ghi chú migration (D1).
6. **Ảnh/SVG:** `decepticon_infra.svg` là text → codemod có thể sửa chữ bên trong; kiểm mắt.
   `*.png` phải thay thủ công nếu có chữ trong ảnh.
7. **Go launcher (`clients/launcher/go.mod`):** module path → cập nhật + `go mod tidy`.

---

## Phần 7 — Hạ tầng có STATE (đừng làm mất dữ liệu)

Trong `docker-compose.yml`, `decepticon` là **tên tài nguyên có dữ liệu**, không chỉ là chuỗi:

| Hạng mục | Hiện tại | Sau đổi | Lưu ý migration |
|---|---|---|---|
| DB user/password | `decepticon` | `raptix` | Đổi user DB cần lệnh SQL, không đổi suông |
| DB tên | `decepticon_web`, `litellm` | `raptix_web` | `containers/postgres-init/*.sql` + `scripts/init-web-db.sql` |
| Neo4j password | `decepticon-graph` | `raptix-graph` | Reset password hoặc giữ (chỉ là default) |
| Docker network | `decepticon-net` | `raptix-net` | Recreate mạng — an toàn |
| container_name / stack | `decepticon`, `DECEPTICON_STACK_NAME` | `raptix`, `RAPTIX_STACK_NAME` | Recreate container — an toàn |
| Volume path | `~/.decepticon` | `~/.raptix` | **Người dùng cũ mất state** nếu không copy |
| Image registry | `ghcr.io/bittersecurity/decepticon-*` | D4 (registry của bạn) | Phải build & push lại |

**Khuyến nghị cho volume/DB:** cung cấp bước migration trong ghi chú nâng cấp, ví dụ:

```bash
# Sao chép state cũ sang tên mới (người dùng chạy 1 lần khi nâng cấp)
cp -a ~/.decepticon ~/.raptix
# DB: đổi tên role/user bằng SQL thay vì tạo mới, để giữ dữ liệu
#   ALTER ROLE decepticon RENAME TO raptix;
#   ALTER DATABASE decepticon_web RENAME TO raptix_web;
```

**Shim env (D1 = có):** cho phép đọc biến cũ để không phá deploy đang chạy. Thêm vào chỗ nạp
cấu hình (module foundation/config), logic dạng: nếu `RAPTIX_X` chưa set nhưng `DECEPTICON_X`
có → dùng giá trị cũ + log cảnh báo deprecation. Gỡ shim sau 1–2 release.

---

## Phần 8 — TEST FLOW hoàn chỉnh (các cổng G0–G15)

Chạy tuần tự. **Không sang cổng sau nếu cổng trước đỏ.** Lệnh dưới là lệnh thật của repo.

```bash
# ---------- G0: Không còn sót tên (trừ survivor) ----------
grep -rIi decepticon . \
  --exclude-dir=.git --exclude-dir=node_modules \
  | grep -viE 'bittersecurity|decepticon\.(red|com|dev)|app\.decepticon|docs\.decepticon|CHANGELOG|migrations/V0'
# Kỳ vọng: KHÔNG in dòng nào (rỗng). Nếu D2/D3 giữ tên, thêm mẫu loại trừ tương ứng.
# On-fail: sửa từng dòng còn sót rồi chạy lại.

# ---------- G1: Regenerate lock + sync ----------
uv lock                      # sinh lại uv.lock theo tên mới
uv sync --dev --locked       # Kỳ vọng: cài đặt thành công, không lỗi resolve

# ---------- G2: Import smoke ----------
uv run python -c "import raptix, raptix_core, raptix_sdk; print('imports OK')"
# Kỳ vọng: in 'imports OK'. On-fail: còn import cũ sót lại -> grep 'import decepticon'.

# ---------- G3: Lint + test Python ----------
make ci-lint                 # Ruff + format + basedpyright (errors-only)
make ci-test                 # pytest -n auto -q -m "not slow"

# ---------- G4: Coverage gate ----------
make quality-strict          # gồm coverage 60% + web-lint + web-build

# ---------- G5: GUARDRAIL còn sống (QUAN TRỌNG NHẤT) ----------
# 5a. Cố tình vi phạm: thêm import cấm vào tầng core
echo "import httpx  # test-guardrail" >> packages/raptix-core/raptix_core/__init__.py
make ci-lint                 # Kỳ vọng: ĐỎ (ruff banned-api chặn httpx trong core)
uv run semgrep --config .semgrep/raptix-rules.yml packages/raptix-core \
                             # Kỳ vọng: có finding
# 5b. Khôi phục
git checkout packages/raptix-core/raptix_core/__init__.py
# On-fail (nếu ci-lint XANH ở 5a): guardrail đã hỏng -> sửa per-file-ignores/semgrep pattern.

# ---------- G6: Skills ----------
make audit-skills-strict
make check-skill-graph       # bootstrap STIX + so khớp skills.cypher đã commit
# On-fail: chạy `make build-skill-graph` để sinh lại rồi commit .graph/skills.cypher

# ---------- G7: gRPC/proto (nếu skills/graph dùng stub sinh) ----------
# Regenerate stub từ raptix_graph.proto bằng tooling của repo (buf/grpcio-tools),
# rồi chạy test của skills/graph. Kiểm proto 'package' đã đổi tên.

# ---------- G8: LangGraph nạp được mọi graph ----------
uv run python -c "import json,importlib; \
cfg=json.load(open('langgraph.json')); \
[importlib.import_module(v.split(':')[0].lstrip('./').replace('/', '.').removesuffix('.py')) for v in cfg['graphs'].values()]; \
print('graphs import OK')"
# On-fail: đường dẫn module trong langgraph.json chưa đổi theo folder.

# ---------- G9: Node (thứ tự build BẮT BUỘC) ----------
npm ci
npm run build --workspace=@raptix/streaming     # PHẢI build trước
npm run prisma:generate
make quality-cli                                 # typecheck/build CLI
make web-lint && make web-build                  # Web

# ---------- G10: Go launcher ----------
( cd clients/launcher && go build ./... && go test ./... )

# ---------- G11: Compose hợp lệ + chạy thật ----------
docker compose config >/dev/null                 # validate cú pháp/tham chiếu
make dev                                          # hoặc: make dogfood
# Kỳ vọng: các container 'raptix-*' lên, healthcheck xanh.

# ---------- G12: Env cũ vẫn chạy qua shim ----------
# Đặt 1 biến kiểu cũ (DECEPTICON_*) trong .env, khởi động, xác nhận có cảnh báo
# deprecation nhưng giá trị vẫn được áp dụng.

# ---------- G13: Nâng cấp dữ liệu ----------
# Với volume ~/.decepticon cũ: chạy bước copy ở Phần 7, xác nhận app đọc được state.

# ---------- G14: Replay (hành vi agent KHÔNG đổi) ----------
# Dùng ReplayMiddleware (packages/raptix/raptix/runtime/recording.py) phát lại
# một recording cũ; so sánh output trước/sau rename -> phải giống.

# ---------- G15: Telemetry ----------
( cd telemetry-gateway && npm ci && npm test )    # vitest
# Nếu D6 = không đổi event name: xác nhận schema.json giữ nguyên tên trường.
```

**Cổng quan trọng nhất để "đạt kết quả tốt nhất":** **G5** (guardrail còn hiệu lực) và
**G14** (rename không đổi hành vi). Đừng bỏ hai cổng này.

---

## Phần 9 — Rollback & checklist chốt

### 9.1. Rollback nhanh

```bash
# Nếu một PR sai và chưa merge:
git reset --hard pre-raptix-rename    # về mốc trước rename (mất thay đổi chưa commit!)
# Nếu đã commit nhiều bước, revert từng PR theo thứ tự ngược lại.
```

### 9.2. Checklist trước khi mở mỗi PR

- [ ] Chỉ 1 concern; nếu vượt giới hạn AGENTS.md → đã có ADR ngoại lệ (PR‑0)
- [ ] KHÔNG đổi logic trong `tools/bash`, sandbox, SafeCommand/RoE/HITL (chỉ định danh)
- [ ] G0 (residue) rỗng cho phạm vi PR
- [ ] G5 xanh (guardrail còn sống) nếu PR chạm core/semgrep/ruff
- [ ] `uv.lock`/`package-lock.json` được **regenerate**, không sửa tay
- [ ] Không đụng survivor (registry/domain/CHANGELOG/migrations) trừ khi đúng PR‑E
- [ ] Commit message KHÔNG chứa định danh model; kết thúc bằng dòng attribution của repo

### 9.3. Thứ tự merge

`PR-0 (ADR)` → `PR-A` → `PR-B` → `PR-C` → `PR-D` → `PR-E`.
Sau mỗi merge vào nhánh chính của chiến dịch, chạy lại **G0–G4** để bắt hồi quy sớm.

---

## Phụ lục A — Cây target hoàn chỉnh (sau rename + redesign)

```
raptix/
|
|__ packages/                              # Runtime Python (uv workspace)
|   |__ raptix-core/                       # was decepticon-core (tầng hợp đồng thuần)
|   |   |__ pyproject.toml                 #   name="raptix-core"; packages=["raptix_core"]
|   |   |__ README.md  tests/
|   |   |__ raptix_core/                   # was decepticon_core (import package)
|   |       |__ __init__.py  py.typed  plugin_loader.py
|   |       |__ contracts/ protocols/ types/ registry/ utils/
|   |
|   |__ raptix-sdk/                         # was decepticon-sdk
|   |   |__ pyproject.toml  README.md  tests/
|   |   |__ examples/                       #   */src/raptix_example_*/
|   |   |__ raptix_sdk/                     # was decepticon_sdk
|   |       |__ scaffold/ testing/
|   |
|   |__ raptix/                             # was decepticon (runtime chính)
|       |__ pyproject.toml  README.md  tests/
|       |__ raptix/                         # was decepticon/decepticon
|           |__ foundation/                 # was core/ (config/log/schemas/streaming)
|           |__ agents/
|           |   |__ standard/               #   21 graph (agent 'decepticon' -> D3)
|           |   |__ plugins/  prompts/
|           |__ tools/                       # PHẲNG + README (đừng tách vì bash LOCKED)
|           |   |__ README.md                # MỚI: mục lục (~15 domain + 2 plumbing)
|           |   |__ bash/                    # LOCKED - chỉ đổi import, cần sign-off
|           |   |__ network/ web/ browser/ cloud/ ad/
|           |   |__ reversing/ defense/ evidence/ proxy/ ops/
|           |   |__ research/ references/ reporting/ interaction/
|           |   |__ contracts/ mcp/          #   plumbing
|           |__ middleware/
|           |   |__ kg_internal/
|           |       |__ migrations/          #   V001..V005.cypher = GIỮ NGUYÊN
|           |__ skills/                      # GỘP 1 namespace
|           |   |__ defs/                    #   was skills/* (standard/ shared/ plugins/ benchmark/ .graph/)
|           |   |__ graph/                   #   was skillogy/ (builder/ client/ server/ proto/raptix_graph.proto)
|           |   |__ audit/                   #   was skill_audit/
|           |__ sandbox_kernel/ sandbox_server/  # LOCKED
|           |__ sandbox_web/ (templates/)
|           |__ runtime/ (recording.py)  backends/ llm/ capabilities/ compat/
|           |__ server/ mcp_server/ cli/ telemetry/ blue_cell/
|
|__ clients/
|   |__ web/                                # @raptix/web (Next.js + Prisma)
|   |   |__ src/(app components hooks lib styles) prisma/ server/ public/
|   |   |__ public/agents/raptix.png
|   |__ cli/                                # @raptix/cli (TUI React/Ink)
|   |__ desktop/                            # @raptix/desktop (Electron)
|   |__ launcher/                           # Go (go.mod .../raptix)
|   |__ shared/streaming/                   # @raptix/streaming (build TRƯỚC web/cli)
|   |__ instruction.raptix.txt
|
|__ docs/
|   |__ adr/  (NNNN-rename-to-raptix.md)
|   |__ architecture/ design/ engineering/ features/ integrations/
|   |__ migration/ (raptix-rename-and-redesign.md)  proposals/ red-team/
|   |__ security/ (raptix-threat-model.md)  tools/
|
|__ benchmark/
|   |__ providers/ cve_bench/ dreadgoad/ results/
|   |__ configs/raptix-bench-v1.yaml
|   |__ [submodules: xbow-validation-benchmarks, MHBench]
|
|__ integrations/agent-skills/raptix/
|__ config/  containers/  telemetry-gateway/(src test)
|__ scripts/(rename_to_raptix.py rename_paths.sh ...)  assets/(raptix_infra.svg)  tests/
|__ .github/actions/raptix-scan/
|__ .semgrep/raptix-rules.yml               # pattern trỏ raptix_core (G5)
|
|__ AGENTS.md CLAUDE.md Makefile langgraph.json pyproject.toml package.json .env.example
|   # pyproject: name="raptix-workspace"; [tool.raptix.plugins]; sources raptix*
|   # langgraph.json: dependencies ["./packages/raptix"]; module paths raptix/...
|   # .env.example: DECEPTICON_* -> RAPTIX_* (kèm shim + ghi chú migration)

# GIỮ NGUYÊN: ghcr.io/bittersecurity/*, decepticon.red/.com/.dev, CHANGELOG.md,
#            migrations V001..V005, (tùy D3) tên agent 'decepticon'
```

## Phụ lục B — Lệnh thật của repo dùng trong hướng dẫn

| Việc | Lệnh |
|---|---|
| Cài phụ thuộc Python | `uv sync --dev --locked` |
| Lint Python (PR lane) | `make ci-lint` |
| Test Python | `make ci-test` |
| Chất lượng đầy đủ | `make quality` (= ci-lint + ci-test + quality-cli + web-lint + web-build) |
| Chất lượng + coverage 60% | `make quality-strict` |
| Kiểm skill | `make audit-skills-strict` |
| Sinh & kiểm skill graph | `make build-skill-graph` / `make check-skill-graph` |
| Build Web | `make web-build` ; Lint Web | `make web-lint` |
| Chạy dev stack | `make dev` ; Dogfood | `make dogfood` ; Dọn | `make clean` |
| Test một file pytest | `uv run pytest <path>::<test>` hoặc `make test-local ARGS="path::test"` |

---

_Tài liệu này là hướng dẫn migration, không phải mã chạy. Trước khi thực thi bất kỳ bước
nào chạm guardrail (Phần 3), phải có sign‑off theo `AGENTS.md`._
