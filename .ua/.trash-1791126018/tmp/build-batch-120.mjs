import fs from 'node:fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const batches = JSON.parse(fs.readFileSync(`${UA}/intermediate/batches.json`, 'utf8'));
const batch = batches.batches.find(b => b.batchIndex === 120);

const nodes = [];
const edges = [];
const add = o => nodes.push(o);
const e = (source, target, type, weight) => edges.push({ source, target, type, direction: 'forward', weight });
const SR = 'clients/web-raptix/docs/design-reference/pre-web-correct/screens';

// ── design reference screens (batch 120 portion) ──
add({
  id: `file:${SR}/Phases.tsx`,
  type: 'file',
  name: 'Phases.tsx',
  filePath: `${SR}/Phases.tsx`,
  lineRange: [1, 334],
  summary: 'Màn hình tham chiếu Phases (pre-web-correct): timeline 6 phase engagement — Intake & Planning, Reconnaissance, Vulnerability Assessment, Exploitation, Post-Exploitation, Reporting; mỗi Phase có status done/active/hitl/pending (hitl = "Needs Approval" nổi đỏ #EE0033), progress %, owner/agentName, ngày start/end, số logs/findings, cờ checkpoint cho hành động nguy hiểm, description; chọn phase xem chi tiết (InfoRow), nút HITL mở approval flow (onHitl); StatusChip hiển thị icon+màu theo trạng thái.',
  tags: ['design-reference', 'phases', 'timeline', 'hitl', 'demo'],
  complexity: 'moderate',
});
add({
  id: `file:${SR}/ProjectList.tsx`,
  type: 'file',
  name: 'ProjectList.tsx',
  filePath: `${SR}/ProjectList.tsx`,
  lineRange: [1, 298],
  summary: 'Màn hình tham chiếu Projects: danh sách engagement với header đếm active/total + nút Create Project đỏ #EE0033; tab lọc theo status (all/active/completed/paused/planning) + search theo tên/client/scopeType; ProjectCard hiển thị status badge, vai trò user (Owner/Member/Viewer theo roleConfig màu), phase hiện tại với màu riêng (phaseColors), stats (DatabaseIcon assets, AlertTriangleIcon findings, BotIcon agents), menu 3 chấm, nút mở project; StatItem nhỏ cho số liệu.',
  tags: ['design-reference', 'project-list', 'filter', 'cards', 'demo'],
  complexity: 'moderate',
});
add({
  id: `file:${SR}/ProjectOverview.tsx`,
  type: 'file',
  name: 'ProjectOverview.tsx',
  filePath: `${SR}/ProjectOverview.tsx`,
  lineRange: [1, 399],
  summary: 'Màn hình tham chiếu Project Overview — executive summary của engagement: trạng thái project (pill PROJECT_STATUS active/planning/paused/completed), PulsingDot nhấp nháy khi run đang chạy (useRunSnapshot), MetricCard thẻ số liệu, section header có nút textLink điều hướng; hiển thị objective/scope, team, phase progress, agents spawn, findings/assets, recent logs/activity; hành động onHitl và onNewChat (New Chat mở Operator Console); styled bằng inline CSSProperties (card/label/pill/btnPrimary), responsive qua useNarrowViewport.',
  tags: ['design-reference', 'overview', 'dashboard', 'metrics', 'demo'],
  complexity: 'moderate',
});
for (const [file, name, [s, ee], sum, tags, cx] of [
  [`${SR}/Phases.tsx`, 'Phases', [121, 314], 'Screen Phases (default export): state phase đang chọn (mặc định assessment), danh sách phase cards + chi tiết bên phải với InfoRow, nút mở HITL approval cho checkpoint.', ['screen', 'phases', 'reference'], 'complex'],
  [`${SR}/Phases.tsx`, 'InfoRow', [325, 334], 'Hàng label/value trong chi tiết phase, hỗ trợ mono + highlight.', ['screen', 'ui', 'row'], 'simple'],
  [`${SR}/ProjectList.tsx`, 'ProjectList', [40, 145], 'Screen Projects (default export): state filter/search/menu, lọc theo status + từ khoá, render header, filter bar, grid ProjectCard.', ['screen', 'projects', 'reference'], 'complex'],
  [`${SR}/ProjectList.tsx`, 'ProjectCard', [147, 277], 'Card project: status badge, tên + client + scope, phase hiện tại, stats assets/findings/agents, avatar nhóm + role, last activity, menu ngữ cảnh 3 chấm (menuOpen), click để vào project.', ['screen', 'card', 'project'], 'moderate'],
  [`${SR}/ProjectList.tsx`, 'StatItem', [279, 298], 'Item số liệu nhỏ với icon, value, label, màu đỏ/xanh tuỳ ý.', ['screen', 'ui', 'stats'], 'simple'],
  [`${SR}/ProjectOverview.tsx`, 'textLink', [75, 89], 'Button dạng link đỏ có chevron — điều hướng section (VD "View all findings").', ['screen', 'ui', 'link'], 'simple'],
  [`${SR}/ProjectOverview.tsx`, 'MetricCard', [91, 101], 'Thẻ metric: icon + tiêu đề uppercase + children nội dung số liệu.', ['screen', 'ui', 'card'], 'simple'],
  [`${SR}/ProjectOverview.tsx`, 'ProjectOverview', [111, 399], 'Screen Overview (default export): tổng hợp trạng thái run (useRunSnapshot), thẻ metric (agents, findings, assets, logs), section phase/findings/recent activity, nút HITL + New Chat, điều hướng qua navigate(screen).', ['screen', 'overview', 'reference'], 'complex'],
]) {
  add({ id: `function:${file}:${name}`, type: 'function', name, filePath: file, lineRange: [s, ee], summary: sum, tags, complexity: cx });
}
for (const [file, names] of [
  [`${SR}/Phases.tsx`, ['Phases', 'InfoRow']],
  [`${SR}/ProjectList.tsx`, ['ProjectList', 'ProjectCard', 'StatItem']],
  [`${SR}/ProjectOverview.tsx`, ['textLink', 'MetricCard', 'ProjectOverview']],
]) {
  for (const n of names) edges.push({ source: `file:${file}`, target: `function:${file}:${n}`, type: 'contains', direction: 'forward', weight: 1 });
}
edges.push({ source: `file:${SR}/Phases.tsx`, target: `function:${SR}/Phases.tsx:Phases`, type: 'exports', direction: 'forward', weight: 0.8 });
edges.push({ source: `file:${SR}/ProjectList.tsx`, target: `function:${SR}/ProjectList.tsx:ProjectList`, type: 'exports', direction: 'forward', weight: 0.8 });
edges.push({ source: `file:${SR}/ProjectOverview.tsx`, target: `function:${SR}/ProjectOverview.tsx:ProjectOverview`, type: 'exports', direction: 'forward', weight: 0.8 });

