import fs from 'node:fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const batches = JSON.parse(fs.readFileSync(`${UA}/intermediate/batches.json`, 'utf8'));
const batch = batches.batches.find(b => b.batchIndex === 118);

const tagVi = {
  privilege_escalation: 'leo thang đặc quyền',
  jwt: 'JWT',
  information_disclosure: 'lộ thông tin',
  ssti: 'SSTI',
  business_logic: 'business logic',
  default_credentials: 'credential mặc định',
  idor: 'IDOR',
  crypto: 'crypto',
};
const tagsVi = t => (t || []).map(x => tagVi[x] || x).join(', ');

function loadJson(rel) {
  try { return JSON.parse(fs.readFileSync(`D:/.VTNet/redteam/raptix/${rel}`, 'utf8')); } catch { return null; }
}

function jsonSummary(rel, kind) {
  const j = loadJson(rel);
  if (!j) return 'Bản ghi benchmark.';
  const pass = j.passed ? 'PASS, flag đã capture' : 'FAIL';
  const dur = Math.round(j.duration_seconds ?? 0);
  const tok = j.token_count != null ? `${j.token_count.toLocaleString('en-US')} tokens` : 'không ghi token_count';
  if (kind === 'report') {
    return `Bản ghi kết quả JSON của challenge benchmark ${j.challenge_id} "${j.challenge_name}" (level ${j.level}; ${tagsVi(j.tags)}): ${pass}, duration ${dur}s (${tok}), trace_id ${j.trace_id} để map về LangSmith trace; agent_summary tóm tắt chuỗi hành động agent, kèm cancel_outcome (${j.cancel_outcome ?? 'n/a'}) và terminal_status_at_teardown (${j.terminal_status_at_teardown ?? 'n/a'}), setup_seconds ${j.setup_seconds ?? 'n/a'}.`;
  }
  return `Evidence summary JSON của challenge ${j.challenge_id} "${j.challenge_name}" (level ${j.level}; ${tagsVi(j.tags)}) — alias legacy chứa cùng payload ChallengeResult như report.json: ${pass}, duration ${dur}s (${tok}), trace_id${j.cycle ? `; cycle=${j.cycle}` : ''}.`;
}

function mdSummary(rel) {
  const j = loadJson(rel.replace(/\.md$/, '.json'));
  const id = j ? j.challenge_id : rel.split('/')[1];
  const name = j ? j.challenge_name : '';
  const pass = j ? (j.passed ? 'PASS' : 'FAIL') : '?';
  const lvl = j ? j.level : '?';
  const tags = j ? tagsVi(j.tags) : '';
  const dur = j ? Math.round(j.duration_seconds ?? 0) : '?';
  const tok = j && j.token_count != null ? `${j.token_count.toLocaleString('en-US')} tokens` : 'không ghi token_count';
  return `Evidence card markdown của ${id} "${name}": kết quả ${pass}, level ${lvl}, tags ${tags}, duration ${dur}s, flag dạng FLAG{...}, trace_id, ${tok}; phần Agent Summary trích narration từng bước của agent khi giải challenge. Sinh bởi benchmark/reporter.py.`;
}

const nodes = [];
const edges = [];
const add = o => nodes.push(o);

// ── benchmark result files ──
for (const f of batch.files.filter(f => /^benchmark\/results\/XBEN-/.test(f.path))) {
  const p = f.path;
  let id; let summary; let tags;
  const lineRange = [1, f.sizeLines];
  if (p.endsWith('/report.json')) {
    id = `config:${p}`; summary = jsonSummary(p, 'report'); tags = ['benchmark', 'xben', 'report', 'json'];
  } else if (p.endsWith('/report.md')) {
    id = `document:${p}`; summary = mdSummary(p); tags = ['benchmark', 'xben', 'evidence', 'markdown'];
  } else if (p.endsWith('/summary.json')) {
    id = `config:${p}`; summary = jsonSummary(p, 'summary'); tags = ['benchmark', 'xben', 'evidence', 'json'];
  } else {
    id = `document:${p}`; summary = mdSummary(p); tags = ['benchmark', 'xben', 'evidence', 'markdown'];
  }
  add({ id, type: id.split(':')[0], name: p.split('/').pop(), filePath: p, lineRange, summary, tags, complexity: 'simple' });
}

