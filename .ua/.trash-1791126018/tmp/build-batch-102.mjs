import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const input = JSON.parse(readFileSync(`${UA}/tmp/ua-file-analyzer-input-102.json`, 'utf8'));
const out = JSON.parse(readFileSync(`${UA}/tmp/ua-file-analyzer-output-102.json`, 'utf8'));
const L = (p) => {
  const r = out.results.find((x) => x.path === p);
  return [1, r ? r.totalLines : input.batchFiles.find((f) => f.path === p).sizeLines];
};

const nodes = [];
const edges = [];

nodes.push({
  id: 'document:telemetry-gateway/README.md',
  type: 'document',
  name: 'README.md',
  filePath: 'telemetry-gateway/README.md',
  lineRange: L('telemetry-gateway/README.md'),
  summary: 'README gateway telemetry OSS (PoC, Layer 1 của docs/design/2026-06-20-telemetry-data-collection-design.md): Cloudflare Worker đứng giữa nhiều client OSS và analytics backend để bảo đảm invariant mà backend không thể tự bảo vệ — client OSS không bao giờ giữ write credential (chỉ biết public Worker URL), drop client IP ($geoip_disable, IP chỉ dùng tạm làm rate-limit key), Tier-C fail-closed (src/tierc.ts quét raw IP/cred/host, chạm là reject cả batch 422 không echo giá trị), off-contract data bị loại (Zod schema đóng 400), và rate-limit theo install_id; bảng layout 6 file (schema.ts, schema.json, tierc.ts, posthog.ts, index.ts, test/), sơ đồ data flow 5 bước tới PostHog /batch/, lệnh dev/test, hướng dẫn deploy maintainer, quy tắc sync schema.ts (Zod) ↔ schema.json (JSON Schema) và 4 next-step (Python emitter, consent CLI, TELEMETRY.md, Tier-B).',
  tags: ['telemetry', 'privacy', 'cloudflare-worker', 'posthog', 'documentation'],
  complexity: 'moderate',
});
edges.push({ source: 'document:telemetry-gateway/README.md', target: 'file:telemetry-gateway/src/index.ts', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:telemetry-gateway/README.md', target: 'file:telemetry-gateway/src/posthog.ts', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:telemetry-gateway/README.md', target: 'file:telemetry-gateway/src/schema.ts', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:telemetry-gateway/README.md', target: 'file:telemetry-gateway/src/tierc.ts', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:telemetry-gateway/README.md', target: 'file:packages/raptix/raptix/telemetry/sink.py', type: 'documents', direction: 'forward', weight: 0.5 });

nodes.push({
  id: 'document:telemetry-gateway/DEPLOY.md',
  type: 'document',
  name: 'DEPLOY.md',
  filePath: 'telemetry-gateway/DEPLOY.md',
  lineRange: L('telemetry-gateway/DEPLOY.md'),
  summary: 'Runbook deploy one-time cho maintainer (chi phí $0: Cloudflare free 100k req/day + PostHog free 1M events/mo): (1) tạo project PostHog, lấy Project API Key phc_... write-only (an toàn khi nằm trên Worker, không bao giờ ship vào client), chọn host US/EU/self-host; (2) wrangler login + wrangler secret put POSTHOG_KEY + wrangler deploy — URL public in ra sau deploy; (3) verify live: GET / trả {"service":"raptix-telemetry-gateway","ok":true}, POST event sạch mask → 202 vào PostHog, POST event chứa raw target IP → 422 không forward; (4) ship vào release OSS bằng cách set RAPTIX_TELEMETRY_ENDPOINT trong clients/launcher/internal/config/env.example (giữ RAPTIX_TELEMETRY=off, user opt-in qua onboard wizard); kèm phần rotate/disable (wrangler secret put lại hoặc wrangler delete — client gửi fail là hết, telemetry best-effort không bao giờ block run).',
  tags: ['runbook', 'deployment', 'telemetry', 'posthog', 'cloudflare-worker'],
  complexity: 'simple',
});
edges.push({ source: 'document:telemetry-gateway/DEPLOY.md', target: 'file:telemetry-gateway/src/index.ts', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:telemetry-gateway/DEPLOY.md', target: 'config:telemetry-gateway/wrangler.toml', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:telemetry-gateway/DEPLOY.md', target: 'config:telemetry-gateway/package.json', type: 'documents', direction: 'forward', weight: 0.5 });

