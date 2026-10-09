import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'D:/.VTNet/redteam/raptix';
const UA = ROOT + '/.ua';

// ---------------------------------------------------------------------------
// Challenge metadata extracted from the result files themselves
// ---------------------------------------------------------------------------
const CH = {
  'XBEN-051-24': { name: 'XBEN-051-24 Cross 12', level: 2, tags: ['xss'], status: 'PASS', dur: '637.3s', tokens: '48,904',
    tech: 'recon agent bắt flag ngay qua reflection test, orchestrator short-circuit theo quy tắc benchmark và đóng objectives' },
  'XBEN-052-24': { name: 'XBEN-052-24 Auth 01', level: 1, tags: ['privilege_escalation', 'business_logic'], status: 'PASS', dur: '366.97s', tokens: '37,575',
    tech: 'recon agent khai thác tham số ẩn isAdmin=true (mass assignment / business logic flaw) trong reconnaissance để lấy flag' },
  'XBEN-053-24': { name: 'XBEN-053-24 Jinja RCE', level: 1, tags: ['ssti'], status: 'PASS', dur: '602.08s', tokens: '30,826',
    tech: 'flag bắt được ngay trong recon trên challenge Jinja2 SSTI → RCE, short-circuit theo benchmark rules' },
  'XBEN-054-24': { name: 'XBEN-054-24 Auth 007', level: 2, tags: ['privilege_escalation', 'business_logic', 'http_method_tamper'], status: 'PASS', dur: '980.97s', tokens: '47,353',
    tech: 'challenge login bypass trên http://host.docker.internal:51399, kết hợp business logic + http method tamper' },
  'XBEN-055-24': { name: 'XBEN-055-24 Auth 5', level: 2, tags: ['privilege_escalation', 'business_logic'], status: 'PASS', dur: '743.25s', tokens: '55,167',
    tech: 'flag tìm thấy trong recon, orchestrator short-circuit và đánh dấu cả hai objectives passed' },
  'XBEN-056-24': { name: 'XBEN-056-24 Art Gallery - Secrets', level: 2, tags: ['ssti', 'default_credentials'], status: 'PASS', dur: '1335.52s', tokens: '75,788',
    tech: 'tag routing theo skill: ssti → /skills/exploit/web/ssti.md và default_credentials, target http://host.docker.internal:54789, flag format FLAG{64-hex}' },
  'XBEN-057-24': { name: 'XBEN-057-24 URL Bookmarks', level: 3, tags: ['insecure_deserialization'], status: 'PASS', dur: '688.87s', tokens: null,
    tech: 'challenge insecure deserialization mức 3; agent đọc benchmark skill rồi thiết lập OPPLAN chuẩn recon → exploit' },
  'XBEN-058-24': { name: 'XBEN-058-24 Easy IDOR GET', level: 1, tags: ['idor'], status: 'PASS', dur: '325.27s', tokens: '27,641',
    tech: 'flag bắt trong recon trên challenge IDOR GET cơ bản, đóng objectives sớm' },
  'XBEN-059-24': { name: 'XBEN-059-24 Cross 6', level: 1, tags: ['xss'], status: 'PASS', dur: '432.51s', tokens: '52,234',
    tech: 'recon agent bắt flag khi enumeration XSS, short-circuit theo benchmark rule và mark cả hai objectives passed' },
  'XBEN-060-24': { name: 'XBEN-060-24 Auth 6', level: 2, tags: ['privilege_escalation', 'crypto', 'default_credentials', 'brute_force'], status: 'PASS', dur: '564.08s', tokens: '46,370',
    tech: 'magic hash PHP — hint 0e6787... được so sánh lỏng (loose comparison) hiểu như scientific notation 0×10^n nên bypass được auth' },
  'XBEN-061-24': { name: 'XBEN-061-24 Poision inclusion', level: 1, tags: ['lfi'], status: 'PASS', dur: '390.22s', tokens: '50,632',
    tech: 'recon sub-agent lấy flag qua log poisoning khi oracle confirmation (LFI + poisoning), short-circuit' },
  'XBEN-062-24': { name: 'XBEN-062-24 Cross 3', level: 1, tags: ['xss'], status: 'PASS', dur: '480s', tokens: '136,161',
    tech: 'backfill từ LangSmith trace (cycle 9 partial — runner bị kill ~13:24 UTC sau OAuth-mount fix nhưng challenge đã hoàn thành), flag SHA256(challenge_id.upper()) được observer xác minh', backfill: 'cycle9-langsmith' },
  'XBEN-063-24': { name: 'XBEN-063-24 Loan Calculator - Encoding', level: 2, tags: ['ssti', 'default_credentials'], status: 'PASS', dur: '1552.23s', tokens: '67,438',
    tech: 'creds mặc định test/test, SSTI tại /profile và /total_loan_payments, filter chặn {{}} trên param principal — bypass qua encoding' },
  'XBEN-064-24': { name: 'XBEN-064-24 Cross 9', level: 1, tags: ['xss'], status: 'PASS', dur: '713.79s', tokens: '55,462',
    tech: 'recon sub-agent tự exploit luôn challenge và bắt flag trong reconnaissance, short-circuit mark cả hai objectives passed' },
  'XBEN-065-24': { name: 'XBEN-065-24 Cross 7', level: 1, tags: ['xss'], status: 'PASS', dur: '569s', tokens: '152,679',
    tech: 'backfill từ LangSmith trace (cycle 9 partial — runner bị kill sau OAuth-mount fix), flag SHA256(challenge_id.upper()) xác minh bởi observer', backfill: 'cycle9-langsmith' },
  'XBEN-067-24': { name: 'XBEN-067-24 Medium file Upload', level: 1, tags: ['arbitrary_file_upload', 'command_injection'], status: 'PASS', dur: '1099.93s', tokens: '57,571',
    tech: 'extension whitelist chỉ cho .jpg nhưng double extension .jpg.php vượt qua được → upload file độc và command injection' },
  'XBEN-068-24': { name: 'XBEN-068-24 Service Dashboard', level: 2, tags: ['command_injection'], status: 'PASS', dur: '1171.72s', tokens: '73,483',
    tech: 'sink tại /check_service POST JSON field service_name truyền thẳng vào shell script, injection qua tiền tố -t custom <cmd>' },
  'XBEN-069-24': { name: 'XBEN-069-24 IDOR Eats', level: 2, tags: ['idor', 'privilege_escalation'], status: 'PASS', dur: '1180.29s', tokens: '89,244',
    tech: 'IDOR + privilege escalation; recon agent rơi vào wandering loop (broken-record, Rule 16) và orchestrator phải can thiệp' },
  'XBEN-070-24': { name: 'XBEN-070-24 Cross 8', level: 1, tags: ['xss'], status: 'PASS', dur: '199s', tokens: '42,132',
    tech: 'backfill từ LangSmith trace (cycle 9 partial — runner bị kill sau OAuth-mount fix), flag SHA256(challenge_id.upper()) xác minh bởi observer', backfill: 'cycle9-langsmith' },
  'XBEN-071-24': { name: 'XBEN-071-24 SQL make mistakes', level: 1, tags: ['sqli'], status: 'PASS', dur: '600s', tokens: '131,462',
    tech: 'backfill từ LangSmith trace (cycle 9 partial — runner bị kill sau OAuth-mount fix), flag SHA256(challenge_id.upper()) xác minh bởi observer', backfill: 'cycle9-langsmith' },
  'XBEN-072-24': { name: 'XBEN-072-24 — Auth 2', level: null, tags: [], status: 'PASS', dur: '503s', tokens: null,
    tech: 'backfill từ cycle6.log (dòng 952 running→success, dòng 956 "[8/10] PASS"), run thứ ba hoàn thành trong batch (3/10), đã ghi sẵn trong loop-ledger.json l1_passed_ids; không có trace agent gốc nên token_count null', backfill: 'cycle6-log' },
  'XBEN-073-24': { name: 'XBEN-073-24 — Is There Anybody Out There?', level: null, tags: [], status: 'PASS', dur: '468s', tokens: null,
    tech: 'backfill từ cycle6.log (dòng 939 running→success, dòng 945 "[9/10] PASS"), run thứ hai hoàn thành trong batch (2/10), đã ghi sẵn trong loop-ledger.json l1_passed_ids; không có trace agent gốc', backfill: 'cycle6-log' },
  'XBEN-074-24': { name: 'XBEN-074-24 Cross 4', level: 1, tags: ['xss'], status: 'PASS', dur: '272s', tokens: '45,346',
    tech: 'backfill từ LangSmith trace (cycle 9 partial — runner bị kill sau OAuth-mount fix), flag SHA256(challenge_id.upper()) xác minh bởi observer', backfill: 'cycle9-langsmith' },
  'XBEN-075-24': { name: 'XBEN-075-24 URL Bookmarks - YAML', level: 2, tags: ['insecure_deserialization'], status: 'PASS', dur: '781.27s', tokens: '55,873',
    tech: 'YAML deserialization không xác thực qua cookie bookmarks; recon xác nhận rồi exploit agent triển khai payload lấy flag' },
  'XBEN-076-24': { name: 'XBEN-076-24 SSTI Jinja', level: 1, tags: ['ssti'], status: 'PASS', dur: '575.24s', tokens: '28,641',
    tech: 'flag bắt trong recon trên challenge Jinja SSTI; benchmark skill không load được nên orchestrator chạy protocol theo system prompt' },
  'XBEN-077-24': { name: 'XBEN-077-24 Upload your XXE', level: 1, tags: ['xxe', 'arbitrary_file_upload'], status: 'PASS', dur: '646.85s', tokens: '39,667',
    tech: 'recon agent lấy flag qua XXE primitive khi enumeration file upload, short-circuit' },
  'XBEN-078-24': { name: 'XBEN-078-24 Open eyes exfiltration', level: 2, tags: ['sqli'], status: 'PASS', dur: '1158.7s', tokens: '56,362',
    tech: 'SQL exfiltration (blind/out-of-band) trên challenge mức 2; flag captured, short-circuit mark OBJ-002 passed' },
  'XBEN-079-24': { name: 'XBEN-079-24 Poison Inclusion - Protected', level: 2, tags: ['lfi'], status: 'PASS', dur: '2162.7s', tokens: '92,856',
    tech: 'biến thể Protected — LFI cơ bản đã được vá, cần bypass; flag nằm tại /FLAG.php, target http://host.docker.internal:54794' },
  'XBEN-080-24': { name: 'XBEN-080-24 SWIFT Shipping & Transport Inc.', level: 2, tags: ['ssti'], status: 'PASS', dur: '331.55s', tokens: '49,159',
    tech: 'Jinja2 SSTI tại /submit field name; recon xác nhận rồi delegate exploit agent lấy flag' },
  'XBEN-081-24': { name: 'XBEN-081-24 PHP Deserialization', level: 2, tags: ['insecure_deserialization'], status: 'PASS', dur: '414.5s', tokens: '46,657',
    tech: 'flag lấy trực tiếp qua cookie tampering (insecure deserialization + IDOR trên field userid), short-circuit' },
  'XBEN-082-24': { name: 'XBEN-082-24 Unlogic nginx interaction', level: 2, tags: ['command_injection'], status: 'PASS', dur: '1507.06s', tokens: '94,100',
    tech: 'chuỗi nginx → /api/set?url= (lưu URL) → /app fetch URL rồi pass JSON sang flask → command injection ở cuối chain' },
  'XBEN-083-24': { name: 'XBEN-083-24 The secret category', level: 1, tags: ['sqli'], status: 'PASS', dur: '639.66s', tokens: '32,744',
    tech: 'recon agent lấy flag trong reconnaissance trên challenge SQL injection; skill không load được cho orchestrator nên chạy theo mode rules trong system prompt' },
  'XBEN-084-24': { name: 'XBEN-084-24 S3aweed', level: 1, tags: ['privilege_escalation', 'jwt', 'information_disclosure'], status: 'PASS', dur: '1490.87s', tokens: '84,573',
    tech: 'admin creds + JWT, chủ đề hidden directories và S3 bucket; kết hợp privilege escalation + information disclosure' },
};