const reporter = 'file:benchmark/reporter.py';
for (const f of batch.files.filter(f => /^benchmark\/results\/XBEN-/.test(f.path))) {
  const p = f.path;
  const id = `${f.fileCategory === 'docs' ? 'document' : 'config'}:${p}`;
  const dir = p.split('/').slice(0, 3).join('/');
  const reportJson = `config:${dir}/report.json`;
  if (p.endsWith('/report.md')) edges.push({ source: id, target: reportJson, type: 'documents', direction: 'forward', weight: 0.5 });
  else if (p.endsWith('/summary.md')) edges.push({ source: id, target: reportJson, type: 'documents', direction: 'forward', weight: 0.5 });
  else if (p.endsWith('/summary.json')) edges.push({ source: id, target: reportJson, type: 'related', direction: 'forward', weight: 0.5 });
  else edges.push({ source: reportJson, target: reporter, type: 'related', direction: 'forward', weight: 0.5 });
}

// ── cve-bench README ──
add({
  id: 'document:benchmark/results/cve-bench/README.md',
  type: 'document',
  name: 'README.md',
  filePath: 'benchmark/results/cve-bench/README.md',
  lineRange: [1, 57],
  summary: 'Bằng chứng harness-functioning cho tích hợp CVE-Bench (dry-run offline, mocked LLM + sandbox, seed=0): bảng 3 CVE — CVE-2023-37999 FAIL (recon-only, nhánh âm tính), CVE-2024-22120 và CVE-2024-2624 PASS với conditions_met (file/database access, unauthorized admin login, privilege escalation); entrypoint `make cve-bench-dry`, output jsonl đính kèm; coverage scoring 4/8 win-condition predicates (4 còn lại do tests/test_cve_bench_scorer.py phủ); ước tính chi phí full-run 80 attempts theo 3 profile LLM (~$200-640, ~25-30h tuần tự) và trạng thái FULL RUN PENDING (cần stack LangGraph/LiteLLM/sandbox + credentials; live agent path stub NotImplementedError trong runner.py::_default_agent).',
  tags: ['cve-bench', 'dry-run', 'benchmark', 'harness'],
  complexity: 'moderate',
});
add({
  id: 'file:benchmark/results/cve-bench/dry-run-2026-06-11.jsonl',
  type: 'file',
  name: 'dry-run-2026-06-11.jsonl',
  filePath: 'benchmark/results/cve-bench/dry-run-2026-06-11.jsonl',
  lineRange: [1, 3],
  summary: 'JSONL kết quả dry-run CVE-Bench ngày 2026-06-11 — mỗi dòng một attempt: cve_id, variant one_day, mode dry-run, passed, conditions_met (ví dụ file_access + database_access; unauthorized_admin_login + privilege_escalation), evidence_keys, scored_at, duration_seconds. 2/3 attempt PASS; là output do dry_run.py sinh và được README trích dẫn làm bằng chứng.',
  tags: ['cve-bench', 'dry-run', 'jsonl', 'results'],
  complexity: 'simple',
});
add({
  id: 'config:clients/cli/package.json',
  type: 'config',
  name: 'package.json',
  filePath: 'clients/cli/package.json',
  lineRange: [1, 38],
  summary: 'Manifest workspace @raptix/cli 0.0.0 — "Decepticon Ink CLI", giao diện terminal cho LangGraph Platform agents: ESM (type: module), main dist/index.js, bin raptix-ink; scripts start/dev (tsc --watch)/build/typecheck/test (vitest run)/test:watch; deps @raptix/streaming (workspace), ink 6 + @inkjs/ui + react 19 (TUI), @langchain/langgraph-sdk, marked + marked-terminal (render markdown terminal), diff; devDeps testing-library/react, jsdom, typescript, vitest.',
  tags: ['cli', 'ink', 'workspace', 'package-json'],
  complexity: 'simple',
  languageNotes: 'Package phải chạy tsc ra dist/ vì bin trỏ dist/index.js; test dùng vitest với environment jsdom cho hook React.',
});
add({
  id: 'config:clients/cli/tsconfig.json',
  type: 'config',
  name: 'tsconfig.json',
  filePath: 'clients/cli/tsconfig.json',
  lineRange: [1, 23],
  summary: 'Cấu hình TypeScript của @raptix/cli: target ES2022, module ESNext + moduleResolution Bundler, jsx react-jsx, strict, declaration, outDir dist, rootDir src, resolveJsonModule, isolatedModules; include src/**/*, loại trừ node_modules, dist và mọi file *.test.ts(x) khỏi build.',
  tags: ['typescript', 'tsconfig', 'build', 'cli'],
  complexity: 'simple',
});
add({
  id: 'file:clients/cli/src/hooks/__fixtures__/mockStream.ts',
  type: 'file',
  name: 'mockStream.ts',
  filePath: 'clients/cli/src/hooks/__fixtures__/mockStream.ts',
  lineRange: [1, 111],
  summary: 'Fixture test cho useAgent: 3 helper mock — createMockStream bọc mảng StreamEvent thành AsyncIterable yield tuần tự với microtask break giữa các event để React batch state; createControllableStream trả ControllableStream cho test tự điều khiển emit từng event + end() (queue event + waiters cho next() gọi trước, dùng cho await act(async () => stream.emit(...))); createMockClient dựng MockClient với vi.fn() cho threads.create/getState và runs.stream/cancel (stream trả createMockStream([])), đếm threadId tăng dần.',
  tags: ['test-fixture', 'mock', 'async-iterator', 'vitest'],
  complexity: 'moderate',
  languageNotes: 'Mẫu controllable async-iterator: deliver() phân phối kết quả tới waiter đang chờ hoặc buffer; emit() await 2 lần Promise.resolve() để consumer kịp pull trước khi promise settle.',
});
add({
  id: 'file:clients/cli/src/hooks/sub-agent-sessions.test.ts',
  type: 'file',
  name: 'sub-agent-sessions.test.ts',
  filePath: 'clients/cli/src/hooks/sub-agent-sessions.test.ts',
  lineRange: [1, 83],
  summary: 'Unit test deriveSubAgentSessions (@raptix/streaming) qua helper ev() tạo StreamEvent với id/timestamp tăng dần: ghép cặp subagent_start/end thành 1 session completed; status error khi subagent_end mang status="error" (shape CLI-normalized) hoặc error=true (shape raw backend); session giữ running cho tới khi end tới; chỉ đếm tool_result + bash_result giữa start/end (ai_message không tính); bỏ qua subagent_end không có session mở; session độc lập cho subagent chạy interleaved; description fallback "Starting <agent>" khi thiếu content.',
  tags: ['test', 'vitest', 'subagent', 'streaming'],
  complexity: 'simple',
});
add({
  id: 'file:clients/cli/src/hooks/useAgent.test.tsx',
  type: 'file',
  name: 'useAgent.test.tsx',
  filePath: 'clients/cli/src/hooks/useAgent.test.tsx',
  lineRange: [1, 355],
  summary: 'Suite jsdom cho hook useAgent — vòng đời handoff engagement: mock @langchain/langgraph-sdk Client qua vi.hoisted + mockState, mock threadStore/modelOverride; dynamic import useAgent sau vi.stubEnv để INITIAL_ASSISTANT_ID đọc đúng env; dùng createControllableStream + fake timers. Ca kiểm thử: engagement_ready mid-stream lật assistantId soundwave → decepticon; handoff tự submit message đã enqueue trên thread decepticon mới (threads.create lần 2, runs.stream thứ 2 mang queued message); engagement context chỉ đi qua config.configurable (engagement_name/workspace_path/target_type/target_value/authorization_confirmed) — không bao giờ nằm trong run input (kiểm tra đệ quy bằng serialize); không có handoff → thread giữ nguyên qua 2 lần submit; hết 5 lần retry tạo thread → error "Connection failed" rồi submit lại phục hồi được; engagement_ready đơn thuần không xoá queuedMessage — chỉ nhánh handoff của handleStreamComplete xoá.',
  tags: ['test', 'react-hooks', 'handoff', 'engagement', 'vitest'],
  complexity: 'complex',
  languageNotes: 'vi.hoisted chạy trước khi vitest hoist vi.mock nên closure an toàn; vi.resetModules + dynamic import trong beforeEach để module-level env binding được đọc lại.',
});
add({
  id: 'file:clients/cli/src/keybindings/shortcuts.ts',
  type: 'file',
  name: 'shortcuts.ts',
  filePath: 'clients/cli/src/keybindings/shortcuts.ts',
  lineRange: [1, 38],
  summary: 'Registry keybinding theo pattern action-based của Claude Code: kiểu KeyAction ("app:toggleTranscript", "app:cancel") và KeyCombo (key + ctrl/shift/escape); DEFAULT_KEYBINDINGS map action → combo mặc định (ctrl+o mở transcript, ctrl+c cancel); formatKeyCombo nối chuỗi hiển thị ("ctrl+o", "Esc" khi escape); getShortcutDisplay tra combo mặc định theo action. Dùng với useKeybinding("app:toggleTranscript", handler).',
  tags: ['keybindings', 'cli', 'ink', 'shortcuts'],
  complexity: 'simple',
});
add({
  id: 'file:clients/cli/src/utils/marked-terminal.d.ts',
  type: 'file',
  name: 'marked-terminal.d.ts',
  filePath: 'clients/cli/src/utils/marked-terminal.d.ts',
  lineRange: [1, 14],
  summary: 'Khai báo kiểu (ambient module) cho package "marked-terminal" không có types: markedTerminal(options?: TerminalRendererOptions) trả MarkedExtension của marked; options gồm showSectionPrefix, reflowText, width, tab — dùng để render markdown thành text có style trong terminal Ink.',
  tags: ['typescript', 'type-declaration', 'marked', 'cli'],
  complexity: 'simple',
});

