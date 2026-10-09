import fs from 'node:fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const batches = JSON.parse(fs.readFileSync(`${UA}/intermediate/batches.json`, 'utf8'));
const batch = batches.batches.find(b => b.batchIndex === 119);

const nodes = [];
const edges = [];
const add = o => nodes.push(o);
const e = (source, target, type, weight) => edges.push({ source, target, type, direction: 'forward', weight });

// ── CLI vitest config ──
add({
  id: 'file:clients/cli/vitest.config.ts',
  type: 'file',
  name: 'vitest.config.ts',
  filePath: 'clients/cli/vitest.config.ts',
  lineRange: [1, 14],
  summary: 'Cấu hình Vitest cho @raptix/cli: include src/**/*.test.ts và *.test.tsx, environment node, globals false (import tường minh), coverage provider v8 trên src/**/*.{ts,tsx} loại trừ chính test và *.d.ts.',
  tags: ['vitest', 'config', 'coverage', 'cli'],
  complexity: 'simple',
});

// ── desktop ──
add({
  id: 'document:clients/desktop/README.md',
  type: 'document',
  name: 'README.md',
  filePath: 'clients/desktop/README.md',
  lineRange: [1, 14],
  summary: 'Tuyên bố deprecated cho Raptix Desktop: Electron shell bọc cloud app + local web dashboard không còn là cách chạy khuyến nghị — không thêm chức năng so với web dashboard và là client surface tốn bảo trì nhất repo (version churn, đóng gói đa nền tảng, code-signing); hướng dẫn chuyển sang CLI `raptix start` hoặc web dashboard tại http://localhost:3000; package giữ lại cho user cũ và sẽ bị xoá.',
  tags: ['desktop', 'electron', 'deprecated', 'migration'],
  complexity: 'simple',
});
add({
  id: 'config:clients/desktop/package.json',
  type: 'config',
  name: 'package.json',
  filePath: 'clients/desktop/package.json',
  lineRange: [1, 15],
  summary: 'Manifest @raptix/desktop 0.0.0 (private, ESM) — desktop shell Electron cho cloud app và local web dashboard: main src/main.mjs, scripts start (electron .) và test (node --test src/**/*.test.mjs); devDep duy nhất electron ^43.3.0.',
  tags: ['electron', 'desktop', 'package-json', 'deprecated'],
  complexity: 'simple',
});
add({
  id: 'file:clients/desktop/src/preload.cjs',
  type: 'file',
  name: 'preload.cjs',
  filePath: 'clients/desktop/src/preload.cjs',
  lineRange: [1, 24],
  summary: 'Preload script Electron (CommonJS) chạy trong renderer: map data-desktop-action → IPC channel (desktop:retry, open-in-browser, open-cloud, open-download, open-docs, copy-install, copy-onboard, copy-api-key); lắng nghe DOMContentLoaded và chỉ kích hoạt khi location.protocol là "data:" (trang offline được nhúng), delegate click qua closest("[data-desktop-action]") rồi ipcRenderer.send(channel) — các nút retry/mở link/copy lệnh trên màn hình setup.',
  tags: ['electron', 'preload', 'ipc', 'cjs'],
  complexity: 'simple',
  languageNotes: 'Dùng .cjs vì package desktop khai báo type: module nhưng preload phải CommonJS.',
});

// ── instruction ──
add({
  id: 'document:clients/instruction.raptix.txt',
  type: 'document',
  name: 'instruction.raptix.txt',
  filePath: 'clients/instruction.raptix.txt',
  lineRange: [1, 54],
  summary: 'Prompt gốc orchestrator cho run tự động trên lab OWASP Juice Shop (http://host.docker.internal:3020, scope nghiêm ngặt cục bộ): vai trò ROOT orchestrator — KHÔNG tự test target, mọi tương tác phải delegate sub-agent chuyên trách (không delegate = assessment FAILED); chiến lược recon trước qua GET /api/Challenges/ rồi fan-out song song theo category (Auth/SQLi, Access-Control/IDOR, XSS cần browser, Injection/business-logic); truyền kiến thức xuống sub-agent (SPA — challenge kích hoạt bằng hành động, verify solved:true sau exploit, tự có credential khi blocked); luật runner tự chủ hoàn toàn (zero user interaction, không xin xác nhận, fail không dừng, không bỏ cuộc, chạy tới khi lab hoàn thành); format báo cáo ngắn gọn [Status]/[Target]/[Action]/[Result]/[Next Step].',
  tags: ['prompt', 'orchestrator', 'juice-shop', 'benchmark', 'delegation'],
  complexity: 'moderate',
});