// ── lint configs ──
add({
  id: 'config:clients/web-raptix/eslint.config.mjs',
  type: 'config',
  name: 'eslint.config.mjs',
  filePath: 'clients/web-raptix/eslint.config.mjs',
  lineRange: [1, 38],
  summary: 'ESLint flat config của web-raptix (browser): ignores dist/node_modules/.figma/docs/design-reference/test-results/playwright-report và toàn bộ server/** (package API riêng có gate riêng); TS recommended + globals browser, plugin react-hooks (rules recommended) và react-refresh (only-export-components warn, allowConstantExport); @typescript-eslint/no-unused-vars đang warn — comment ghi rõ Phase 2 chuyển error sau dọn unused-import W04-W08; nhóm tooling (vite/vitest/playwright config, tests) dùng globals node.',
  tags: ['eslint', 'lint', 'react-hooks', 'config'],
  complexity: 'simple',
});
add({
  id: 'config:clients/web-raptix/server/eslint.config.mjs',
  type: 'config',
  name: 'eslint.config.mjs',
  filePath: 'clients/web-raptix/server/eslint.config.mjs',
  lineRange: [1, 21],
  summary: 'ESLint flat config riêng cho @raptix/web-raptix-server (Fastify API): ignores dist/node_modules/coverage/src/generated (Prisma client sinh ra); typescript-eslint recommended với rule chặt — consistent-type-imports error (prefer type imports), no-unused-vars error (bỏ qua args/caught bắt đầu _), no-explicit-any error, require-await off.',
  tags: ['eslint', 'lint', 'fastify', 'config'],
  complexity: 'simple',
});

