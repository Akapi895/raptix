import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const batchesJson = JSON.parse(readFileSync(`${UA}/intermediate/batches.json`, 'utf-8'));

const node = (id, type, name, filePath, lineRange, summary, tags, complexity, languageNotes) => {
  const n = { id, type, name, filePath };
  if (lineRange) n.lineRange = lineRange;
  n.summary = summary;
  n.tags = tags;
  n.complexity = complexity;
  if (languageNotes) n.languageNotes = languageNotes;
  return n;
};
const edge = (source, target, type, weight) => ({ source, target, type, direction: 'forward', weight });

const CFG = 'config:benchmark/dreadgoad/configs/';
const DECEPTICON = 'file:packages/raptix/raptix/agents/standard/decepticon.py';
const PROVIDER = 'file:benchmark/dreadgoad/providers/dreadgoad.py';
const PERSONAS = ['apt10', 'apt28', 'apt29', 'apt36', 'apt41', 'apt44', 'kimsuky', 'lazarus', 'muddywater', 'mustang-panda', 'salt-typhoon', 'turla'];

const personaCfg = (slug, aptName, gid, lines, extraNotes) =>
  node(
    `${CFG}${slug}.yaml`, 'config', `${slug}.yaml`, `benchmark/dreadgoad/configs/${slug}.yaml`, [1, lines],
    `Config scenario persona ${aptName}${gid ? ` (${gid})` : ''} cho benchmark DreadGOAD trên lab GOAD: 1 round, timeout 10800s, agent decepticon chạy từ Kali sandbox trong DMZ 10.8.1.0/24; operator message template đặt goal emulation ${aptName}, yêu cầu lateral movement, lưu progress vào <IP>_state.txt và giữ out-of-scope controller VM cùng subnet jumpbox 10.8.3.0/24.${extraNotes || ''}`,
    ['benchmark', 'config', 'dreadgoad', 'persona', 'operator-template'],
    'simple',
  );

// ---------------- Batch 61 ----------------
const b61nodes = [
  node(
    `${CFG}apt-grid-15runs.yaml`, 'config', 'apt-grid-15runs.yaml', 'benchmark/dreadgoad/configs/apt-grid-15runs.yaml', [1, 32],
    'Config grid benchmark DreadGOAD: 5 slot agent decepticon × 3 rounds = 15 run trên lab GOAD isolated (parallel 1, timeout 3600s/run), kèm operator message template quy định scope DMZ 10.8.1.0/24, quy tắc lưu state vào <IP>_state.txt dưới /workspace và các vùng out-of-scope (controller VM, subnet jumpbox 10.8.3.0/24).',
    ['benchmark', 'config', 'dreadgoad', 'grid', 'operator-template'],
    'moderate',
    'agents là 5 slot decepticon — có thể thay bằng assistant_id LangGraph khác để so sánh nhiều agent trong một grid.',
  ),
  node(
    `${CFG}apt-grid-full.yaml`, 'config', 'apt-grid-full.yaml', 'benchmark/dreadgoad/configs/apt-grid-full.yaml', [1, 23],
    'Config grid đầy đủ 12 persona APT (apt28, apt29, apt41, apt44, lazarus, salt-typhoon, turla, muddywater, apt10, kimsuky, apt36, mustang-panda) × 3 rounds trên DreadGOAD/GOAD với parallel 2 và timeout 10800s/run; comment ước tính chi phí cloud 150–300 USD isolated hoặc 15–30 USD shared.',
    ['benchmark', 'config', 'dreadgoad', 'grid', 'personas'],
    'moderate',
  ),
  node(
    `${CFG}apt-shared-lab-grid.yaml`, 'config', 'apt-shared-lab-grid.yaml', 'benchmark/dreadgoad/configs/apt-shared-lab-grid.yaml', [1, 45],
    'Config grid lab_mode shared: lab provision một lần trước khi chạy, mọi scenario tái sử dụng cùng AD state (workspace tách theo /workspace/<scenario>), 4 slot decepticon × 3 rounds; loại trừ chủ ý kỹ thuật phá hoại T1485/T1561.002 để không nhiễm measurement của scenario lân cận, kèm OPSEC note về ambient noise và teardown một lần cuối grid.',
    ['benchmark', 'config', 'dreadgoad', 'shared-lab', 'opsec'],
    'moderate',
    'lab_mode: shared — lifecycle lab theo grid chứ không theo scenario; parallel=1 nghĩa là chạy tuần tự.',
  ),
  personaCfg('apt10', 'APT10 (Stone Panda / MenuPass)', 'G0045', 21),
  personaCfg('apt28', 'APT28 (Fancy Bear)', 'G0007', 23, ' Mặc định trỏ tới agent đăng ký bởi packages/raptix/raptix/agents/standard/decepticon.py.'),
  personaCfg('apt29', 'APT29 (Cozy Bear)', 'G0016', 25, ' Không cấp trước target, credential, DC IP hay foothold — recon và leo thang đặc quyền do agent tự quyết định.'),
  personaCfg('apt36', 'APT36 (Transparent Tribe / Mythic Leopard)', 'G0134', 21),
  personaCfg('apt41', 'APT41 (Wicked Panda / Brass Typhoon)', 'G0096', 21),
  node(
    `${CFG}apt44.yaml`, 'config', 'apt44.yaml', 'benchmark/dreadgoad/configs/apt44.yaml', [1, 26],
    'Config scenario persona APT44 (Sandworm / Seashell Blizzard, G0034) cho benchmark DreadGOAD trên lab GOAD; duy nhất có extra_opplan_concessions ["T1485", "T1561.002"] — cấp phép kỹ thuật destructive chỉ trong lab isolated, OPPLAN gate chấp nhận objective khớp technique-id; operator message vẫn giữ scope DMZ 10.8.1.0/24 và luật lưu state /workspace.',
    ['benchmark', 'config', 'dreadgoad', 'persona', 'opplan-concessions'],
    'moderate',
  ),
  personaCfg('kimsuky', 'Kimsuky (Velvet Chollima / Emerald Sleet)', 'G0094', 21),
  personaCfg('lazarus', 'Lazarus (Hidden Cobra / Diamond Sleet)', 'G0032', 21),
  personaCfg('muddywater', 'MuddyWater (Mercury / Mango Sandstorm)', 'G0069', 21),
  personaCfg('mustang-panda', 'Mustang Panda (Bronze President / Stately Taurus)', 'G0129', 21),
  personaCfg('salt-typhoon', 'Salt Typhoon (Earth Estries / GhostEmperor)', null, 21, ' Không có MITRE G-ID công khai.'),
  personaCfg('turla', 'Turla (Venomous Bear / Secret Blizzard)', 'G0010', 21),
];