// ── env.example ──
add({
  id: 'config:clients/launcher/internal/config/env.example',
  type: 'config',
  name: 'env.example',
  filePath: 'clients/launcher/internal/config/env.example',
  lineRange: [1, 266],
  summary: 'Template biến môi trường Raptix (installer copy thành ~/.raptix/.env, `raptix onboard` ghi đè tương tác): API key cho ~25 provider (Anthropic/OpenAI/Gemini/MiniMax/OpenRouter/NVIDIA/DeepSeek/xAI/Mistral + cloud gateway LiteLLM Groq/Together/Fireworks/Cohere/Moonshot/Z.ai/DashScope + GitHub Models); IAM AWS Bedrock, service account GCP Vertex, Azure OpenAI; local LLM LM Studio/Ollama (URL host.docker.internal vs WSL) và custom OpenAI-compatible; LiteLLM master/salt key; Postgres/Neo4j password; RAPTIX_MODEL_PROFILE eco/max/test; RAPTIX_AUTH_PRIORITY (30 AuthMethod) + các OAuth subscription Claude Code/ChatGPT/Gemini/Grok/Copilot/Perplexity; BENCHMARK_MODE, LangSmith tracing, telemetry opt-out (off/basic/research — mask target, không gửi raw prompt/IP/credential), ports, COMPOSE_PROFILES cho workload C2 specialist on-demand (ADR-0006), RAPTIX_HOME, AUTO_UPDATE, RAPTIX_LANGUAGE (60+ ngôn ngữ incl. vi).',
  tags: ['env', 'configuration', 'llm-providers', 'launcher', 'oauth'],
  complexity: 'moderate',
});

// ── shared/streaming ──
add({
  id: 'file:clients/shared/streaming/src/constants.ts',
  type: 'file',
  name: 'constants.ts',
  filePath: 'clients/shared/streaming/src/constants.ts',
  lineRange: [1, 13],
  summary: 'Hằng số STREAM_OPTIONS khớp tham chiếu LangGraph Chat UI: streamMode tuple ["values","messages","updates","custom"], streamSubgraphs và streamResumable true; dùng chung cho submit() của Web useStream và client.runs.stream() của CLI; tuple khai báo mutable để khớp kiểu StreamMode[] mà không cần dependency SDK.',
  tags: ['streaming', 'constants', 'langgraph', 'shared'],
  complexity: 'simple',
});
add({
  id: 'file:clients/shared/streaming/src/index.ts',
  type: 'file',
  name: 'index.ts',
  filePath: 'clients/shared/streaming/src/index.ts',
  lineRange: [1, 29],
  summary: 'Barrel export của @raptix/streaming — hạ tầng streaming LangGraph dùng chung cho web dashboard và CLI: types (SubagentCustomEvent, SubagentEventType, StreamEvent), normalization raw-event thuần (NormalizedSubagentEvent, SubagentToolPhase, normalizeSubagentEvent, normalizedEventKey, normalizedGroupKey), STREAM_OPTIONS, utilities (extractText, stripResultTags), session derivation (SubAgentSession, deriveSubAgentSessions) và SSE framing (SseDecoder, SseFrameError, decodeSse, SseFrame). Build ESM qua tsc — specifier tương đối mang đuôi .js để Node ESM resolver chấp nhận dist/ runtime, còn Next/TS resolve source qua package exports.',
  tags: ['barrel', 'streaming', 'esm', 'shared-package'],
  complexity: 'simple',
  languageNotes: 'Đây là package phải build trước khi CLI typecheck/build hay web-raptix build — cả hai tiêu thụ dist/.',
});
add({
  id: 'file:clients/shared/streaming/src/sse.ts',
  type: 'file',
  name: 'sse.ts',
  filePath: 'clients/shared/streaming/src/sse.ts',
  lineRange: [1, 55],
  summary: 'Framing SSE tăng dần với contract có bounnd: SseFrame {event, data, id?} — id là cursor wire tường minh, không phải định danh event; SseFrameError ném khi frame vượt giới hạn; SseDecoder tích luỹ buffer, cắt theo CRLF/LF (xử lý \r đứng cuối, BLOB BOM đầu stream, comment ":"), gom field data (nhiều dòng join \\n)/event/id (từ chối id chứa NUL), mặc định event "message", phát frame khi gặp dòng trống, tự vệ bằng maxSize 2MB (đếm size từng dòng + buffer) và ném SseFrameError; decodeSse là async generator đọc ReadableStream<Uint8Array> qua TextDecoder UTF-8 fatal streaming, flush phần cuối, cancel reader trong finally.',
  tags: ['sse', 'streaming', 'parser', 'bounds'],
  complexity: 'moderate',
  languageNotes: 'Giới hạn frame tính cả buffer chưa cắt để chặn producer không bao giờ gửi line terminator.',
});
add({
  id: 'file:clients/shared/streaming/src/utils.ts',
  type: 'file',
  name: 'utils.ts',
  filePath: 'clients/shared/streaming/src/utils.ts',
  lineRange: [1, 32],
  summary: 'Tiện ích thuần (zero dependency, dùng chung Web + CLI) xử lý nội dung event stream: extractText lấy text từ message content LangChain — cả string lẫn mảng content-block dạng Anthropic (block string hoặc {text}), join và trim; stripResultTags gỡ cặp tag <result>/</result> mà framework agent dùng nội bộ trước khi hiển thị cho user.',
  tags: ['utilities', 'streaming', 'pure-functions', 'shared'],
  complexity: 'simple',
});
add({
  id: 'file:clients/shared/streaming/tests/normalize.test.ts',
  type: 'file',
  name: 'normalize.test.ts',
  filePath: 'clients/shared/streaming/tests/normalize.test.ts',
  lineRange: [1, 296],
  summary: 'Test normalizer đối chiếu trường bắt được từ source-emitter W00 (fixture verbatim runtime-emitter-capture.json, StreamingRunnable @ subagent_streaming.py) qua helper rawStart/rawEnd dựng SubagentCustomEvent: map session_id/created_at → sessionId/createdAt giữ nguyên trường unit; elapsed tính GIÂY không quy đổi (85.125 giữ nguyên); phân biệt toolId null tường minh với absent (in check); key/group key của normalized event; phân loại tool phase và tool result; hành vi group key theo session; tương thích shape CLI-normalized lẫn raw backend (status="error" vs error=true).',
  tags: ['test', 'normalization', 'subagent', 'fixtures', 'vitest'],
  complexity: 'moderate',
});
add({
  id: 'file:clients/shared/streaming/tests/sse.test.ts',
  type: 'file',
  name: 'sse.test.ts',
  filePath: 'clients/shared/streaming/tests/sse.test.ts',
  lineRange: [1, 20],
  summary: 'Test SSE decoder: frame tách qua nhiều push với CRLF và data JSON nhiều dòng (id cursor "100-1" tách khỏi event identity, comment heartbeat bỏ qua); decodeSse xử lý byte UTF-8 cắt giữa ký tự (data "đúng") và không bịa event khi EOF chưa hoàn chỉnh; SseDecoder(maxSize nhỏ) ném SseFrameError khi producer không bao giờ gửi line terminator.',
  tags: ['test', 'sse', 'utf8', 'bounds'],
  complexity: 'simple',
});