// ── playwright configs ──
add({
  id: 'config:clients/web-raptix/playwright.config.ts',
  type: 'config',
  name: 'playwright.config.ts',
  filePath: 'clients/web-raptix/playwright.config.ts',
  lineRange: [1, 11],
  summary: 'Playwright config E2E visual mặc định: testDir tests/e2e, testMatch single-user.spec.ts, fullyParallel workers=2, baseURL http://127.0.0.1:5275, trace retain-on-failure + screenshot only-on-failure, channel chromium; webServer tự chạy `npm run preview -- --port 5275` (production build, không dev server) và không reuse server cũ.',
  tags: ['playwright', 'e2e', 'config', 'visual-baseline'],
  complexity: 'simple',
});
add({
  id: 'config:clients/web-raptix/playwright.console.config.ts',
  type: 'config',
  name: 'playwright.console.config.ts',
  filePath: 'clients/web-raptix/playwright.console.config.ts',
  lineRange: [1, 14],
  summary: 'Gate W10 — E2E real-mode Operator Console: yêu cầu env W10_TEST_WORKSPACE + W10_TEST_DATABASE_URL (phải chứa /raptix_web_w02_fresh_20261001, DB test chuyên dụng) nếu không throw ngay; chạy real-console-live.spec.ts workers=1; webServer kép — Fastify server (PORT 5285, LANGGRAPH_API_URL 2400, RAPTIX_RUNTIME_WORKSPACE_ROOT /workspace) + Vite dev VITE_DATA_MODE=real trỏ backend 5285, baseURL 5278.',
  tags: ['playwright', 'e2e', 'real-mode', 'gate-w10'],
  complexity: 'moderate',
});
add({
  id: 'config:clients/web-raptix/playwright.controls.config.ts',
  type: 'config',
  name: 'playwright.controls.config.ts',
  filePath: 'clients/web-raptix/playwright.controls.config.ts',
  lineRange: [1, 14],
  summary: 'Gate W11 — E2E real-mode điều khiển agent (controls): yêu cầu W11_TEST_WORKSPACE + W11_TEST_DATABASE_URL (DB test /raptix_web_w02_fresh_20261001); chạy real-controls-live.spec.ts workers=1; webServer kép Fastify (PORT 5286) + Vite dev real-mode (baseURL 5279).',
  tags: ['playwright', 'e2e', 'real-mode', 'gate-w11'],
  complexity: 'moderate',
});
add({
  id: 'config:clients/web-raptix/playwright.core.config.ts',
  type: 'config',
  name: 'playwright.core.config.ts',
  filePath: 'clients/web-raptix/playwright.core.config.ts',
  lineRange: [1, 12],
  summary: 'Gate W15 — E2E real-mode core flow: yêu cầu W15_TEST_WORKSPACE + W15_TEST_DATABASE_URL (DB test chuyên dụng); chạy real-core-flow-live.spec.ts workers=1; webServer kép Fastify (PORT 5297) + Vite dev real-mode (baseURL 5296).',
  tags: ['playwright', 'e2e', 'real-mode', 'gate-w15'],
  complexity: 'moderate',
});
add({
  id: 'config:clients/web-raptix/playwright.deployed.config.ts',
  type: 'config',
  name: 'playwright.deployed.config.ts',
  filePath: 'clients/web-raptix/playwright.deployed.config.ts',
  lineRange: [1, 10],
  summary: 'Playwright smoke test chạy trên Docker entrypoint đã chạy sẵn: baseURL http://127.0.0.1:3000, không dev server, không API fixtures; testMatch deployed-smoke.spec.ts, workers=1, outputDir test-results-deployed, trace retain-on-failure.',
  tags: ['playwright', 'e2e', 'deployed', 'smoke'],
  complexity: 'simple',
});
add({
  id: 'config:clients/web-raptix/playwright.findings.config.ts',
  type: 'config',
  name: 'playwright.findings.config.ts',
  filePath: 'clients/web-raptix/playwright.findings.config.ts',
  lineRange: [1, 12],
  summary: 'Gate W12 — E2E real-mode Findings: yêu cầu W12_TEST_WORKSPACE + W12_TEST_DATABASE_URL (DB test chuyên dụng); chạy real-findings-live.spec.ts workers=1; webServer kép Fastify (PORT 5291) + Vite dev real-mode (baseURL 5290).',
  tags: ['playwright', 'e2e', 'real-mode', 'gate-w12'],
  complexity: 'moderate',
});
add({
  id: 'config:clients/web-raptix/playwright.graph.config.ts',
  type: 'config',
  name: 'playwright.graph.config.ts',
  filePath: 'clients/web-raptix/playwright.graph.config.ts',
  lineRange: [1, 14],
  summary: 'Gate W13 — E2E real-mode Graph (Neo4j): yêu cầu W13_TEST_WORKSPACE + W13_TEST_DATABASE_URL và W13_NEO4J_PASSWORD (từ chối password public mặc định "raptix-graph"); chạy real-graph-live.spec.ts workers=1; webServer kép Fastify (PORT 5293, NEO4J_HTTP_URI 7475) + Vite dev real-mode (baseURL 5292).',
  tags: ['playwright', 'e2e', 'real-mode', 'neo4j', 'gate-w13'],
  complexity: 'moderate',
});
add({
  id: 'config:clients/web-raptix/playwright.logs.config.ts',
  type: 'config',
  name: 'playwright.logs.config.ts',
  filePath: 'clients/web-raptix/playwright.logs.config.ts',
  lineRange: [1, 12],
  summary: 'Gate W14 — E2E real-mode Logs & Reports: yêu cầu W14_TEST_WORKSPACE + W14_TEST_DATABASE_URL (DB test chuyên dụng); chạy real-logs-reports-live.spec.ts workers=1; webServer kép Fastify (PORT 5295) + Vite dev real-mode (baseURL 5294).',
  tags: ['playwright', 'e2e', 'real-mode', 'gate-w14'],
  complexity: 'moderate',
});
add({
  id: 'config:clients/web-raptix/playwright.planning.config.ts',
  type: 'config',
  name: 'playwright.planning.config.ts',
  filePath: 'clients/web-raptix/playwright.planning.config.ts',
  lineRange: [1, 14],
  summary: 'Gate W04 — E2E real-mode Planning: yêu cầu W04_TEST_WORKSPACE + W04_TEST_DATABASE_URL (DB test /raptix_web_w02_fresh_20261001); chạy real-planning-live.spec.ts workers=1; webServer kép Fastify (PORT 5281) + Vite dev real-mode (baseURL 5277).',
  tags: ['playwright', 'e2e', 'real-mode', 'gate-w04'],
  complexity: 'moderate',
});
add({
  id: 'config:clients/web-raptix/playwright.real.config.ts',
  type: 'config',
  name: 'playwright.real.config.ts',
  filePath: 'clients/web-raptix/playwright.real.config.ts',
  lineRange: [1, 9],
  summary: 'Playwright config real-mode tổng hợp: nếu W03_LIVE_GATE=1 chỉ chạy real-projects-live.spec.ts, ngược lại chạy cả bộ 11 real-*.spec.ts (mode/projects/console/findings/graph/logs/reports/settings/campaigns/vault/members); chỉ Vite dev với VITE_DATA_MODE=real (không Fastify) tại cổng 5276, outputDir test-results-real.',
  tags: ['playwright', 'e2e', 'real-mode', 'gate-w03'],
  complexity: 'simple',
});
add({
  id: 'config:clients/web-raptix/server/prisma.config.ts',
  type: 'config',
  name: 'prisma.config.ts',
  filePath: 'clients/web-raptix/server/prisma.config.ts',
  lineRange: [1, 15],
  summary: 'Prisma 7 CLI config cho chủ sở hữu migration mới (clients/web-raptix/server): schema prisma/schema.prisma, migrations path prisma/migrations; chỉ lệnh migration/introspection cần datasource.url — generate chủ ý chạy được không cần DATABASE_URL, nên block datasource chỉ thêm khi biến môi trường thực sự có.',
  tags: ['prisma', 'migrations', 'config', 'database'],
  complexity: 'simple',
});