// contains + exports for code files
function contains(file, targets) {
  for (const t of targets) {
    edges.push({ source: `file:${file}`, target: t, type: 'contains', direction: 'forward', weight: 1 });
  }
}
function exportsEdge(file, targets) {
  for (const t of targets) {
    edges.push({ source: `file:${file}`, target: t, type: 'exports', direction: 'forward', weight: 0.8 });
  }
}
contains('clients/cli/src/hooks/__fixtures__/mockStream.ts', [
  'function:clients/cli/src/hooks/__fixtures__/mockStream.ts:createMockStream',
  'function:clients/cli/src/hooks/__fixtures__/mockStream.ts:createControllableStream',
  'function:clients/cli/src/hooks/__fixtures__/mockStream.ts:createMockClient',
]);
exportsEdge('clients/cli/src/hooks/__fixtures__/mockStream.ts', [
  'function:clients/cli/src/hooks/__fixtures__/mockStream.ts:createMockStream',
  'function:clients/cli/src/hooks/__fixtures__/mockStream.ts:createControllableStream',
  'function:clients/cli/src/hooks/__fixtures__/mockStream.ts:createMockClient',
]);
contains('clients/cli/src/keybindings/shortcuts.ts', [
  'function:clients/cli/src/keybindings/shortcuts.ts:formatKeyCombo',
  'function:clients/cli/src/keybindings/shortcuts.ts:getShortcutDisplay',
]);
exportsEdge('clients/cli/src/keybindings/shortcuts.ts', [
  'function:clients/cli/src/keybindings/shortcuts.ts:formatKeyCombo',
  'function:clients/cli/src/keybindings/shortcuts.ts:getShortcutDisplay',
]);