// ── web-contracts ──
add({
  id: 'file:clients/shared/web-contracts/src/index.ts',
  type: 'file',
  name: 'index.ts',
  filePath: 'clients/shared/web-contracts/src/index.ts',
  lineRange: [1, 18],
  summary: 'Barrel export của @raptix/web-contracts — hợp đồng wire DTO + validator ranh giới runtime dùng chung cho web-raptix (browser) và web-raptix-server (Fastify); re-export 10 module: errors, capabilities, engagements, runtime, planning, ownership, runtime-context, run-api, stream-events, c2; cấm React/Next/Prisma/LangGraph SDK/secrets.',
  tags: ['barrel', 'contracts', 'dto', 'shared-package'],
  complexity: 'simple',
});
add({
  id: 'file:clients/shared/web-contracts/tests/contracts.test.ts',
  type: 'file',
  name: 'contracts.test.ts',
  filePath: 'clients/shared/web-contracts/tests/contracts.test.ts',
  lineRange: [1, 368],
  summary: 'Suite kiểm tra hợp đồng web qua validator runtime với fixture bắt từ capture W02: engagement contracts (chấp nhận shape legacy, từ chối id không phải string/rỗng/userId số, union status và target-type đóng — draft/planning/running/completed/failed, web_url/ip_range); capabilities document; approval actions + decision request; run events (envelope isRunEventEnvelope với version/source/kind, RUN_EVENT_KINDS/SOURCES, run identity/snapshot/view status); thread run request; ProjectViewModel; mọi validator phải từ chối payload sai kiểu trường, thiếu trường bắt buộc và giá trị ngoài union — ID luôn string, không bao giờ array index.',
  tags: ['test', 'contracts', 'validators', 'dto', 'vitest'],
  complexity: 'moderate',
});

// ── .gitattributes ──
add({
  id: 'file:clients/web-raptix/.gitattributes',
  type: 'file',
  name: '.gitattributes',
  filePath: 'clients/web-raptix/.gitattributes',
  lineRange: [1, 146],
  summary: 'Quy tắc Git LFS cho web-raptix: track mọi định dạng binary/lớn/khó-diff theo nhóm — ảnh & graphics (png/jpg/jpeg/gif/bmp/tiff/ico/webp/psd/ai/sketch), video (mp4/mov/avi/mkv/wmv/flv/webm/m4v/mpg/mpeg), audio (mp3/wav/flac/aac/...) và tiếp các nhóm binary khác; mỗi pattern gắn filter=lfs diff=lfs merge=lfs -text để lưu ngoài git history.',
  tags: ['git-lfs', 'gitattributes', 'binaries'],
  complexity: 'simple',
});