// ── prisma migrations ──
add({
  id: 'schema:clients/web-raptix/server/prisma/migrations/20260412164158_init/migration.sql',
  type: 'schema',
  name: 'migration.sql',
  filePath: 'clients/web-raptix/server/prisma/migrations/20260412164158_init/migration.sql',
  lineRange: [1, 27],
  summary: 'Migration init của web-raptix-server: enum TargetType (web_url/ip_range) + EngagementStatus (draft/planning/running/completed/failed); bảng Engagement (id, name, targetType, targetValue, status mặc định draft, userId mặc định "local", threadId, workspacePath, createdAt/updatedAt) khóa chính id; index userId và status.',
  tags: ['prisma', 'migration', 'engagement', 'schema'],
  complexity: 'simple',
});
add({
  id: 'schema:clients/web-raptix/server/prisma/migrations/20260826090000_engagement_authorization_confirmation/migration.sql',
  type: 'schema',
  name: 'migration.sql',
  filePath: 'clients/web-raptix/server/prisma/migrations/20260826090000_engagement_authorization_confirmation/migration.sql',
  lineRange: [1, 2],
  summary: 'Migration thêm cột authorizationConfirmed (BOOLEAN NOT NULL DEFAULT false) vào Engagement — Autohunt yêu cầu tín hiệu ủy quyền được lưu bền vững trước khi lập kế hoạch.',
  tags: ['prisma', 'migration', 'authorization', 'roe'],
  complexity: 'simple',
});
add({
  id: 'schema:clients/web-raptix/server/prisma/migrations/20261001000000_engagement_display_name/migration.sql',
  type: 'schema',
  name: 'migration.sql',
  filePath: 'clients/web-raptix/server/prisma/migrations/20261001000000_engagement_display_name/migration.sql',
  lineRange: [1, 5],
  summary: 'Migration additive: cột displayName (TEXT, optional) — nhãn hiển thị cho operator; kèm unique index (userId, name) trên Engagement.',
  tags: ['prisma', 'migration', 'engagement', 'schema'],
  complexity: 'simple',
});
add({
  id: 'schema:clients/web-raptix/server/prisma/migrations/20261002000000_runtime_ownership/migration.sql',
  type: 'schema',
  name: 'migration.sql',
  filePath: 'clients/web-raptix/server/prisma/migrations/20261002000000_runtime_ownership/migration.sql',
  lineRange: [1, 40],
  summary: 'Migration runtime ownership: Engagement.runtimeContextLockedAt; enum ThreadKind (planning/execution), WebRequestOperation (create_thread/create_run/resume), WebRequestState (creating/accepted/uncertain/rejected); bảng EngagementThread (threadId PK, engagementId FK RESTRICT, assistantId, kind, contextHash) với unique (engagementId, threadId); bảng WebRequestLedger ledger mọi web request (requestId, operation, payloadHash, reservationToken, threadId/runId/activeThreadId, state) với CHECK ràng buộc chặt (operation=create_thread thì chưa có run; accepted phải có thread; activeThreadId khớp threadId) và unique (engagementId, requestId) + activeThreadId + (threadId, runId), index (state, updatedAt) — chống điều kiện tranh chấp khi tạo thread/run trùng.',
  tags: ['prisma', 'migration', 'runtime-ownership', 'ledger', 'idempotency'],
  complexity: 'moderate',
});
add({
  id: 'schema:clients/web-raptix/server/prisma/migrations/20261002010000_runtime_context_proof/migration.sql',
  type: 'schema',
  name: 'migration.sql',
  filePath: 'clients/web-raptix/server/prisma/migrations/20261002010000_runtime_context_proof/migration.sql',
  lineRange: [1, 1],
  summary: 'Migration 1 dòng: cột runtimeConfigHash (TEXT) trên EngagementThread — bằng chứng cấu hình runtime dùng khi tạo thread.',
  tags: ['prisma', 'migration', 'runtime'],
  complexity: 'simple',
});
add({
  id: 'schema:clients/web-raptix/server/prisma/migrations/20261002020000_runtime_dispatch_recovery/migration.sql',
  type: 'schema',
  name: 'migration.sql',
  filePath: 'clients/web-raptix/server/prisma/migrations/20261002020000_runtime_dispatch_recovery/migration.sql',
  lineRange: [1, 6],
  summary: 'Migration dispatch recovery: WebRequestLedger thêm candidateThreadId, dispatchAssistantId, dispatchKind (enum ThreadKind), dispatchConfigHash; unique index candidateThreadId — cho phép phân biệt candidate thread chưa commit với thread đã nhận, phục hồi sau dispatch không chắc chắn (uncertain).',
  tags: ['prisma', 'migration', 'dispatch', 'recovery'],
  complexity: 'simple',
});
add({
  id: 'schema:clients/web-raptix/server/prisma/migrations/20261002030000_campaign_drafts/migration.sql',
  type: 'schema',
  name: 'migration.sql',
  filePath: 'clients/web-raptix/server/prisma/migrations/20261002030000_campaign_drafts/migration.sql',
  lineRange: [1, 46],
  summary: 'Migration W17 — campaign drafts bền vững + job trung thực: bảng Campaign (engagementId FK CASCADE, name, vector, status mặc định draft, version, spec JSONB) unique (engagementId, name) + index (engagementId, status); bảng CampaignJob (campaignId FK CASCADE, kind, status mặc định "unavailable", provider, error) index (campaignId, createdAt); draft và job history sống sót qua reload, không bịa kết quả provider.',
  tags: ['prisma', 'migration', 'campaign', 'vector'],
  complexity: 'moderate',
});
add({
  id: 'schema:clients/web-raptix/server/prisma/migrations/20261002031000_vault_storage/migration.sql',
  type: 'schema',
  name: 'migration.sql',
  filePath: 'clients/web-raptix/server/prisma/migrations/20261002031000_vault_storage/migration.sql',
  lineRange: [1, 38],
  summary: 'Migration W18 — vault mã hoá phía server: bảng VaultSecret (engagementId FK CASCADE, kind, label, ciphertext + iv + authTag — DB chỉ thấy bytes mù, createdBy) index (engagementId, kind); bảng VaultAudit (engagementId, secretId, action) index (engagementId, createdAt) — audit log scope theo engagement và tồn tại kể cả khi secret bị xoá.',
  tags: ['prisma', 'migration', 'vault', 'encryption', 'audit'],
  complexity: 'moderate',
});
add({
  id: 'schema:clients/web-raptix/server/prisma/migrations/20261003000000_campaign_request_identity/migration.sql',
  type: 'schema',
  name: 'migration.sql',
  filePath: 'clients/web-raptix/server/prisma/migrations/20261003000000_campaign_request_identity/migration.sql',
  lineRange: [1, 3],
  summary: 'Migration nhận diện request CampaignJob: cột requestId + payloadHash, unique (campaignId, requestId) — idempotency cho job submit trùng.',
  tags: ['prisma', 'migration', 'idempotency', 'campaign'],
  complexity: 'simple',
});