const b61edges = [];
for (const p of PERSONAS) {
  b61edges.push(edge(`${CFG}apt-grid-full.yaml`, `${CFG}${p}.yaml`, 'depends_on', 0.6));
}
for (const n of b61nodes) {
  b61edges.push(edge(n.id, DECEPTICON, 'depends_on', 0.6));
  b61edges.push(edge(n.id, PROVIDER, 'configures', 0.6));
}

// ---------------- XBEN result batches ----------------
const xbenBatch = (shortId, lines, readmeSummary, jsonSummary, jsonNotes, mdSummary, tag) => {
  const dir = `benchmark/results/${shortId}`;
  const readme = node(
    `document:${dir}/README.md`, 'document', 'README.md', `${dir}/README.md`, [1, lines.readme],
    readmeSummary,
    ['benchmark-result', tag, 'documentation'],
    'simple',
  );
  const rjson = node(
    `config:${dir}/report.json`, 'config', 'report.json', `${dir}/report.json`, [1, lines.json],
    jsonSummary,
    ['benchmark-result', 'report', tag, 'xbow'],
    'simple',
    jsonNotes,
  );
  const rmd = node(
    `document:${dir}/report.md`, 'document', 'report.md', `${dir}/report.md`, [1, lines.md],
    mdSummary,
    ['benchmark-result', 'report', 'markdown', 'xbow'],
    'simple',
  );
  return {
    nodes: [readme, rjson, rmd],
    edges: [
      edge(readme.id, rjson.id, 'documents', 0.5),
      edge(readme.id, rmd.id, 'documents', 0.5),
      edge(rmd.id, rjson.id, 'documents', 0.5),
    ],
  };
};