nodes.push({
  id: 'config:telemetry-gateway/package.json',
  type: 'config',
  name: 'package.json',
  filePath: 'telemetry-gateway/package.json',
  lineRange: L('telemetry-gateway/package.json'),
  summary: 'Manifest của Worker telemetry-gateway: package private decepticon-telemetry-gateway, ESM (type module), entry src/index.ts; dependency runtime duy nhất là zod ^3.23.8 cho schema validation; devDeps @cloudflare/workers-types, typescript 5.4, vitest 2.1, wrangler 3.80; scripts: typecheck (tsc --noEmit), test (vitest run), dev (wrangler dev), deploy (wrangler deploy).',
  tags: ['package-manifest', 'cloudflare-worker', 'zod', 'typescript'],
  complexity: 'simple',
});
edges.push({ source: 'config:telemetry-gateway/package.json', target: 'file:telemetry-gateway/src/index.ts', type: 'related', direction: 'forward', weight: 0.5 });
edges.push({ source: 'config:telemetry-gateway/package.json', target: 'config:telemetry-gateway/tsconfig.json', type: 'related', direction: 'forward', weight: 0.5 });
edges.push({ source: 'config:telemetry-gateway/package.json', target: 'config:telemetry-gateway/wrangler.toml', type: 'triggers', direction: 'forward', weight: 0.5 });

nodes.push({
  id: 'config:telemetry-gateway/tsconfig.json',
  type: 'config',
  name: 'tsconfig.json',
  filePath: 'telemetry-gateway/tsconfig.json',
  lineRange: L('telemetry-gateway/tsconfig.json'),
  summary: 'TypeScript config của Worker: target ES2022, module ESNext + moduleResolution Bundler, types @cloudflare/workers-types, strict + noUnusedLocals/Parameters + noFallthroughCasesInSwitch, noEmit (wrangler tự bundle), include src và test.',
  tags: ['typescript', 'config', 'strict-mode', 'cloudflare-worker'],
  complexity: 'simple',
});
edges.push({ source: 'config:telemetry-gateway/tsconfig.json', target: 'file:telemetry-gateway/src/index.ts', type: 'configures', direction: 'forward', weight: 0.6 });

nodes.push({
  id: 'config:telemetry-gateway/wrangler.toml',
  type: 'config',
  name: 'wrangler.toml',
  filePath: 'telemetry-gateway/wrangler.toml',
  lineRange: L('telemetry-gateway/wrangler.toml'),
  summary: 'Cấu hình Cloudflare Worker decepticon-telemetry-gateway: main src/index.ts, compatibility_date 2025-06-01; [vars] không bí mật — POSTHOG_HOST mặc định US cloud (override cho EU/self-host), TELEMETRY_PATH /v1/telemetry, MAX_BODY_BYTES 262144 (256KB); binding rate-limit native [[unsafe.bindings]] RATE_LIMITER namespace 1001 cap 600 req/60s theo install_id+IP trên endpoint ingest công khai; POSTHOG_KEY là secret bắt buộc set qua wrangler secret put, không bao giờ nằm trong file này — client OSS chỉ bao giờ thấy public Worker URL.',
  tags: ['wrangler', 'cloudflare-worker', 'rate-limit', 'secrets', 'configuration'],
  complexity: 'simple',
  languageNotes: 'Deploy: npm install → npx wrangler secret put POSTHOG_KEY → npx wrangler deploy (xem telemetry-gateway/DEPLOY.md).',
});
edges.push({ source: 'config:telemetry-gateway/wrangler.toml', target: 'file:telemetry-gateway/src/index.ts', type: 'configures', direction: 'forward', weight: 0.6 });