// ── non-code edges ──
const INIT_TABLE = 'clients/web-raptix/server/prisma/migrations/20260412164158_init/migration.sql';
const OWNM_TABLE = 'clients/web-raptix/server/prisma/migrations/20261002000000_runtime_ownership/migration.sql';
const CAMP_TABLE = 'clients/web-raptix/server/prisma/migrations/20261002030000_campaign_drafts/migration.sql';
const VAULT_TABLE = 'clients/web-raptix/server/prisma/migrations/20261002031000_vault_storage/migration.sql';
const addTable = (mig, tbl, sum) => add({
  id: `table:${mig}:${tbl}`,
  type: 'table',
  name: tbl,
  filePath: mig,
  summary: sum,
  tags: ['prisma', 'table', 'postgres', 'schema'],
  complexity: 'simple',
});
addTable(INIT_TABLE, 'Engagement', 'Bảng Engagement — engagement pentest: target type/value, status, userId, threadId, workspacePath; index userId + status.');
addTable(OWNM_TABLE, 'EngagementThread', 'Bảng EngagementThread — binding thread LangGraph vào engagement: assistantId, kind planning/execution, contextHash; FK RESTRICT tới Engagement, unique (engagementId, threadId).');
addTable(OWNM_TABLE, 'WebRequestLedger', 'Bảng WebRequestLedger — ledger mọi web request tạo thread/run/resume: requestId, payloadHash, reservationToken, state creating/accepted/uncertain/rejected; unique (engagementId, requestId) chống trùng.');
addTable(CAMP_TABLE, 'Campaign', 'Bảng Campaign — draft chiến dịch vector: name, vector, status, version, spec JSONB; unique (engagementId, name), FK CASCADE tới Engagement.');
addTable(CAMP_TABLE, 'CampaignJob', 'Bảng CampaignJob — lịch sử job provider của campaign: kind, status mặc định "unavailable", provider, error; index (campaignId, createdAt).');
addTable(VAULT_TABLE, 'VaultSecret', 'Bảng VaultSecret — secret mã hoá phía server: ciphertext/iv/authTag mù với DB, kind, label, createdBy; FK CASCADE tới Engagement.');
addTable(VAULT_TABLE, 'VaultAudit', 'Bảng VaultAudit — audit log thao tác vault theo engagement (secretId, action); sống sót khi secret bị xoá.');