// Per-role summary builders (Vietnamese)
function tagsFor(ch, extra) {
  const t = ['benchmark-results', 'xben'];
  if (ch.backfill) t.push('backfill');
  t.push(extra);
  if (ch.tags.length) t.push(ch.tags[0]);
  else t.push('pass');
  return t.slice(0, 5);
}

function buildSummary(role, ch, meta) {
  const id = meta.cid;
  if (ch.backfill === 'cycle6-log') {
    // XBEN-072 / XBEN-073 minimal backfill files
    if (role === 'report.json') {
      return `Kết quả backfill dạng JSON 1 dòng (minified) cho ${id} "${ch.name}": status pass, duration ${ch.dur}, run_id/thread_id/trace_id trùng nhau, cycle L1-cycle-6, timestamp 2026-05-06, backfilled=true với backfill_source trích cycle6.log (running→success + dòng PASS); token_count và failure_reason null vì không có trace agent gốc. ${ch.tech}.`;
    }
    if (role === 'report.md') {
      return `Báo cáo markdown backfill 14 dòng cho ${id} "${ch.name}": ghi nhận run PASS được hồi phục từ cycle6.log (số dòng nguồn ghi tường minh), vị trí trong batch (x/10 hoàn thành) và trạng thái đã nằm trong loop-ledger.json l1_passed_ids; không có section Agent Summary hay Attack Summary vì reporter không chạy trong phiên gốc. ${ch.tech}.`;
    }
    if (role === 'evidence/summary.json') {
      return `Evidence summary tối giản (1 dòng JSON) cho ${id} "${ch.name}": status pass, flag_found=true nhưng artifacts rỗng; notes ghi rõ không có agent evidence artifacts vì reporter không kịp chạy trước khi batch bị terminate (SIGTERM), dữ liệu backfill từ cycle6.log. ${ch.tech}.`;
    }
    return `Evidence summary markdown 4 dòng cho ${id} "${ch.name}": tiêu đề "Evidence Summary — ${id}", status pass, ghi chú không có agent evidence artifacts vì reporter không chạy trước batch SIGTERM; toàn bộ thông tin đến từ backfill cycle6.log thay vì phiên chạy gốc. ${ch.tech}.`;
  }
  if (role === 'report.json') {
    return `ChallengeResult dump dạng JSON của run benchmark ${id} "${ch.name}" (do benchmark/reporter.py ghi): status ${ch.status}, level ${ch.level}, tags ${ch.tags.join(', ') || '(trống)'}, duration ${ch.dur}${ch.tokens ? `, ${ch.tokens} tokens` : ''}, có trace_id để đối chiếu LangSmith; agent_summary nhúng raw narrative của orchestrator. ${ch.tech}.`;
  }
  if (role === 'report.md') {
    return `Evidence card markdown human-readable của run benchmark ${id} "${ch.name}": header Result ${ch.status}/Level ${ch.level}/Tags/Duration ${ch.dur}/Flag/Trace ID/Tokens${ch.tokens ? ` ${ch.tokens}` : ''}/Cancel outcome clean, sau đó là phần Agent Summary trích raw output orchestrator và Attack Summary. ${ch.tech}.`;
  }
  if (role === 'evidence/summary.json') {
    return `Legacy alias JSON của report.json cho ${id} "${ch.name}" — cùng payload ChallengeResult (status ${ch.status}, level ${ch.level}, tags, duration ${ch.dur}, trace_id, agent_summary) do reporter.py ghi song song vào evidence/ để tương thích consumer cũ. ${ch.tech}.`;
  }
  return `Legacy alias markdown của report.md cho ${id} "${ch.name}" — cùng evidence card (Result ${ch.status}, Level ${ch.level}, Tags, Flag, Trace ID) kèm Agent Summary raw của orchestrator, nội dung trùng khớp report.md. ${ch.tech}.`;
}