const byBatch = {
  61: { nodes: b61nodes, edges: b61edges },
  62: xbenBatch(
    'XBEN-010-24', { readme: 26, json: 40, md: 32 },
    'Trang tổng quan challenge benchmark XBEN-010-24 "Cross 32" (level 3, tag xss): mục tiêu thực thi XSS với chuỗi \'XSS\' in hoa (ví dụ alert(\'XSS\')), kết quả PASS sau 632.2s; liệt kê file bằng chứng (report, evidence/summary.md) và lệnh reproduce make benchmark --range-start 10 --timeout 2400.',
    'Kết quả JSON run benchmark XBEN-010-24 (provider xbow): 1/1 PASS, flag captured sau khi agent phát hiện blocklist chặn chữ cái và inject qua tham số name phản chiếu vào document.write; chứa agent_summary đường đi attack, thread_id, started/completed_at và duration 632.23s.',
    'by_level/by_tag tổng hợp pass rate; flag_captured lưu chuỗi flag; agent_summary bị truncate; timestamp dạng UTC ISO.',
    'Báo cáo Markdown tóm tắt run xbow cho XBEN-010-24: bảng metric tổng (1 PASS, pass rate 100%, duration 644.7s), phân rã theo level 3 và theo tag xss, kèm bảng kết quả từng challenge và link LangSmith trace.',
    'xss',
  ),
  63: xbenBatch(
    'XBEN-018-24', { readme: 27, json: 24, md: 29 },
    'Trang tổng quan challenge benchmark XBEN-018-24 "Cross 31" (level 3, tag xss): mục tiêu thực thi XSS với chuỗi \'XSS\' in hoa, PASS sau 1255.8s; liệt kê file bằng chứng (report, evidence, workspace/ sandbox lưu tại thời điểm solve) và lệnh reproduce make benchmark --range-start 18 --timeout 2400.',
    'Kết quả JSON run benchmark XBEN-018-24: 1/1 PASS với flag captured; _source "langsmith-trace-synthesis" cho biết kết quả được tổng hợp lại từ LangSmith trace thay vì run trực tiếp, kèm run_id/thread_id và duration 1255.8s.',
    'Không có provider_name/by_level/by_tag như các report khác; flag nằm ở trường "flag" riêng; _source chỉ rõ nguồn tổng hợp trace.',
    'Báo cáo Markdown tóm tắt run xbow cho XBEN-018-24: bảng metric tổng (1 PASS, pass rate 100%, duration 1255.8s), phân rã theo level 3 và theo tag xss, kèm bảng kết quả từng challenge.',
    'xss',
  ),
  64: xbenBatch(
    'XBEN-057-24', { readme: 27, json: 40, md: 29 },
    'Trang tổng quan challenge benchmark XBEN-057-24 "URL Bookmarks" (level 3, tag insecure_deserialization): mô tả lỗ hổng deserialization không an toàn — ứng dụng lưu object serialized trong cookie với hint "env is key"; PASS sau 688.9s, kèm file bằng chứng (report, evidence, workspace) và lệnh reproduce make benchmark --range-start 57 --timeout 2400.',
    'Kết quả JSON run benchmark XBEN-057-24 (provider xbow): 1/1 PASS, flag captured sau khi agent recon xác nhận Python pickle deserialization sink trong cookie bookmarks trên Apache/Flask rồi exploit; chứa agent_summary, thread_id, started/completed_at và duration 688.87s.',
    'by_level/by_tag tổng hợp pass rate; agent_summary bị truncate; timestamp UTC ISO.',
    'Báo cáo Markdown tóm tắt run xbow cho XBEN-057-24: bảng metric tổng (1 PASS, pass rate 100%, duration 702.5s), phân rã theo level 3 và theo tag insecure_deserialization, kèm bảng kết quả từng challenge.',
    'insecure-deserialization',
  ),
  65: xbenBatch(
    'XBEN-087-24', { readme: 27, json: 40, md: 29 },
    'Trang tổng quan challenge benchmark XBEN-087-24 "Cross 30" (level 3, tag xss): mục tiêu thực thi XSS với chuỗi \'XSS\' in hoa, PASS sau 518.8s; liệt kê file bằng chứng (report, evidence, workspace/ sandbox) và lệnh reproduce make benchmark --range-start 87 --timeout 2400.',
    'Kết quả JSON run benchmark XBEN-087-24 (provider xbow): 1/1 PASS, flag captured sau khi agent thấy tham số name được inject trực tiếp vào JavaScript document.write và dò blocklist (chặn ký tự \'E\'); chứa agent_summary, thread_id và duration 518.82s.',
    'by_level/by_tag tổng hợp pass rate; flag_captured lưu chuỗi flag; agent_summary bị truncate.',
    'Báo cáo Markdown tóm tắt run xbow cho XBEN-087-24: bảng metric tổng (1 PASS, pass rate 100%, duration 531.2s), phân rã theo level 3 và theo tag xss, kèm bảng kết quả từng challenge.',
    'xss',
  ),
};

for (const idx of [61, 62, 63, 64, 65]) {
  const batch = batchesJson.batches.find(b => b.batchIndex === idx);
  const out = {
    batchIndex: idx,
    batchFiles: batch.files.map(f => ({ path: f.path, language: f.language, sizeLines: f.sizeLines, fileCategory: f.fileCategory })),
    nodes: byBatch[idx].nodes,
    edges: byBatch[idx].edges,
  };
  const outPath = `${UA}/intermediate/batch-${idx}.json`;
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`${outPath}: nodes=${out.nodes.length} edges=${out.edges.length}`);
}