e('config:clients/web-raptix/eslint.config.mjs', 'config:clients/web-raptix/package.json', 'configures', 0.6);
e('config:clients/web-raptix/server/eslint.config.mjs', 'config:clients/web-raptix/server/package.json', 'configures', 0.6);
e('config:clients/web-raptix/playwright.config.ts', 'file:clients/web-raptix/tests/e2e/single-user.spec.ts', 'configures', 0.6);
e('config:clients/web-raptix/playwright.console.config.ts', 'file:clients/web-raptix/tests/e2e/real-console-live.spec.ts', 'configures', 0.6);
e('config:clients/web-raptix/playwright.controls.config.ts', 'file:clients/web-raptix/tests/e2e/real-controls-live.spec.ts', 'configures', 0.6);
e('config:clients/web-raptix/playwright.core.config.ts', 'file:clients/web-raptix/tests/e2e/real-core-flow-live.spec.ts', 'configures', 0.6);
e('config:clients/web-raptix/playwright.deployed.config.ts', 'file:clients/web-raptix/tests/e2e/deployed-smoke.spec.ts', 'configures', 0.6);
e('config:clients/web-raptix/playwright.findings.config.ts', 'file:clients/web-raptix/tests/e2e/real-findings-live.spec.ts', 'configures', 0.6);
e('config:clients/web-raptix/playwright.graph.config.ts', 'file:clients/web-raptix/tests/e2e/real-graph-live.spec.ts', 'configures', 0.6);
e('config:clients/web-raptix/playwright.logs.config.ts', 'file:clients/web-raptix/tests/e2e/real-logs-reports-live.spec.ts', 'configures', 0.6);
e('config:clients/web-raptix/playwright.planning.config.ts', 'file:clients/web-raptix/tests/e2e/real-planning-live.spec.ts', 'configures', 0.6);
e('config:clients/web-raptix/playwright.real.config.ts', 'config:clients/web-raptix/package.json', 'configures', 0.6);
e('config:clients/web-raptix/server/prisma.config.ts', 'schema:clients/web-raptix/server/prisma/migrations/20260412164158_init/migration.sql', 'configures', 0.6);
e('config:clients/web-raptix/server/prisma.config.ts', 'schema:clients/web-raptix/server/prisma/migrations/20261002000000_runtime_ownership/migration.sql', 'configures', 0.6);