nodes.push({
  id: 'config:telemetry-gateway/schema.json',
  type: 'config',
  name: 'schema.json',
  filePath: 'telemetry-gateway/schema.json',
  lineRange: L('telemetry-gateway/schema.json'),
  summary: 'JSON Schema (draft 2020-12) mirror language-neutral của src/schema.ts — bản Python client validate trước khi POST, Worker enforce tương đương bằng Zod lúc ingest, hai bên phải sync tay: envelope Tier-A batch yêu cầu schema_version "1.0", tier enum A/R, install_id UUID, client (raptix_version ≤32 ký tự, os linux/darwin/windows, arch/py optional), events 1-500 item; $defs.slug chuẩn hoá slug [a-z0-9][a-z0-9._-]* ≤64; event đóng additionalProperties=false với 12 type (engagement.start/end/checkpoint, agent.turn, tool.call/result, llm.call/response, finding.created, opplan.update, trajectory.step, telemetry.drop) và các field phi định danh có bậc (status ok/error, output_bucket, msgs_bucket, role human/agent/tool, text/observation/args_text ≤16000, mitre_tactics TA\\d{4}, mitre_techniques T\\d{4}(.\\d{3})?, cwe, cve).',
  tags: ['json-schema', 'telemetry', 'contract', 'privacy', 'wire-format'],
  complexity: 'moderate',
});
nodes.push({
  id: 'schema:telemetry-gateway/schema.json:tier-a-contract-json-schema',
  type: 'schema',
  name: 'tier-a-contract-json-schema',
  filePath: 'telemetry-gateway/schema.json',
  lineRange: L('telemetry-gateway/schema.json'),
  summary: 'Hợp đồng Tier-A Batch dạng JSON Schema ($id https://decepticon.dev/telemetry/tier-a-1.0.json, title Decepticon Telemetry Tier-A Batch): mirror chính xác của Zod contract trong telemetry-gateway/src/schema.ts — cùng envelope (schema_version/tier/install_id/client/events), cùng 12 event type và cùng ràng buộc allow-list đóng; là nguồn validate cho Python client trong packages/raptix/raptix/telemetry/ trước khi gửi lên gateway.',
  tags: ['schema', 'contract', 'telemetry', 'privacy'],
  complexity: 'moderate',
});
edges.push({ source: 'config:telemetry-gateway/schema.json', target: 'schema:telemetry-gateway/schema.json:tier-a-contract-json-schema', type: 'contains', direction: 'forward', weight: 1 });
edges.push({ source: 'config:telemetry-gateway/schema.json', target: 'schema:telemetry-gateway/schema.json:tier-a-contract-json-schema', type: 'defines_schema', direction: 'forward', weight: 0.9 });
edges.push({ source: 'schema:telemetry-gateway/schema.json:tier-a-contract-json-schema', target: 'schema:telemetry-gateway/src/schema.ts:tier-a-telemetry-contract', type: 'related', direction: 'forward', weight: 0.7 });
edges.push({ source: 'config:telemetry-gateway/schema.json', target: 'file:packages/raptix/raptix/telemetry/sanitizer.py', type: 'validates', direction: 'forward', weight: 0.7 });

const batch = {
  batchIndex: 102,
  batchFiles: input.batchFiles.map((f) => ({ path: f.path, language: f.language, sizeLines: f.sizeLines, fileCategory: f.fileCategory })),
  nodes,
  edges,
};
writeFileSync(`${UA}/intermediate/batch-102.json`, JSON.stringify(batch, null, 1), 'utf-8');
console.log(`batch-102.json: nodes=${nodes.length} edges=${edges.length}`);