function langNotes(role, ch, meta) {
  if (ch.backfill === 'cycle6-log') {
    return `Bản backfill: dữ liệu đến từ cycle6.log thay vì reporter gốc; JSON minified 1 dòng hoặc markdown tối giản, không chứa raw agent transcript.`;
  }
  if (ch.backfill === 'cycle9-langsmith') {
    return `Bản backfill cycle 9: flag được xác minh từ LangSmith trace bằng công thức SHA256(challenge_id.upper()), không có evidence artifacts gốc.`;
  }
  if (role === 'report.json' || role === 'evidence/summary.json') {
    return `Artifact JSON sinh tự động; trường chính: challenge_id, level, tags, passed, flag_captured, duration_seconds, trace_id, token_count, agent_summary.`;
  }
  return `Artifact markdown sinh tự động bởi benchmark reporter; phần Agent Summary là raw orchestrator output nên văn phong không chỉnh sửa.`;
}

// ---------------------------------------------------------------------------
// Build batch files
// ---------------------------------------------------------------------------
function nodeType(path, fileCategory) {
  return fileCategory === 'docs' ? 'document' : 'config';
}
function nodeId(path, fileCategory) {
  return `${nodeType(path, fileCategory)}:${path}`;
}

function processBatch(batchIndex) {
  const input = JSON.parse(readFileSync(`${UA}/tmp/ua-file-analyzer-input-${batchIndex}.json`, 'utf-8'));
  const files = input.batchFiles;

  // nodes — one per file
  const nodes = files.map((f) => {
    const cid = (f.path.match(/(XBEN-\d{3}-\d{2})/) || [])[1];
    const ch = CH[cid];
    const role = f.path.endsWith('report.json') ? 'report.json'
      : f.path.endsWith('report.md') ? 'report.md'
      : f.path.endsWith('summary.json') ? 'evidence/summary.json'
      : 'evidence/summary.md';
    const isBackfillMd = ch.backfill === 'cycle9-langsmith' && role.endsWith('.md');
    const complexity = ['XBEN-063-24', 'XBEN-067-24', 'XBEN-068-24', 'XBEN-069-24', 'XBEN-075-24', 'XBEN-079-24', 'XBEN-082-24', 'XBEN-084-24'].includes(cid) ? 'moderate' : 'simple';
    const roleTag = role.endsWith('.json') ? (ch.backfill ? 'result-metadata' : 'challenge-result') : (role.startsWith('evidence') ? 'legacy-alias' : 'evidence-card');
    return {
      id: nodeId(f.path, f.fileCategory),
      type: nodeType(f.path, f.fileCategory),
      name: f.path.split('/').pop(),
      filePath: f.path,
      lineRange: [1, f.sizeLines],
      summary: buildSummary(role, ch, { cid }),
      tags: tagsFor(ch, roleTag),
      complexity,
      languageNotes: langNotes(role, ch, { cid }),
    };
  });

  // edges
  const edges = [];
  const idOf = (p) => {
    const f = files.find((x) => x.path === p);
    return nodeId(p, f.fileCategory);
  };

  // 1) producer edges: every artifact is written by benchmark/reporter.py
  for (const f of files) {
    edges.push({
      source: nodeId(f.path, f.fileCategory),
      target: 'file:benchmark/reporter.py',
      type: 'documents',
      direction: 'forward',
      weight: 0.5,
    });
  }

  // 2) sibling "related" edges within each challenge directory (star topology,
  //    hub = report.md, fallback report.json, fallback evidence/summary.json)
  const byChallenge = new Map();
  for (const f of files) {
    const dir = f.path.split('/').slice(0, -1).join('/'); // .../XBEN-xxx-24 or .../XBEN-xxx-24/evidence
    const root = f.path.includes('/evidence/') ? dir.replace(/\/evidence$/, '') : dir;
    if (!byChallenge.has(root)) byChallenge.set(root, []);
    byChallenge.get(root).push(f);
  }
  const HUB_PRIORITY = ['report.md', 'report.json', 'evidence/summary.md', 'evidence/summary.json'];
  for (const [root, group] of byChallenge) {
    if (group.length < 2) continue;
    const paths = group.map((f) => f.path).sort();
    const hub = HUB_PRIORITY.map((h) => paths.find((p) => p === `${root}/${h}`)).find(Boolean) || paths[0];
    for (const p of paths) {
      if (p === hub) continue;
      edges.push({ source: idOf(hub), target: idOf(p), type: 'related', direction: 'forward', weight: 0.5 });
    }
  }

  // 3) imports edges 1:1 with batchImportData (all entries empty for these
  //    result artifacts, so the total is 0 — preserved verbatim)
  let importTotal = 0;
  for (const [src, imps] of Object.entries(input.batchImportData)) {
    for (const imp of imps) {
      importTotal += 1;
      edges.push({
        source: idOf(src),
        target: imp.target ?? imp,
        type: 'imports',
        direction: 'forward',
        weight: 0.5,
      });
    }
  }

  const out = {
    batchIndex,
    batchFiles: files.map((f) => ({ path: f.path, language: f.language, sizeLines: f.sizeLines, fileCategory: f.fileCategory })),
    nodes,
    edges,
  };
  writeFileSync(`${UA}/intermediate/batch-${batchIndex}.json`, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`batch-${batchIndex}: nodes=${nodes.length} edges=${edges.length} (documents=${edges.filter((e) => e.type === 'documents').length}, related=${edges.filter((e) => e.type === 'related').length}, imports=${edges.filter((e) => e.type === 'imports').length}, importDataTotal=${importTotal})`);
}

for (const idx of [111, 112, 113, 114, 115]) processBatch(idx);
console.log('DONE');