for (const [file, name, [s, e], sum, tags, cx] of [
  ['clients/cli/src/hooks/__fixtures__/mockStream.ts', 'createMockStream', [9, 18], 'Bọc mảng StreamEvent thành AsyncIterable yield tuần tự, await Promise.resolve() giữa các event để React batch state trước event kế tiếp.', ['mock', 'async-iterator', 'fixture'], 'simple'],
  ['clients/cli/src/hooks/__fixtures__/mockStream.ts', 'createControllableStream', [32, 84], 'Stream điều khiển được cho test: emit(event) phát một event (deliver tới waiter đang chờ hoặc buffer) và chờ 2 microtask để consumer pull; end() tín hiệu kết thúc stream; Symbol.asyncIterator trả iterator next() đọc từ queue hoặc treo trên waiters.', ['mock', 'async-iterator', 'backpressure'], 'moderate'],
  ['clients/cli/src/hooks/__fixtures__/mockStream.ts', 'createMockClient', [99, 111], 'Dựng MockClient vi.fn(): threads.create trả {thread_id: thread-<n>} tăng dần, threads.getState trả {values:{}}, runs.stream trả createMockStream([]), runs.cancel no-op.', ['mock', 'langgraph-sdk', 'vitest'], 'simple'],
  ['clients/cli/src/keybindings/shortcuts.ts', 'formatKeyCombo', [26, 33], 'Nối chuỗi hiển thị combo: ctrl/shift rồi key; nếu escape thì trả "Esc".', ['keybindings', 'formatting', 'cli'], 'simple'],
  ['clients/cli/src/keybindings/shortcuts.ts', 'getShortcutDisplay', [36, 38], 'Tra DEFAULT_KEYBINDINGS[action] rồi formatKeyCombo để lấy chuỗi hiển thị (vd "ctrl+o").', ['keybindings', 'lookup', 'cli'], 'simple'],
]) {
  add({ id: `function:${file}:${name}`, type: 'function', name, filePath: file, lineRange: [s, e], summary: sum, tags, complexity: cx });
}

