// Build batch-1..5.json (nodes + edges) for Raptix file-analyzer run
const fs = require('fs');
const path = require('path');
const UA = 'D:/.VTNet/redteam/raptix/packages/raptix/.ua';
const ROOT = 'D:/.VTNet/redteam/raptix/packages/raptix';

const batches = JSON.parse(fs.readFileSync(UA + '/intermediate/batches.json', 'utf8'));
const exportsByPath = batches.exportsByPath;

const fileDict = {};
const symDict = {};
for (const i of [1, 2, 3, 4, 5]) {
  const s = require('./ua-summaries-' + i + '.cjs');
  Object.assign(fileDict, s.files);
  Object.assign(symDict, s.symbols);
}

const allRes = {};
const classNamesByPath = {};
for (let i = 1; i <= 5; i++) {
  const d = JSON.parse(fs.readFileSync(UA + '/tmp/ua-file-extract-results-' + i + '.json', 'utf8'));
  for (const r of d.results) {
    allRes[r.path] = r;
    classNamesByPath[r.path] = new Set((r.classes || []).map(c => c.name));
  }
}

const basename = p => p.split('/').pop();
const domainTag = p => {
  if (p.startsWith('tests/unit/middleware')) return 'middleware';
  if (p.startsWith('tests/unit/agents')) return 'agents';
  if (p.startsWith('tests/unit/cli')) return 'cli';
  if (p.startsWith('tests/unit/core')) return 'core';
  if (p.startsWith('tests/unit/llm')) return 'llm';
  if (p.startsWith('tests/unit/backends')) return 'backends';
  if (p.startsWith('tests/unit/sandbox_kernel')) return 'sandbox';
  if (p.startsWith('tests/unit/tools/bash')) return 'bash';
  if (p.startsWith('tests/unit/tools/web')) return 'web';
  if (p.startsWith('tests/unit/tools')) return 'tools';
  if (p.startsWith('tests/unit/blue_cell')) return 'blue-cell';
  if (p.startsWith('tests/unit/research')) return 'research';
  if (p.startsWith('tests/unit/ops')) return 'ops';
  if (p.startsWith('tests/unit/runtime')) return 'runtime';
  if (p.startsWith('tests/unit/skillogy')) return 'skillogy';
  if (p.startsWith('tests/')) return 'test';
  if (p.startsWith('raptix/middleware/')) return 'middleware';
  if (p.startsWith('raptix/cli/')) return 'cli';
  if (p.startsWith('raptix/llm/')) return 'llm';
  if (p.startsWith('raptix/core/')) return 'core';
  if (p.startsWith('raptix/agents/')) return 'agents';
  if (p.startsWith('raptix/runtime/')) return 'runtime';
  if (p.startsWith('raptix/backends/')) return 'backends';
  if (p.startsWith('raptix/blue_cell/')) return 'blue-cell';
  if (p.startsWith('raptix/sandbox_kernel/')) return 'sandbox';
  if (p.startsWith('raptix/sandbox_server/')) return 'sandbox-server';
  if (p.startsWith('raptix/tools/defense/')) return 'defense';
  if (p.startsWith('raptix/tools/research/')) return 'research';
  if (p.startsWith('raptix/tools/ops/')) return 'ops';
  if (p.startsWith('raptix/tools/web/')) return 'web';
  if (p.startsWith('raptix/tools/')) return 'tools';
  return 'code';
};

const compFile = n => n < 60 ? 'simple' : n <= 250 ? 'moderate' : 'complex';
const compSym = n => n < 20 ? 'simple' : n <= 70 ? 'moderate' : 'complex';

