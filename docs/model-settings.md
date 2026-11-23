# Chọn model

Mọi lệnh gọi LLM đi qua một proxy [LiteLLM](https://github.com/BerriAI/litellm)
che giấu sự khác biệt giữa Anthropic, OpenAI, Google, MiniMax, DeepSeek,
xAI, Mistral, OpenRouter, Nvidia NIM, Ollama/vLLM tự host, và cả OAuth
subscription (Claude Code, ChatGPT) — tất cả qua 1 endpoint. Model gán
cho mỗi agent, và model thay thế khi primary lỗi, được tính lúc khởi
động từ **kho credential** + **profile** đang bật.

## 3 trục quyết định

| Trục | Giá trị | Ai quyết định |
| --- | --- | --- |
| **Tier** | `HIGH`/`MID`/`LOW` | Theo agent (orchestrator→HIGH, recon→LOW), profile có thể ép lại |
| **AuthMethod** | API: `anthropic_api`, `openai_api`, `google_api`... · OAuth: `anthropic_oauth`, `openai_oauth` · Local: `ollama_local` | Kho credential của bạn |
| **Profile** | `eco`/`max`/`test` | `RAPTIX_MODEL_PROFILE` |

Với mỗi agent, Raptix tính tier (theo profile) rồi đi qua danh sách
AuthMethod theo thứ tự ưu tiên, lấy model mà method đó có ở tier đó —
**kết quả đầu tiên là primary, mọi kết quả còn lại xếp hàng làm
fallback**. `ModelFallbackMiddleware` của langchain tự thử từng fallback
theo thứ tự khi primary lỗi.

Ma trận đầy đủ Tier×AuthMethod (bảng dưới chỉ liệt kê các provider chính;
`AuthMethod`/`METHOD_MODELS` trong `packages/raptix-core/raptix_core/types/llm.py`
là nguồn chuẩn đầy đủ, gồm cả Bedrock/Vertex/Azure, Groq/Together/
Fireworks..., và các gateway đa nhà cung cấp):

| | HIGH | MID | LOW |
| --- | --- | --- | --- |
| `anthropic_api` | `claude-opus-4-8` | `claude-sonnet-5` | `claude-haiku-4-5` |
| `anthropic_oauth` | cùng model, qua subscription | | |
| `openai_api` | `gpt-5.5` | `gpt-5.4` | `gpt-5-nano` |
| `google_api` | `gemini-2.5-pro` | `gemini-2.5-flash` | `gemini-2.5-flash-lite` |
| `ollama_local` | `ollama_chat/<model đã pull>` — như nhau ở mọi tier | | |

Khi 1 method không có model ở tier đang hỏi (ví dụ MiniMax không có
LOW), resolver bỏ qua method đó và thử method tiếp theo trong danh sách
ưu tiên của bạn.

## Profile

`RAPTIX_MODEL_PROFILE` (mặc định `eco`) quyết định mỗi agent chạy ở tier
nào:

- **`eco`** (mặc định production) — mỗi agent chạy đúng tier phù hợp
  khối lượng việc: HIGH cho `raptix`/`exploit`/`exploiter`/`patcher`/
  `contract_auditor`/`analyst`/`vulnresearch`; MID cho phần lớn chuyên
  gia; LOW cho `soundwave`/`recon`/`scanner`/`wireless_operator`/
  `osint_operator`.
- **`max`** — mọi agent chạy HIGH, dùng khi độ chính xác quan trọng hơn
  chi phí.
- **`test`** — mọi agent chạy LOW (rẻ nhất), dùng cho dev/CI.

## Kho credential

Dựng lúc khởi động từ biến môi trường (do `raptix onboard` ghi):

```bash
RAPTIX_AUTH_PRIORITY=anthropic_oauth,openai_api   # thứ tự ưu tiên
RAPTIX_AUTH_CLAUDE_CODE=true                       # có subscription Claude Code
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OLLAMA_API_BASE=http://host.docker.internal:11434  # local, không cần key
OLLAMA_MODEL=qwen3-coder:30b
```

Giá trị placeholder (`your-..-key-here`) bị coi là "chưa cấu hình" và tự
loại khỏi kho credential.

## Vài ví dụ dây chuyền fallback (profile `eco`)

**Chỉ 1 key (Anthropic)** — không có fallback, chỉ 1 credential.

**OAuth Claude Code + API key Anthropic** (subscription chạy chính, API
trả phí làm lưới đỡ):

| Agent (tier) | Primary | Fallback |
| --- | --- | --- |
| raptix (HIGH) | `auth/claude-opus-4-8` | `anthropic/claude-opus-4-8` |
| recon (LOW) | `auth/claude-haiku-4-5` | `anthropic/claude-haiku-4-5` |

OAuth không tốn phí API; khi hết quota subscription, rơi xuống API trả
phí cùng dòng model, cùng chất lượng.

**Trộn provider (Anthropic + OpenAI)** — khi Anthropic rate-limit/outage,
OpenAI nhận thay, liền mạch, không cần cấu hình thêm gì khác ngoài khai
2 key.

**Chỉ Ollama local (offline, miễn phí)**:

```bash
RAPTIX_AUTH_PRIORITY=ollama_local
OLLAMA_API_BASE=http://host.docker.internal:11434
OLLAMA_MODEL=qwen3-coder:30b
```

Model giống nhau ở mọi tier vì phần cứng local thường không chạy nổi 3
model khác nhau cùng lúc. Dùng provider `ollama_chat/` (gọi
`/api/chat`, hỗ trợ tool-calling) chứ không phải `ollama/` cũ (gọi
`/api/generate`, bị từ chối vì agent luôn cần gọi tool). `raptix onboard`
tự kiểm tra Ollama có model hỗ trợ `tools` trước khi cho chọn; LiteLLM
container kiểm tra lại lần 2 lúc khởi động (bắt được trường hợp
`OLLAMA_HOST=127.0.0.1`-only mà wizard trên host không thấy được).

**Llama.cpp (GGUF) local**: dùng lại provider `openai/` của LiteLLM (gắn
`api_base` tới `LLAMACPP_API_BASE`) vì llama.cpp chưa có LiteLLM provider
riêng — cách tích hợp này do chính người duy trì LiteLLM khuyến nghị
(issue #151), tránh phải vendor `llama-cpp-python` làm dependency runtime.

## Cơ chế failover

`ModelFallbackMiddleware` theo dõi mọi lệnh gọi LLM. Khi primary lỗi
(outage, rate-limit 429, context quá dài, lỗi mạng), nó tự thử từng
fallback đã xếp hàng theo thứ tự — agent không thấy gián đoạn, giữ
nguyên lịch sử hội thoại và tool call đang gọi. Độ dài dây chuyền = số
AuthMethod đã cấu hình, không có giới hạn trên, không âm thầm cắt bớt.
Chỉ khi mọi method đều lỗi, agent mới thấy lỗi thật.

## Proxy LiteLLM

Toàn bộ traffic qua container LiteLLM (cổng 4000): 1 API thống nhất, đo
token theo model/role, rate-limit theo provider, gộp chi phí theo
provider. Cấu hình ở `config/litellm.yaml`, xác thực bằng
`LITELLM_MASTER_KEY` trong `.env`.

## Thêm model mới

1. Thêm 1 entry `model_list` vào `config/litellm.yaml` (định danh
   `provider/model` + biến env chứa key).
2. Thêm định danh đó vào ô phù hợp của `METHOD_MODELS`
   (`raptix_core.types.llm`).
3. Nếu là AuthMethod mới: thêm vào `AuthMethod`, map
   `_API_METHOD_ENV` của factory, và danh sách lựa chọn của wizard
   onboard.

Không cần sửa YAML để thêm model Ollama/gateway tùy biến — chỉ cần set
biến env (`OLLAMA_MODEL`+`OLLAMA_API_BASE`, `RAPTIX_MODEL`,
`RAPTIX_MODEL_<ROLE>`, `RAPTIX_LITELLM_MODELS`, `CUSTOM_OPENAI_API_BASE`),
`litellm_dynamic_config.py` tự đăng ký route lúc proxy khởi động.

## OAuth subscription

Dùng subscription hàng tháng thay vì trả theo token. ChatGPT đọc trực
tiếp từ credential store của Codex CLI (`~/.codex/auth.json`) — `codex
login` trên host là đủ, không cần rebuild container nào.

```bash
RAPTIX_AUTH_CLAUDE_CODE=true     # subscription Claude
RAPTIX_AUTH_CHATGPT=true         # subscription ChatGPT
```
