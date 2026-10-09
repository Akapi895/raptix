import fs from 'node:fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const ROOT = 'D:/.VTNet/redteam/raptix';
const batches = JSON.parse(fs.readFileSync(`${UA}/intermediate/batches.json`, 'utf8'));
const batch = batches.batches.find(b => b.batchIndex === 116);

const fileData = JSON.parse(fs.readFileSync(`${ROOT}/benchmark/results/XBEN-084-24/report.json`, 'utf8'));

const tagVi = {
  privilege_escalation: 'leo thang đặc quyền',
  jwt: 'JWT',
  information_disclosure: 'lộ thông tin',
  ssti: 'SSTI',
  xss: 'XSS',
  default_credentials: 'credential mặc định',
  race_condition: 'race condition',
  idor: 'IDOR',
  blind_sqli: 'blind SQL injection',
  xxe: 'XXE',
  command_injection: 'command injection',
  path_traversal: 'path traversal',
  lfi: 'LFI',
  nosqli: 'NoSQL injection',
  graphql: 'GraphQL',
  crypto: 'crypto',
  business_logic: 'business logic',
};

function tagsVi(tags) {
  return tags.map(t => tagVi[t] || t).join(', ');
}

function loadJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(`${ROOT}/${rel}`, 'utf8'));
  } catch {
    return null;
  }
}

function jsonSummary(rel, kind) {
  const j = loadJson(rel);
  if (!j) return 'Bản ghi benchmark.';
  const pass = j.passed ? 'PASS, flag đã capture' : 'FAIL';
  const dur = Math.round(j.duration_seconds ?? 0);
  const tok = j.token_count != null ? `${j.token_count.toLocaleString('en-US')} tokens` : 'không ghi token_count';
  const err = j.error ? `; error: ${String(j.error).slice(0, 80)}` : '';
  const extra = j.cycle ? `; cycle=${j.cycle}` : '';
  const backfill = j.backfilled ? `; backfilled từ ${j.backfill_source}` : '';
  if (kind === 'report') {
    return `Bản ghi kết quả JSON của challenge benchmark ${j.challenge_id} "${j.challenge_name}" (level ${j.level}; ${tagsVi(j.tags)}): ${pass}, duration ${dur}s (${tok}), trace_id ${j.trace_id} để map về LangSmith trace; agent_summary tóm tắt chuỗi hành động agent (nạp benchmark skill → OPPLAN → recon → exploit → capture flag), kèm cancel_outcome (${j.cancel_outcome ?? 'n/a'}) và terminal_status_at_teardown (${j.terminal_status_at_teardown ?? 'n/a'}), setup_seconds ${j.setup_seconds ?? 'n/a'}${err}.`;
  }
  return `Evidence summary JSON của challenge ${j.challenge_id} "${j.challenge_name}" (level ${j.level}; ${tagsVi(j.tags)}) — alias legacy chứa cùng payload ChallengeResult như report.json để tool cũ grep đúng vị trí: ${pass}, duration ${dur}s (${tok}), trace_id${extra}${backfill}${err}.`;
}

function mdSummary(rel, kind) {
  const j = loadJson(rel.replace(/\.md$/, '.json'));
  const id = j ? j.challenge_id : rel.split('/')[1];
  const name = j ? j.challenge_name : '';
  const pass = j ? (j.passed ? 'PASS' : 'FAIL') : '?';
  const lvl = j ? j.level : '?';
  const tags = j ? tagsVi(j.tags) : '';
  const dur = j ? Math.round(j.duration_seconds ?? 0) : '?';
  const tok = j && j.token_count != null ? `${j.token_count.toLocaleString('en-US')} tokens` : 'không có token_count';
  if (kind === 'report') {
    return `Evidence card markdown (đọc được cho người) của ${id} "${name}": kết quả ${pass}, level ${lvl}, tags ${tags}, duration ${dur}s, flag dạng FLAG{...}, trace_id, ${tok}, cancel outcome và trạng thái terminal lúc teardown; phần Agent Summary trích lại narration từng bước của agent (load skill → OPPLAN → recon → exploit → capture flag). Sinh bởi benchmark/reporter.py từ cùng payload với report.json.`;
  }
  return `Evidence summary markdown của ${id} "${name}" — alias legacy của report.md: ${pass}, level ${lvl}, tags ${tags}, duration ${dur}s, flag, thread ID${j && j.token_count ? '' : ' (không ghi token_count)'}; Agent Summary trích narration ngắn của agent về quá trình giải challenge. Sinh bởi benchmark/reporter.py.`;
}

const nodes = [];
const edges = [];

for (const f of batch.files) {
  const p = f.path;
  let id;
  let summary;
  let tags;
  let complexity;
  const lineRange = [1, f.sizeLines];
  if (p.endsWith('/report.json')) {
    id = `config:${p}`;
    summary = jsonSummary(p, 'report');
    tags = ['benchmark', 'xben', 'report', 'json'];
    complexity = 'simple';
  } else if (p.endsWith('/report.md')) {
    id = `document:${p}`;
    summary = mdSummary(p, 'report');
    tags = ['benchmark', 'xben', 'evidence', 'markdown'];
    complexity = 'simple';
  } else if (p.endsWith('/summary.json')) {
    id = `config:${p}`;
    summary = jsonSummary(p, 'summary');
    tags = ['benchmark', 'xben', 'evidence', 'json'];
    complexity = 'simple';
  } else {
    id = `document:${p}`;
    summary = mdSummary(p, 'summary');
    tags = ['benchmark', 'xben', 'evidence', 'markdown'];
    complexity = 'simple';
  }
  nodes.push({ id, type: id.split(':')[0], name: p.split('/').pop(), filePath: p, lineRange, summary, tags, complexity });
}

function base(p) {
  // e.g. benchmark/results/XBEN-085-24
  return p.split('/').slice(0, 3).join('/');
}

const reporter = 'file:benchmark/reporter.py';
for (const f of batch.files) {
  const p = f.path;
  const id = `${f.fileCategory === 'docs' ? 'document' : 'config'}:${p}`;
  const dir = base(p);
  const hasReport = fs.existsSync(`${ROOT}/${dir}/report.json`);
  const reportJson = `config:${dir}/report.json`;
  const reportMd = `document:${dir}/report.md`;
  const sumJson = `config:${dir}/evidence/summary.json`;
  const sumMd = `document:${dir}/evidence/summary.md`;
  if (p.endsWith('/report.md')) {
    edges.push({ source: id, target: reportJson, type: 'documents', direction: 'forward', weight: 0.5 });
  } else if (p.endsWith('/summary.md')) {
    edges.push({ source: id, target: hasReport ? reportJson : sumJson, type: 'documents', direction: 'forward', weight: 0.5 });
  } else if (p.endsWith('/summary.json')) {
    edges.push({ source: id, target: hasReport ? reportJson : reporter, type: 'related', direction: 'forward', weight: 0.5 });
  } else {
    edges.push({ source: reportJson, target: reporter, type: 'related', direction: 'forward', weight: 0.5 });
  }
}

fs.writeFileSync(`${UA}/intermediate/batch-116.json`, JSON.stringify({
  batchIndex: 116,
  batchFiles: batch.files,
  nodes,
  edges,
}, null, 2), 'utf8');
console.log('batch-116.json:', nodes.length, 'nodes,', edges.length, 'edges');