const verbRules = [
  [/^_?make_/, 'factory', o => 'Hàm factory tạo ' + o + ' dùng khi lắp ráp stack.'],
  [/^build_/, 'factory', o => 'Dựng ' + o + ' từ cấu hình và ngữ cảnh hiện có.'],
  [/^create_/, 'factory', o => 'Tạo ' + o + ' mới theo cấu hình/role.'],
  [/^_?parse_/, 'parsing', o => 'Phân tích ' + o + ' thành cấu trúc dữ liệu có cấu trúc.'],
  [/^_?extract_/, 'extraction', o => 'Trích xuất ' + o + ' từ dữ liệu thô.'],
  [/^_?resolve_/, 'resolution', o => 'Phân giải ' + o + ' theo ngữ cảnh hiện tại (env/config/state).'],
  [/^_?load_/, 'persistence', o => 'Nạp ' + o + ' từ đĩa/env, bỏ qua lỗi không fatal.'],
  [/^save_/, 'persistence', o => 'Lưu ' + o + ' xuống đĩa.'],
  [/^_?render_/, 'rendering', o => 'Render ' + o + ' thành dạng hiển thị cho người dùng/agent.'],
  [/^_?format_/, 'rendering', o => 'Định dạng ' + o + ' thành chuỗi chuẩn.'],
  [/^_?validate_/, 'validation', o => 'Xác thực ' + o + ' trước khi cho phép xử lý tiếp.'],
  [/^verify_/, 'validation', o => 'Xác minh tính đúng đắn của ' + o + ' (hash/chữ ký/điều kiện).'],
  [/^_?detect_/, 'detection', o => 'Phát hiện ' + o + ' từ dữ liệu quan sát được.'],
  [/^_?ingest_/, 'ingest', o => 'Ingest ' + o + ' vào knowledge graph.'],
  [/^_?fetch_/, 'network', o => 'Gọi dịch vụ ngoài lấy ' + o + ' (có xử lý lỗi mạng).'],
  [/^_?scan_/, 'scanning', o => 'Quét ' + o + ' để tìm dấu hiệu đáng chú ý.'],
  [/^_?probe_/, 'scanning', o => 'Probe ' + o + ' tới dịch vụ đích để kiểm tra thực tế.'],
  [/^_?classify_/, 'classification', o => 'Phân loại ' + o + ' theo nhóm chuẩn.'],
  [/^_?compute_/, 'computation', o => 'Tính toán ' + o + ' từ dữ liệu đầu vào.'],
  [/^_?score_/, 'computation', o => 'Tính điểm cho ' + o + '.'],
  [/^_?normalize_/, 'normalization', o => 'Chuẩn hoá ' + o + ' về dạng canonical.'],
  [/^_?canonical/, 'normalization', o => 'Chuẩn hoá ' + o + ' về dạng canonical.'],
  [/^_?analyze_/, 'analysis', o => 'Phân tích ' + o + ' và trả về kết luận.'],
  [/^_?audit_/, 'analysis', o => 'Audit ' + o + ' và trả danh sách finding.'],
  [/^_?push_/, 'integration', o => 'Đẩy ' + o + ' lên hệ thống đích (SIEM/EDR).'],
  [/^_?record_/, 'state', o => 'Ghi nhận ' + o + ' vào state/KG.'],
  [/^_?register_/, 'registration', o => 'Đăng ký ' + o + ' vào registry/backend.'],
  [/^_?apply_/, 'side-effects', o => 'Áp dụng ' + o + ' lên hệ thống hiện tại.'],
  [/^plan_/, 'planning', o => 'Lập kế hoạch ' + o + ' trên đồ thị.'],
  [/^ensure_/, 'guard', o => 'Đảm bảo ' + o + ' tồn tại/thoả điều kiện.'],
  [/^_?emit_/, 'eventing', o => 'Phát sự kiện ' + o + ' ra stream/log.'],
  [/^_?hydrate_/, 'state', o => 'Hydrate ' + o + ' từ state/configurable vào runtime.'],
  [/^_?reduce_/, 'reducer', o => 'Reducer gộp ' + o + ' giữa các lần cập nhật state.'],
  [/^_?merge_/, 'merge', o => 'Gộp ' + o + ' và loại trùng lặp.'],
  [/^_?sanitize_/, 'security', o => 'Làm sạch ' + o + ' (control chars/ANSI) trước khi xử lý tiếp.'],
  [/^_?redact_/, 'security', o => 'Redact thông tin nhạy cảm trong ' + o + '.'],
  [/^_?wrap_/, 'security', o => 'Bọc ' + o + ' bằng envelope/marker an toàn.'],
  [/^_?defang/, 'security', o => 'Defang ' + o + ' để vô hiệu hoá payload.'],
  [/^_?bind_/, 'setup', o => 'Gắn ' + o + ' vào ngữ cảnh hiện tại.'],
  [/^sync_/, 'setup', o => 'Đồng bộ ' + o + ' giữa runtime và backend.'],
  [/^install_/, 'setup', o => 'Cài đặt ' + o + ' vào stack khi điều kiện thoả.'],
  [/^seed_/, 'setup', o => 'Seed dữ liệu ' + o + ' ban đầu.'],
  [/^_?export_/, 'io', o => 'Xuất ' + o + ' ra định dạng chia sẻ.'],
  [/^_?import_/, 'io', o => 'Nhập ' + o + ' từ nguồn ngoài.'],
  [/^_?lookup_/, 'search', o => 'Tra cứu ' + o + ' trong index/cache.'],
  [/^_?search_/, 'search', o => 'Tìm kiếm ' + o + ' trong corpus/index.'],
  [/^suggest_/, 'search', o => 'Gợi ý ' + o + ' phù hợp ngữ cảnh.'],
  [/^kill_/, 'process', o => 'Kill ' + o + ' và dọn tài nguyên liên quan.'],
  [/^_?poll_/, 'polling', o => 'Poll ' + o + ' theo chu kỳ để cập nhật trạng thái.'],
  [/^_?acquire_/, 'concurrency', o => 'Acquire khóa ' + o + ' (retry khi bận).'],
  [/^_?release_/, 'concurrency', o => 'Release khóa ' + o + '.'],
  [/^_?walk_/, 'iteration', o => 'Duyệt ' + o + ' theo cây/thứ tự.'],
  [/^_?iter_/, 'iteration', o => 'Iterator lần lượt ' + o + '.'],
  [/^_?(is|has|looks|allowed|enabled)_/, 'predicate', o => 'Hàm kiểm tra điều kiện ' + o + ' (boolean helper).'],
  [/^_?get_/, 'accessor', o => 'Trả về ' + o + ' từ nguồn hiện có.'],
  [/^_?set_/, 'accessor', o => 'Thiết lập ' + o + '.'],
  [/^_?read_/, 'io', o => 'Đọc ' + o + ' qua backend/đĩa.'],
  [/^_?write_/, 'io', o => 'Ghi ' + o + ' qua backend/đĩa.'],
  [/^_?list_/, 'listing', o => 'Liệt kê ' + o + '.'],
  [/^_build_parser$/, 'cli', () => 'Dựng argparse parser cho lệnh CLI.'],
  [/^main$/, 'cli', () => 'Điểm vào xử lý tham số dòng lệnh và điều phối logic chính.'],
  [/^__getattr__$/, 'lazy', () => 'Lazy attribute: nạp thành phần khi được truy cập lần đầu.'],
  [/^__dir__$/, 'lazy', () => 'Hỗ trợ dir() cho lazy module.'],
];
function prodSummary(fname) {
  const obj = fname.replace(/^_+/, '').replace(/^[a-z]+_/, '').replace(/_/g, ' ').trim() || fname;
  for (const [re, , msg] of verbRules) {
    if (re.test(fname)) return msg(obj);
  }
  return 'Hàm ' + fname + ' — bộ phận hỗ trợ luồng xử lý chính của module.';
}
function verbTag(fname) {
  for (const [re, tag] of verbRules) if (re.test(fname)) return tag;
  return 'utility';
}
const testModule = p => basename(p).replace(/^test_/, '').replace(/\.py$/, '');
const humanCase = n => n.replace(/^test_/, '').replace(/_/g, ' ');