// ── design docs ──
add({
  id: 'document:clients/web-raptix/docs/design-reference/imports/pasted_text/project-workspace-updates.md',
  type: 'document',
  name: 'project-workspace-updates.md',
  filePath: 'clients/web-raptix/docs/design-reference/imports/pasted_text/project-workspace-updates.md',
  lineRange: [1, 307],
  summary: 'Yêu cầu thiết kế (pasted reference) chỉ đụng Project List + quản lý member trong Project Workspace, giữ nguyên design system hiện tại: (1) lại Project Card đủ thông tin ra quyết định — status Active/Draft/Completed, tên, scope/target type, phase hiện tại (thay cho % tiến độ tuyến tính), số assets/findings/agent đang chạy, avatar group + vai trò của user, last activity, menu 3 chấm, hover "Open Project →"; quy định màu #FFFFFF/#F7F8FA/#EE0033, radius 10-12px; (2) ba vai trò Owner (toàn quyền quản lý)/Member-Pentester (chat + chạy pentest)/Viewer-Reviewer (read-only); (3) trang Members trong sidebar với bảng user/email/role/status/last activity + menu đổi vai trò/xoá; (4) modal Add Member (search user + chọn role kèm giải thích); (5) avatar group tối đa 3 + "+N" trên card; (6) card Members gọn trên Overview; (7) luật sản phẩm: role scope theo project, không global.',
  tags: ['design-reference', 'members', 'rbac', 'project-list', 'spec'],
  complexity: 'moderate',
});
add({
  id: 'document:clients/web-raptix/docs/design-reference/imports/pasted_text/raptix-dashboard-design.md',
  type: 'document',
  name: 'raptix-dashboard-design.md',
  filePath: 'clients/web-raptix/docs/design-reference/imports/pasted_text/raptix-dashboard-design.md',
  lineRange: [1, 269],
  summary: 'Design brief gốc dashboard web Raptix — nền tảng pentest/red-team có kiểm soát, con người điều phối + giám sát agent AI: mục tiêu sản phẩm (quản lý project, chat root agent, spawn subagent, orchestrator/skills/MCP, phases, logs, credentials, assets/findings, HITL cho hành động rủi ro cao); phong cách SaaS hiện đại "AI-assisted security operations center" với tone đỏ #EE0033 + trắng, dark text #111, nền sáng white-first; bố cục sidebar (Projects/Overview/Chat/Orchestrator/Phases/Logs/Credentials/Assets/Findings/Settings) + topbar; design system sơ bộ (button variants, badges, cards, tables, tabs, timeline, approval modal HITL, chat bubbles/subchat accordion); 10 màn hình phải vẽ A-J (Project List, Overview, Chat root+sub, Orchestrator tree, Phases với checkpoint HITL, Logs terminal-like, Credentials, Assets, Findings, HITL modal); trải nghiệm mong muốn và deliverables.',
  tags: ['design-brief', 'dashboard', 'hitl', 'orchestrator', 'ui'],
  complexity: 'moderate',
});

// ── design reference screens (batch 119 portion) ──
add({
  id: 'file:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AgentRun.tsx',
  type: 'file',
  name: 'AgentRun.tsx',
  filePath: 'clients/web-raptix/docs/design-reference/pre-web-correct/screens/AgentRun.tsx',
  lineRange: [1, 811],
  summary: 'Màn hình tham chiếu (pre-web-correct, demo fixtures) Operator Console: phiên agent theo thread — useRunSnapshot(project.id), thread active ưu tiên từ URL param, draft per (project,thread) giữ tin nhắn chưa gửi khi đổi session; tách rootAgent/subAgents, đếm agent running, panel chi tiết agent (AgentDetailPanel) + MessageContent render markdown, điều khiển play/pause/stop (pause bị chặn ở demo mode), nút new chat/message, tooltip "Demo data — fixtures from src/mocks/fixtures/agent-runs.ts"; MobileDrawer cho session list + detail trên viewport hẹp (useNarrowViewport), auto-scroll bottomRef.',
  tags: ['design-reference', 'agent-run', 'console', 'threads', 'demo'],
  complexity: 'complex',
});
add({
  id: 'file:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Assets.tsx',
  type: 'file',
  name: 'Assets.tsx',
  filePath: 'clients/web-raptix/docs/design-reference/pre-web-correct/screens/Assets.tsx',
  lineRange: [1, 828],
  summary: 'Màn hình tham chiếu Assets & Inventory: bảng/card tài sản phát hiện được (hostname, subdomain, URL, endpoint, IP, service) với TypeIcon theo loại, search/filter/tags, đếm số lượng; AssetDrawer chi tiết asset hiển thị rows (label/value mono), asset liên quan findings, source phát hiện; dữ liệu demo từ fixtures; hiển thị chip mock-source.',
  tags: ['design-reference', 'assets', 'inventory', 'drawer', 'demo'],
  complexity: 'complex',
});
add({
  id: 'file:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx',
  type: 'file',
  name: 'AttackGraph.tsx',
  filePath: 'clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx',
  lineRange: [1, 615],
  summary: 'Màn hình tham chiếu đồ thị tấn công (SVG canvas, fixture graphs): node host/user/service/domain với state unknown/discovered/compromised/objective theo bảng màu, zone grouping, viền node r=22/objective r=26; edge tính toạ độ đầu-cuối theo bán kính (calcEdge) với style active/discovered/targeting/unknown (đậm, nét đứt); AttackGraphCanvas vẽ toàn bộ + filter theo type/state, search, fullscreen; panel chi tiết node bên phải (Row/DetailRow) hiển thị service/banner/credential; EmptyGraphState khi không có dữ liệu; renderTermLine render log-like info.',
  tags: ['design-reference', 'attack-graph', 'svg', 'visualization'],
  complexity: 'complex',
});
add({
  id: 'file:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Chat.tsx',
  type: 'file',
  name: 'Chat.tsx',
  filePath: 'clients/web-raptix/docs/design-reference/pre-web-correct/screens/Chat.tsx',
  lineRange: [1, 575],
  summary: 'Màn hình tham chiếu Chat (dạng cũ, data inline) — workspace hội thoại root agent + subagent: model SubAgent lồng children (name/task/status/lastActivity/skills/tools), dữ liệu demo recon/exploit/vuln agents; Chat render khung chat chính với MessageContent (render markdown + tool calls) và AgentTreeNode cây sub-agent expand/collapse chọn được để xem sub-chat, StatusBadge 4 trạng thái running/idle/done/blocked; thể hiện quan hệ root chat → sub-chat trực quan kèm panel kỹ năng/tools.',
  tags: ['design-reference', 'chat', 'subagent-tree', 'demo'],
  complexity: 'complex',
});
add({
  id: 'file:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Credentials.tsx',
  type: 'file',
  name: 'Credentials.tsx',
  filePath: 'clients/web-raptix/docs/design-reference/pre-web-correct/screens/Credentials.tsx',
  lineRange: [1, 545],
  summary: 'Màn hình tham chiếu Credentials: quản lý credential phát hiện được trong project — model Credential (type password/token/session/cookie/api_key/discovered, username, secret, linkedAsset, source, status active/revoked/expired, rotationHistory); toggle hiện/ẩn secret (Eye/EyeOff), rotate, revoke, thêm credential, search/filter theo type; demo fixture gồm Admin Panel Login từ .env exposure v.v.; nhấn mạnh không lộ secret thừa.',
  tags: ['design-reference', 'credentials', 'vault', 'secrets', 'demo'],
  complexity: 'moderate',
});
add({
  id: 'file:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx',
  type: 'file',
  name: 'Evidence.tsx',
  filePath: 'clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx',
  lineRange: [1, 586],
  summary: 'Màn hình tham chiếu Evidence (artifact thu thập từ run): 5 loại evidence — screenshot/log/extracted_data/tool_output/terminal_capture với màu + icon riêng; lọc theo type/finding, search; EvidenceCard grid hiển thị item + severity (critical→info); EvidenceDrawer chi tiết kèm preview text/JSON/Markdown (binary bị chặn — cần file service), findings liên quan qua linkedFindingsFor, tags; các nút upload/link/export bị vô hiệu với lý do tường minh (demo build không có service); fixture EVIDENCE_FIXTURES/FINDINGS_FIXTURES chỉ hiện với project.id=1.',
  tags: ['design-reference', 'evidence', 'artifacts', 'findings', 'demo'],
  complexity: 'complex',
});
add({
  id: 'file:clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx',
  type: 'file',
  name: 'KnowledgeGraph.tsx',
  filePath: 'clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx',
  lineRange: [1, 595],
  summary: 'Màn hình tham chiếu đồ thị tri thức (SVG radial canvas từ fixture geometry): node Asset/Identity/Service/Domain/Network với bảng màu riêng, bố trí tâm + vòng trong/ngoài (NODE_R theo ring), group theo type/subnet/domain, filter theo category, search, fullscreen; calcEdge tính toạ độ mép node; KnowledgeGraphCanvas vẽ + panel chi tiết + StatTile tổng quan; EmptyGraphState khi project chưa có graph; legend 5 category.',
  tags: ['design-reference', 'knowledge-graph', 'svg', 'visualization'],
  complexity: 'complex',
});
add({
  id: 'file:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Orchestrator.tsx',
  type: 'file',
  name: 'Orchestrator.tsx',
  filePath: 'clients/web-raptix/docs/design-reference/pre-web-correct/screens/Orchestrator.tsx',
  lineRange: [1, 327],
  summary: 'Màn hình tham chiếu Orchestrator: tổng quan agent tree — Root Agent (Orchestrator) + subagent Recon/VulnScanner/ExploitAgent với status running/idle/done/blocked/spawning, task, parentId, skills, tools, taskCount, uptime (fixture inline); getChildren dựng quan hệ cha-con, AgentCard hiển thị agent (compact/full) với hành động play/pause/stop/inspect, StatusPill theo trạng thái; chọn agent để xem chi tiết; nhấn mạnh blocked agent cần HITL.',
  tags: ['design-reference', 'orchestrator', 'agent-tree', 'demo'],
  complexity: 'moderate',
});