// defines_schema: migration → tables
const ds = (mig, tbl) => e(`schema:${mig}`, `table:${mig}:${tbl}`, 'defines_schema', 0.9);
const INIT = 'clients/web-raptix/server/prisma/migrations/20260412164158_init/migration.sql';
const OWNM = 'clients/web-raptix/server/prisma/migrations/20261002000000_runtime_ownership/migration.sql';
const CAMP = 'clients/web-raptix/server/prisma/migrations/20261002030000_campaign_drafts/migration.sql';
const VAULT = 'clients/web-raptix/server/prisma/migrations/20261002031000_vault_storage/migration.sql';
ds(INIT, 'Engagement');
ds(OWNM, 'EngagementThread');
ds(OWNM, 'WebRequestLedger');
ds(CAMP, 'Campaign');
ds(CAMP, 'CampaignJob');
ds(VAULT, 'VaultSecret');
ds(VAULT, 'VaultAudit');

// chronology between migrations
e(`schema:${OWNM}`, `schema:${INIT}`, 'related', 0.5);
e(`schema:clients/web-raptix/server/prisma/migrations/20261002010000_runtime_context_proof/migration.sql`, `schema:${OWNM}`, 'related', 0.5);
e(`schema:clients/web-raptix/server/prisma/migrations/20261002020000_runtime_dispatch_recovery/migration.sql`, `schema:clients/web-raptix/server/prisma/migrations/20261002010000_runtime_context_proof/migration.sql`, 'related', 0.5);
e(`schema:${CAMP}`, `schema:${OWNM}`, 'related', 0.5);
e(`schema:${VAULT}`, `schema:${CAMP}`, 'related', 0.5);
e(`schema:clients/web-raptix/server/prisma/migrations/20261003000000_campaign_request_identity/migration.sql`, `schema:${CAMP}`, 'related', 0.5);
e(`schema:clients/web-raptix/server/prisma/migrations/20260826090000_engagement_authorization_confirmation/migration.sql`, `schema:${INIT}`, 'related', 0.5);
e(`schema:clients/web-raptix/server/prisma/migrations/20261001000000_engagement_display_name/migration.sql`, `schema:${INIT}`, 'related', 0.5);

// design docs → screens (batch 120 portion)
const WSU = 'document:clients/web-raptix/docs/design-reference/imports/pasted_text/project-workspace-updates.md';
e(WSU, `file:${SR}/ProjectList.tsx`, 'documents', 0.5);
e(WSU, `file:${SR}/ProjectOverview.tsx`, 'documents', 0.5);
e('document:clients/web-raptix/docs/design-reference/imports/pasted_text/raptix-dashboard-design.md', `file:${SR}/Phases.tsx`, 'documents', 0.5);
e(WSU, 'document:clients/web-raptix/docs/design-reference/imports/pasted_text/raptix-dashboard-design.md', 'related', 0.5);

fs.writeFileSync(`${UA}/intermediate/batch-120.json`, JSON.stringify({
  batchIndex: 120,
  batchFiles: batch.files,
  nodes,
  edges,
}, null, 2), 'utf8');
console.log('batch-120.json:', nodes.length, 'nodes,', edges.length, 'edges');