function symSummary(fpath, isTest, s) {
  const key = fpath + '::' + s.name;
  if (symDict[key]) return symDict[key];
  if (isTest) {
    if (s.kind === 'class') {
      if (/^Test/.test(s.name)) return 'Nhóm kiểm thử ' + s.name + ' gồm ' + ((s.methods || []).length || 'một số') + ' case trong file này.';
      return 'Test double (fake/stub) thay thế dependency trong các test của module ' + testModule(fpath) + '.';
    }
    if (/^test_/.test(s.name)) return 'Kiểm thử đơn vị case "' + humanCase(s.name) + '" cho module ' + testModule(fpath) + '.';
    return 'Hàm trợ giúp fixture/seed cho các test của module ' + testModule(fpath) + '.';
  }
  return prodSummary(s.name);
}
function symTags(fpath, isTest, s) {
  const dom = domainTag(fpath);
  if (isTest) return ['test', 'unit-test', dom];
  if (s.kind === 'class') {
    if (/Middleware$/.test(s.name)) return ['middleware', 'class', dom];
    if (/(Error|Exception)$/.test(s.name)) return ['exception', 'class', dom];
    if (/Manager$/.test(s.name)) return ['manager', 'class', dom];
    return ['class', dom, 'data-model'];
  }
  return [verbTag(s.name), dom, 'function'];
}