// imports 1:1 batchImportData
edges.push({
  source: 'file:clients/cli/src/hooks/useAgent.test.tsx',
  target: 'file:clients/cli/src/hooks/__fixtures__/mockStream.ts',
  type: 'imports', direction: 'forward', weight: 0.7,
});

// tested_by + calls + configures + documents
edges.push({ source: 'file:clients/cli/src/hooks/useAgent.ts', target: 'file:clients/cli/src/hooks/useAgent.test.tsx', type: 'tested_by', direction: 'forward', weight: 0.5 });
edges.push({ source: 'file:clients/shared/streaming/src/sessions.ts', target: 'file:clients/cli/src/hooks/sub-agent-sessions.test.ts', type: 'tested_by', direction: 'forward', weight: 0.5 });
edges.push({ source: 'function:clients/cli/src/hooks/__fixtures__/mockStream.ts:createMockClient', target: 'function:clients/cli/src/hooks/__fixtures__/mockStream.ts:createMockStream', type: 'calls', direction: 'forward', weight: 0.8 });
edges.push({ source: 'function:clients/cli/src/keybindings/shortcuts.ts:getShortcutDisplay', target: 'function:clients/cli/src/keybindings/shortcuts.ts:formatKeyCombo', type: 'calls', direction: 'forward', weight: 0.8 });
edges.push({ source: 'config:clients/cli/package.json', target: 'file:clients/cli/vitest.config.ts', type: 'configures', direction: 'forward', weight: 0.6 });
edges.push({ source: 'config:clients/cli/tsconfig.json', target: 'config:clients/cli/package.json', type: 'configures', direction: 'forward', weight: 0.6 });
edges.push({ source: 'document:benchmark/results/cve-bench/README.md', target: 'file:benchmark/cve_bench/dry_run.py', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/results/cve-bench/README.md', target: 'file:benchmark/cve_bench/runner.py', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'document:benchmark/results/cve-bench/README.md', target: 'file:benchmark/results/cve-bench/dry-run-2026-06-11.jsonl', type: 'documents', direction: 'forward', weight: 0.5 });
edges.push({ source: 'file:benchmark/results/cve-bench/dry-run-2026-06-11.jsonl', target: 'file:benchmark/cve_bench/dry_run.py', type: 'related', direction: 'forward', weight: 0.5 });
edges.push({ source: 'file:clients/cli/src/utils/marked-terminal.d.ts', target: 'config:clients/cli/package.json', type: 'related', direction: 'forward', weight: 0.5 });

fs.writeFileSync(`${UA}/intermediate/batch-118.json`, JSON.stringify({
  batchIndex: 118,
  batchFiles: batch.files,
  nodes,
  edges,
}, null, 2), 'utf8');
console.log('batch-118.json:', nodes.length, 'nodes,', edges.length, 'edges');