// ── contains/exports for code files ──
const ce = (file, targets) => {
  for (const t of targets) edges.push({ source: `file:${file}`, target: t, type: 'contains', direction: 'forward', weight: 1 });
};
const ex = (file, targets) => {
  for (const t of targets) edges.push({ source: `file:${file}`, target: t, type: 'exports', direction: 'forward', weight: 0.8 });
};

ce('clients/shared/streaming/src/sse.ts', [
  'class:clients/shared/streaming/src/sse.ts:SseFrameError',
  'class:clients/shared/streaming/src/sse.ts:SseDecoder',
  'function:clients/shared/streaming/src/sse.ts:decodeSse',
]);
ex('clients/shared/streaming/src/sse.ts', [
  'class:clients/shared/streaming/src/sse.ts:SseFrameError',
  'class:clients/shared/streaming/src/sse.ts:SseDecoder',
  'function:clients/shared/streaming/src/sse.ts:decodeSse',
]);
ce('clients/shared/streaming/src/utils.ts', [
  'function:clients/shared/streaming/src/utils.ts:extractText',
  'function:clients/shared/streaming/src/utils.ts:stripResultTags',
]);
ex('clients/shared/streaming/src/utils.ts', [
  'function:clients/shared/streaming/src/utils.ts:extractText',
  'function:clients/shared/streaming/src/utils.ts:stripResultTags',
]);
ce('clients/shared/streaming/tests/normalize.test.ts', [
  'function:clients/shared/streaming/tests/normalize.test.ts:rawEnd',
]);
ce('clients/web-raptix/docs/design-reference/pre-web-correct/screens/AgentRun.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AgentRun.tsx:AgentRun',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AgentRun.tsx:MobileDrawer',
]);
ex('clients/web-raptix/docs/design-reference/pre-web-correct/screens/AgentRun.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AgentRun.tsx:AgentRun',
]);
ce('clients/web-raptix/docs/design-reference/pre-web-correct/screens/Assets.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Assets.tsx:Assets',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Assets.tsx:AssetDrawer',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Assets.tsx:DrawerRow',
]);
ex('clients/web-raptix/docs/design-reference/pre-web-correct/screens/Assets.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Assets.tsx:Assets',
]);
ce('clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx:calcEdge',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx:renderTermLine',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx:AttackGraph',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx:AttackGraphCanvas',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx:EmptyGraphState',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx:DetailRow',
]);
ex('clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx:AttackGraph',
]);
ce('clients/web-raptix/docs/design-reference/pre-web-correct/screens/Chat.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Chat.tsx:Chat',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Chat.tsx:AgentTreeNode',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Chat.tsx:MessageContent',
]);
ex('clients/web-raptix/docs/design-reference/pre-web-correct/screens/Chat.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Chat.tsx:Chat',
]);
ce('clients/web-raptix/docs/design-reference/pre-web-correct/screens/Credentials.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Credentials.tsx:Credentials',
]);
ex('clients/web-raptix/docs/design-reference/pre-web-correct/screens/Credentials.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Credentials.tsx:Credentials',
]);
ce('clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx:Evidence',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx:EvidenceEmptyState',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx:EvidenceCard',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx:EvidenceDrawer',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx:DrawerRow',
]);
ex('clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx:Evidence',
]);
ce('clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx:calcEdge',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx:KnowledgeGraph',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx:KnowledgeGraphCanvas',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx:EmptyGraphState',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx:StatTile',
]);
ex('clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx:KnowledgeGraph',
]);
ce('clients/web-raptix/docs/design-reference/pre-web-correct/screens/Orchestrator.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Orchestrator.tsx:Orchestrator',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Orchestrator.tsx:AgentCard',
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Orchestrator.tsx:StatusPill',
]);
ex('clients/web-raptix/docs/design-reference/pre-web-correct/screens/Orchestrator.tsx', [
  'function:clients/web-raptix/docs/design-reference/pre-web-correct/screens/Orchestrator.tsx:Orchestrator',
]);