function symbolId(p2, name) {
  const r = allRes[p2];
  if (r) {
    if ((r.functions || []).some(f => f.name === name)) return 'function:' + p2 + ':' + name;
    if ((r.classes || []).some(c => c.name === name)) return 'class:' + p2 + ':' + name;
  }
  return (/^[A-Z]/.test(name) ? 'class:' : 'function:') + p2 + ':' + name;
}

function buildBatch(idx) {
  const b = batches.batches.find(x => x.batchIndex === idx);
  const ex = JSON.parse(fs.readFileSync(UA + '/tmp/ua-file-extract-results-' + idx + '.json', 'utf8'));
  const resByPath = {};
  for (const r of ex.results) resByPath[r.path] = r;

  const nodes = [];
  const edges = [];
  const seenNodes = new Set();
  const seenEdges = new Set();
  const addNode = n => {
    if (seenNodes.has(n.id)) throw new Error('dup node ' + n.id);
    seenNodes.add(n.id);
    nodes.push(n);
  };
  const addEdge = (source, target, type, weight) => {
    if (source === target) return;
    const k = source + '|' + target + '|' + type;
    if (seenEdges.has(k)) return;
    seenEdges.add(k);
    edges.push({ source, target, type, direction: 'forward', weight });
  };

  for (const f of b.files) {
    const isTest = f.path.startsWith('tests/');
    const dEntry = fileDict[f.path];
    if (!dEntry) throw new Error('missing file summary for ' + f.path);
    const r = resByPath[f.path];
    if (!r) throw new Error('missing extract result for ' + f.path);

    const fileId = 'file:' + f.path;
    const fileNode = {
      id: fileId, type: 'file', name: basename(f.path), filePath: f.path,
      summary: dEntry.summary, tags: dEntry.tags, complexity: compFile(r.nonEmptyLines || f.sizeLines)
    };
    if (dEntry.languageNotes) fileNode.languageNotes = dEntry.languageNotes;
    addNode(fileNode);

    const exported = new Set((r.exports || []).map(e => e.name));
    const topLevelFns = new Set((r.functions || []).map(x => x.name));
    const syms = [];
    for (const c of (r.classes || [])) {
      const span = c.endLine - c.startLine + 1;
      if (exported.has(c.name) || (c.methods || []).length >= 2 || span >= 20) {
        syms.push({ kind: 'class', name: c.name, start: c.startLine, end: c.endLine, methods: c.methods || [] });
      }
    }
    for (const fn of (r.functions || [])) {
      const span = fn.endLine - fn.startLine + 1;
      if (exported.has(fn.name) || span >= 10) {
        syms.push({ kind: 'function', name: fn.name, start: fn.startLine, end: fn.endLine });
      }
    }
    for (const s of syms) {
      const span = s.end - s.start + 1;
      const n = {
        id: s.kind + ':' + f.path + ':' + s.name, type: s.kind, name: s.name, filePath: f.path,
        lineRange: [s.start, s.end], summary: symSummary(f.path, isTest, s), tags: symTags(f.path, isTest, s), complexity: compSym(span)
      };
      addNode(n);
      addEdge(fileId, n.id, 'contains', 1.0);
      if (exported.has(s.name)) addEdge(fileId, n.id, 'exports', 0.8);
    }

    const imported = b.batchImportData[f.path] || [];
    for (const p2 of imported) addEdge(fileId, 'file:' + p2, 'imports', 0.7);

    const neighborPaths = new Set((b.neighborMap[f.path] || []).map(x => x.path));
    const importedSet = new Set(imported);

    // calls: top-level fn calls exported symbol of an imported file (unambiguous)
    const candIndex = new Map();
    for (const p2 of imported) {
      for (const nm of (exportsByPath[p2] || [])) {
        if (!candIndex.has(nm)) candIndex.set(nm, new Set());
        candIndex.get(nm).add(p2);
      }
    }
    for (const cg of (r.callGraph || [])) {
      if (!topLevelFns.has(cg.caller)) continue;
      const base = String(cg.callee).split(/[.([]/)[0].trim();
      if (!base || !candIndex.has(base)) continue;
      const paths = [...candIndex.get(base)].filter(p => p !== f.path);
      if (paths.length !== 1) continue;
      addEdge('function:' + f.path + ':' + cg.caller, symbolId(paths[0], base), 'calls', 0.8);
    }

    // inherits: class X(Base) where Base is a project class
    let src = '';
    try { src = fs.readFileSync(path.join(ROOT, f.path), 'utf8'); } catch { src = ''; }
    if (src) {
      const re = /^class\s+(\w+)\s*\(([^)]*)\)\s*:/gm;
      let m;
      while ((m = re.exec(src))) {
        const cls = m[1];
        for (let base of m[2].split(',')) {
          base = base.trim().replace(/\s*\[.*\]$/, '');
          if (!/^[A-Za-z_]\w*$/.test(base)) continue;
          const cands = new Set();
          for (const [p, set] of Object.entries(classNamesByPath)) if (set.has(base)) cands.add(p);
          for (const p2 of [...importedSet, ...neighborPaths]) {
            if ((exportsByPath[p2] || []).includes(base) && /^[A-Z]/.test(base)) cands.add(p2);
          }
          const list = [...cands].filter(p => p === f.path || importedSet.has(p) || neighborPaths.has(p));
          const final = list.length === 1 ? list : ([...cands].length === 1 ? [...cands] : []);
          if (final.length === 1 && final[0] !== f.path) {
            addEdge('class:' + f.path + ':' + cls, 'class:' + final[0] + ':' + base, 'inherits', 0.9);
          }
        }
      }
    }

    // tested_by: production -> test
    if (isTest) {
      for (const p2 of imported) {
        if (!p2.startsWith('tests/')) addEdge('file:' + p2, fileId, 'tested_by', 0.5);
      }
    }
  }

  const expectedImports = b.files.reduce((a, f) => a + (b.batchImportData[f.path] || []).length, 0);
  const actualImports = edges.filter(e => e.type === 'imports').length;
  if (expectedImports !== actualImports) throw new Error('imports mismatch batch ' + idx + ': expected ' + expectedImports + ' got ' + actualImports);
  const contains = edges.filter(e => e.type === 'contains').length;
  if (contains !== nodes.filter(n => n.type === 'function' || n.type === 'class').length) throw new Error('contains mismatch batch ' + idx);

  for (const n of nodes) {
    if (!/^(file|function|class):/.test(n.id)) throw new Error('bad id ' + n.id);
    if (!n.summary || !n.tags || n.tags.length < 3 || n.tags.length > 5) throw new Error('bad meta on ' + n.id);
    if (!['simple', 'moderate', 'complex'].includes(n.complexity)) throw new Error('bad complexity on ' + n.id);
  }
  for (const e of edges) {
    if (e.source === e.target) throw new Error('self edge ' + e.source);
    if (!seenNodes.has(e.source) && !e.source.startsWith('file:') && !/^(function|class):/.test(e.source)) throw new Error('bad edge source ' + e.source);
  }
  const dupIds = nodes.map(n => n.id).filter((v, i, a) => a.indexOf(v) !== i);
  if (dupIds.length) throw new Error('duplicate ids ' + dupIds.slice(0, 3).join(','));

  const out = { batchIndex: idx, batchFiles: b.files, nodes, edges };
  fs.writeFileSync(UA + '/intermediate/batch-' + idx + '.json', JSON.stringify(out, null, 1), 'utf8');
  const byType = {};
  for (const e of edges) byType[e.type] = (byType[e.type] || 0) + 1;
  console.log('batch', idx, '| files', b.files.length, '| nodes', nodes.length, '(fn', nodes.filter(n => n.type === 'function').length, ', cls', nodes.filter(n => n.type === 'class').length, ') | edges', edges.length, JSON.stringify(byType));
}

for (const i of [1, 2, 3, 4, 5]) buildBatch(i);
console.log('DONE');