// function/class nodes
for (const [file, name, type, [s, ee], sum, tags, cx] of [
  ['clients/shared/streaming/src/sse.ts', 'SseFrameError', 'class', [3, 5], 'Error subclass đánh dấu frame SSE vượt contract framing có bounnd (maxSize).', ['sse', 'error', 'bounds'], 'simple'],
  ['clients/shared/streaming/src/sse.ts', 'SseDecoder', 'class', [6, 42], 'Incremental SSE parser: push(text) tích luỹ buffer, cắt dòng theo CRLF/LF, bỏ BOM lần đầu, xử lý comment ":" và trường data/event/id (từ chối NUL trong id), phát SseFrame khi gặp dòng trống; tự vệ maxSize (mặc định 2MB) theo cả size dòng đã cắt lẫn buffer, vi phạm thì ném SseFrameError.', ['sse', 'parser', 'incremental'], 'moderate'],
  ['clients/shared/streaming/src/sse.ts', 'decodeSse', 'function', [44, 55], 'Async generator: đọc ReadableStream<Uint8Array> qua TextDecoder UTF-8 fatal streaming, push từng chunk vào SseDecoder và yield frame; flush decoder ở chunk done; finally cancel reader.', ['sse', 'async-generator', 'streaming'], 'simple'],
  ['clients/shared/streaming/src/utils.ts', 'extractText', 'function', [11, 24], 'Trích text từ LangChain message content: trả nguyên chuỗi nếu string; nếu mảng content-block (Anthropic) lấy block string hoặc field text rồi join + trim; khác thì rỗng.', ['utilities', 'message-content', 'pure'], 'simple'],
  ['clients/shared/streaming/src/utils.ts', 'stripResultTags', 'function', [30, 32], 'Gỡ cặp tag <result>/</result> khỏi nội dung AI message trước khi hiển thị user (tag dùng nội bộ bởi agent framework).', ['utilities', 'sanitize', 'pure'], 'simple'],
  ['clients/shared/streaming/tests/normalize.test.ts', 'rawEnd', 'function', [34, 44], 'Fixture dựng SubagentCustomEvent subagent_end verbatim theo trường emitter W00: created_at, agent, elapsed giây, cancelled/error flags, session_id.', ['test-fixture', 'subagent'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/AgentRun.tsx', 'AgentRun', 'function', [26, 744], 'Screen chính AgentRun (default export): snapshot run theo project, thread active từ URL, draft per thread, tách root/sub agents, message list + composer, điều khiển run (play/pause/stop), panel chi tiết agent, mobile drawer, auto-scroll.', ['screen', 'agent-run', 'reference'], 'complex'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/AgentRun.tsx', 'MobileDrawer', 'function', [748, 811], 'Drawer trượt cho viewport hẹp: side trái/phải, tiêu đề, nút đóng, nội dung children — dùng cho session list và agent detail trên mobile.', ['screen', 'responsive', 'drawer'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Assets.tsx', 'Assets', 'function', [333, 558], 'Screen Assets (default export): lưới tài sản với search/filter theo type, chip mock-source, thống kê tổng, click mở AssetDrawer; fixture dữ liệu khi project đủ điều kiện.', ['screen', 'assets', 'reference'], 'complex'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Assets.tsx', 'AssetDrawer', 'function', [560, 814], 'Drawer chi tiết tài sản: rows label/value (DrawerRow), asset field (IP, port, service, banner), source phát hiện, findings liên quan, tags.', ['screen', 'drawer', 'assets'], 'moderate'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Assets.tsx', 'DrawerRow', 'function', [816, 828], 'Hàng label/value trong drawer, hỗ trợ giá trị mono.', ['screen', 'ui', 'row'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx', 'calcEdge', 'function', [54, 67], 'Tính toạ độ hai đầu cạnh giữa 2 node tròn: vector đơn vị theo khoảng cách, lùi về mép bán kính r1/r2 để cạnh không đè node.', ['svg', 'geometry', 'graph'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx', 'renderTermLine', 'function', [92, 112], 'Render một dòng terminal-like trong panel info node (màu theo nội dung, prefix cmd/output).', ['svg', 'panel', 'terminal'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx', 'AttackGraph', 'function', [114, 119], 'Default export: wrapper mỏng render AttackGraphCanvas cho project.', ['screen', 'attack-graph'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx', 'AttackGraphCanvas', 'function', [121, 549], 'Canvas SVG đồ thị tấn công: vẽ zone + node theo state/type màu, cạnh theo edgeState (active/discovered/targeting/unknown), filter type/state + search + fullscreen, click node mở panel chi tiết (service/banner/credentials) và log terminal.', ['screen', 'svg', 'graph', 'reference'], 'complex'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx', 'EmptyGraphState', 'function', [553, 588], 'Trạng thái rỗng của graph: icon + thông báo project chưa có dữ liệu graph kèm note.', ['screen', 'empty-state'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/AttackGraph.tsx', 'DetailRow', 'function', [599, 615], 'Row chi tiết trong panel node: label, value mono, highlight, small.', ['screen', 'ui', 'row'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Chat.tsx', 'Chat', 'function', [187, 483], 'Screen Chat (default export, dạng cũ): khung chat root agent với message list (role user/agent, tool calls), subchat accordion cây AgentTreeNode, panel agent info/skills/tools, input gửi tin nhắn; toàn bộ dữ liệu demo inline.', ['screen', 'chat', 'reference'], 'complex'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Chat.tsx', 'AgentTreeNode', 'function', [485, 544], 'Node trong cây sub-agent: expand/collapse theo depth, hiển thị name/task/status/lastActivity, chọn để mở sub-chat tương ứng.', ['screen', 'tree', 'subagent'], 'moderate'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Chat.tsx', 'MessageContent', 'function', [555, 575], 'Render nội dung message: user dạng text, agent render markdown + khối tool call (name/result) theo vai trò.', ['screen', 'markdown', 'message'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Credentials.tsx', 'Credentials', 'function', [216, 545], 'Screen Credentials (default export): danh sách credential dạng card/table với toggle ẩn-hiện secret, search theo tên/type, hành động rotate/revoke/add, hiển thị rotation history và trạng thái active/revoked/expired.', ['screen', 'credentials', 'reference'], 'complex'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx', 'Evidence', 'function', [54, 221], 'Screen Evidence (default export): bộ lọc type/finding + search, grid EvidenceCard, mở EvidenceDrawer; chip CapabilityButton/MockSourceChip đánh giá năng lực demo; fixture chỉ với project demo có findings.', ['screen', 'evidence', 'reference'], 'complex'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx', 'EvidenceEmptyState', 'function', [223, 254], 'Trạng thái rỗng khi project chưa có evidence — hướng dẫn evidence được thu thập bởi agent run.', ['screen', 'empty-state'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx', 'EvidenceCard', 'function', [256, 362], 'Card evidence: icon + màu theo loại, preview nội dung (text/JSON/Markdown), tag, severity, đếm finding liên quan.', ['screen', 'card', 'evidence'], 'moderate'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx', 'EvidenceDrawer', 'function', [364, 572], 'Drawer chi tiết evidence: preview artifact (binary bị chặn với lý do), bảng thuộc tính, findings liên quan có thể chọn, tags, nút export vô hiệu tường minh.', ['screen', 'drawer', 'evidence'], 'complex'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Evidence.tsx', 'DrawerRow', 'function', [574, 586], 'Hàng label/value trong EvidenceDrawer, hỗ trợ mono.', ['screen', 'ui', 'row'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx', 'calcEdge', 'function', [74, 89], 'Tính toạ độ đầu-cuối cạnh giữa hai node tròn theo bán kính — giống AttackGraph.', ['svg', 'geometry', 'graph'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx', 'KnowledgeGraph', 'function', [91, 96], 'Default export: wrapper mỏng render KnowledgeGraphCanvas.', ['screen', 'knowledge-graph'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx', 'KnowledgeGraphCanvas', 'function', [98, 547], 'Canvas SVG radial: node 5 category màu riêng trên tâm + 2 vòng, group theo type/subnet/domain, filter category + search + fullscreen, panel chi tiết node và StatTile tổng quan, legend.', ['screen', 'svg', 'graph', 'reference'], 'complex'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx', 'EmptyGraphState', 'function', [549, 584], 'Trạng thái rỗng khi chưa có knowledge graph cho project (kèm note nguồn dữ liệu).', ['screen', 'empty-state'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/KnowledgeGraph.tsx', 'StatTile', 'function', [586, 595], 'Tile thống kê nhỏ (label + value, highlight) dùng ở đầu panel.', ['screen', 'ui', 'stats'], 'simple'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Orchestrator.tsx', 'Orchestrator', 'function', [111, 271], 'Screen Orchestrator (default export): header tổng quan agent, AgentCard grid/tree theo quan hệ cha-con qua getChildren, chọn agent để xem chi tiết, hành động play/pause/stop; blocked agent được làm nổi cho HITL.', ['screen', 'orchestrator', 'reference'], 'complex'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Orchestrator.tsx', 'AgentCard', 'function', [273, 315], 'Card một agent: tên, loại, task, skills/tools badges, taskCount, uptime, chọn + chế độ compact.', ['screen', 'card', 'agent'], 'moderate'],
  ['clients/web-raptix/docs/design-reference/pre-web-correct/screens/Orchestrator.tsx', 'StatusPill', 'function', [317, 327], 'Pill trạng thái agent (running/idle/done/blocked/spawning) với màu tương ứng.', ['screen', 'ui', 'status'], 'simple'],
]) {
  add({ id: `${type}:${file}:${name}`, type, name, filePath: file, lineRange: [s, ee], summary: sum, tags, complexity: cx });
}

// ── imports 1:1 batchImportData ──
e('file:clients/shared/streaming/tests/normalize.test.ts', 'file:clients/shared/streaming/src/index.ts', 'imports', 0.7);
e('file:clients/shared/streaming/tests/sse.test.ts', 'file:clients/shared/streaming/src/sse.ts', 'imports', 0.7);
e('file:clients/shared/web-contracts/tests/contracts.test.ts', 'file:clients/shared/web-contracts/src/index.ts', 'imports', 0.7);

// ── tested_by ──
e('file:clients/shared/streaming/src/normalize.ts', 'file:clients/shared/streaming/tests/normalize.test.ts', 'tested_by', 0.5);
e('file:clients/shared/streaming/src/sse.ts', 'file:clients/shared/streaming/tests/sse.test.ts', 'tested_by', 0.5);
e('file:clients/shared/web-contracts/src/engagements.ts', 'file:clients/shared/web-contracts/tests/contracts.test.ts', 'tested_by', 0.5);
e('file:clients/shared/web-contracts/src/stream-events.ts', 'file:clients/shared/web-contracts/tests/contracts.test.ts', 'tested_by', 0.5);
e('file:clients/cli/src/hooks/useAgent.ts', 'file:clients/cli/vitest.config.ts', 'related', 0.5);

// ── calls / barrel relations ──
e('function:clients/shared/streaming/src/sse.ts:decodeSse', 'class:clients/shared/streaming/src/sse.ts:SseDecoder', 'calls', 0.8);
e('file:clients/shared/streaming/src/index.ts', 'file:clients/shared/streaming/src/constants.ts', 'related', 0.5);
e('file:clients/shared/streaming/src/index.ts', 'file:clients/shared/streaming/src/utils.ts', 'related', 0.5);
e('file:clients/shared/streaming/src/index.ts', 'file:clients/shared/streaming/src/sse.ts', 'related', 0.5);
e('file:clients/shared/streaming/src/index.ts', 'file:clients/shared/streaming/src/normalize.ts', 'related', 0.5);
e('file:clients/shared/streaming/src/index.ts', 'file:clients/shared/streaming/src/sessions.ts', 'related', 0.5);
e('file:clients/shared/streaming/src/index.ts', 'file:clients/shared/streaming/src/types.ts', 'related', 0.5);

// ── configures / documents / related ──
e('config:clients/desktop/package.json', 'file:clients/desktop/src/preload.cjs', 'configures', 0.6);
e('document:clients/desktop/README.md', 'config:clients/desktop/package.json', 'documents', 0.5);
e('config:clients/launcher/internal/config/env.example', 'service:docker-compose.yml', 'configures', 0.6);
e('config:clients/launcher/internal/config/env.example', 'config:langgraph.json', 'configures', 0.6);
e('document:clients/web-raptix/docs/design-reference/imports/pasted_text/raptix-dashboard-design.md', 'document:clients/web-raptix/docs/design-reference/imports/pasted_text/project-workspace-updates.md', 'related', 0.5);
for (const s of ['AgentRun', 'Assets', 'AttackGraph', 'Chat', 'Credentials', 'Evidence', 'KnowledgeGraph', 'Orchestrator']) {
  e(`document:clients/web-raptix/docs/design-reference/imports/pasted_text/raptix-dashboard-design.md`,
    `file:clients/web-raptix/docs/design-reference/pre-web-correct/screens/${s}.tsx`, 'documents', 0.5);
}
e('document:clients/instruction.raptix.txt', 'file:clients/cli/src/hooks/useAgent.ts', 'related', 0.5);

fs.writeFileSync(`${UA}/intermediate/batch-119.json`, JSON.stringify({
  batchIndex: 119,
  batchFiles: batch.files,
  nodes,
  edges,
}, null, 2), 'utf8');
console.log('batch-119.json:', nodes.length, 'nodes,', edges.length, 'edges');
