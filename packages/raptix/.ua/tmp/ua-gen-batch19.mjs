import { generate } from './ua-gen-engine.mjs';

const R = 'raptix/tools/reporting/';

const files = {
  [R + '__init__.py']: {
    summary: 'Barrel package của bộ reporting: re-export các renderer HackerOne, Bugcrowd, executive summary, SARIF, timeline và công cụ CVSS.',
    tags: ['barrel', 'entry-point', 'reporting'],
    complexity: 'simple',
    symbolTags: ['reporting', 'facade'],
  },
  [R + 'bugcrowd.py']: {
    summary: 'Render danh sách findings thành CSV theo mẫu tribun Bugcrowd (nộp trực tiếp lên chương trình bounty).',
    tags: ['reporting', 'bugcrowd', 'csv', 'export'],
    complexity: 'simple',
    symbolTags: ['reporting', 'bugcrowd', 'csv'],
  },
  [R + 'cvss.py']: {
    summary: 'Tính điểm CVSS 3.1 đầy đủ: parse vector, base/environmental score, làm tròn theo spec và band severity; kèm tool cho agent.',
    tags: ['cvss', 'scoring', 'security', 'reporting'],
    complexity: 'moderate',
    symbolTags: ['cvss', 'scoring', 'security'],
  },
  [R + 'executive.py']: {
    summary: 'Render executive summary markdown: đếm findings theo severity, top kill-chain và CVE được exploit từ findings graph.',
    tags: ['reporting', 'executive-summary', 'markdown'],
    complexity: 'moderate',
    symbolTags: ['reporting', 'executive-summary'],
  },
  [R + 'hackerone.py']: {
    summary: 'Chuyển findings graph thành báo cáo HackerOne markdown theo cấu trúc tiêu chuẩn (title, severity, steps, impact) sẵn sàng nộp.',
    tags: ['reporting', 'hackerone', 'markdown', 'export'],
    complexity: 'moderate',
    symbolTags: ['reporting', 'hackerone', 'markdown'],
  },
  [R + 'kg_adapter.py']: {
    summary: 'Adapter đọc findings graph từ KG store Neo4j sang dạng payload reporting dùng chung (node/edge props đã coerce).',
    tags: ['knowledge-graph', 'adapter', 'reporting'],
    complexity: 'moderate',
    symbolTags: ['knowledge-graph', 'adapter', 'reporting'],
  },
  [R + 'sarif.py']: {
    summary: 'Render findings graph thành SARIF 2.1.0: rules ổn định theo ID, mapping level theo severity, location URI và partial fingerprints.',
    tags: ['reporting', 'sarif', 'ci-cd', 'export'],
    complexity: 'moderate',
    symbolTags: ['reporting', 'sarif', 'export'],
  },
  [R + 'timeline.py']: {
    summary: 'Trích timeline sự kiện từ findings graph: sắp theo thời gian và nhóm theo giai đoạn tấn công.',
    tags: ['reporting', 'timeline', 'triage'],
    complexity: 'simple',
    symbolTags: ['reporting', 'timeline'],
  },
  [R + 'tools.py']: {
    summary: 'Registry các tool reporting cho agent: report_hackerone, report_bugcrowd_csv, report_executive, report_timeline và report_sarif với JSON schema.',
    tags: ['tools', 'reporting', 'langchain', 'entry-point'],
    complexity: 'moderate',
    symbolTags: ['tool', 'reporting', 'langchain'],
  },
  'tests/unit/reporting/test_cvss.py': {
    summary: 'Kiểm thử CVSS: đối chiếu điểm chuẩn chính thức, prefix 3.0, security requirements, band severity và xử lý vector lỗi.',
    tags: ['test', 'cvss', 'scoring'],
    complexity: 'simple',
    symbolTags: ['test', 'cvss', 'reporting'],
  },
  'tests/unit/reporting/test_hackerone.py': {
    summary: 'Kiểm thử HackerOneReport.to_markdown và render_hackerone_markdown: cấu trúc mục, severity, CVSS và trường thiếu.',
    tags: ['test', 'hackerone', 'reporting'],
    complexity: 'moderate',
    symbolTags: ['test', 'hackerone', 'reporting'],
  },
  'tests/unit/reporting/test_reporting.py': {
    summary: 'Kiểm thử nhanh các renderer HackerOne, Bugcrowd, executive và timeline trên graph giả được seed sẵn.',
    tags: ['test', 'reporting', 'renderers'],
    complexity: 'simple',
    symbolTags: ['test', 'reporting', 'renderers'],
  },
  'tests/unit/reporting/test_reporting_tools_and_executive.py': {
    summary: 'Kiểm thử chi tiết executive summary (đếm severity, top chains/cves) và toàn bộ tool reporting với graph fixture phong phú.',
    tags: ['test', 'reporting', 'executive-summary', 'tools'],
    complexity: 'complex',
    symbolTags: ['test', 'reporting', 'tools'],
  },
  'tests/unit/reporting/test_sarif.py': {
    summary: 'Kiểm thử SARIF: shape schema, mapping level, result/location, rule id ổn định và tool report_sarif.',
    tags: ['test', 'sarif', 'reporting'],
    complexity: 'moderate',
    symbolTags: ['test', 'sarif', 'reporting'],
  },
};

const symbols = {
  [R + 'bugcrowd.py::render_bugcrowd_csv']: { summary: 'Sinh chuỗi CSV findings theo cột mẫu Bugcrowd, escape an toàn và sắp theo severity.', tags: ['bugcrowd', 'csv', 'export'] },

  [R + 'cvss.py::CVSSError']: { summary: 'Exception khi vector CVSS không hợp lệ hoặc thiếu trường bắt buộc.', tags: ['error-handling', 'cvss'] },
  [R + 'cvss.py::severity_band']: { summary: 'Ánh xạ điểm CVSS sang band severity (None/Low/Medium/High/Critical) theo ngưỡng chuẩn.', tags: ['cvss', 'severity'] },
  [R + 'cvss.py::parse_vector']: { summary: 'Parse chuỗi vector CVSS 3.1 thành dict metric, kiểm tra hợp lệ và chuẩn hóa thứ tự.', tags: ['cvss', 'parsing'] },
  [R + 'cvss.py::base_score']: { summary: 'Tính base score CVSS 3.1 từ các metric theo công thức spec, làm tròn 1 chữ số thập phân.', tags: ['cvss', 'scoring'], complexity: 'moderate' },
  [R + 'cvss.py::environmental_score']: { summary: 'Tính environmental score với security requirements (CR/IR/AR) và metric bổ sung Modified*.', tags: ['cvss', 'scoring'], complexity: 'moderate' },
  [R + 'cvss.py::score_vector']: { summary: 'Tổng hợp điểm base + environmental cho một vector và trả kết quả kèm severity band.', tags: ['cvss', 'scoring'] },
  [R + 'cvss.py::cvss_score_tool']: { summary: 'Tool cho agent: nhận vector CVSS, trả điểm và band; lỗi trả dict error thay vì raise.', tags: ['tool', 'cvss', 'langchain'] },

  [R + 'executive.py::_top_chains']: { summary: 'Chọn top kill-chain từ findings graph theo độ dài và severity.', tags: ['executive-summary', 'chains'] },
  [R + 'executive.py::render_executive_summary']: { summary: 'Render executive summary markdown: tổng quan số lượng, findings nghiêm trọng nhất, chains và CVE nổi bật.', tags: ['executive-summary', 'markdown', 'reporting'], complexity: 'moderate' },

  [R + 'hackerone.py::HackerOneReport']: { summary: 'Model một báo cáo HackerOne dựng từ finding: tiêu đề, severity, CVSS, steps và impact.', tags: ['data-model', 'hackerone'] },
  [R + 'hackerone.py::render_hackerone_markdown']: { summary: 'Render findings graph thành bộ báo cáo HackerOne markdown, một mục cho mỗi finding chất lượng nộp.', tags: ['hackerone', 'markdown', 'export'], complexity: 'moderate' },

  [R + 'kg_adapter.py::load_engagement_graph']: { summary: 'Đọc node/edge của engagement từ KG store và coerce props thành payload reporting dùng chung.', tags: ['knowledge-graph', 'adapter'], complexity: 'complex' },

  [R + 'sarif.py::render_sarif']: { summary: 'Render findings graph thành tài liệu SARIF 2.1.0 hoàn chỉnh với runs, rules và results.', tags: ['sarif', 'export', 'reporting'], complexity: 'moderate' },
  [R + 'sarif.py::_build_rules']: { summary: 'Dựng danh sách rules SARIF từ các loại finding với mô tả và help URI.', tags: ['sarif', 'rules'] },
  [R + 'sarif.py::_result_for']: { summary: 'Chuyển một finding node thành SARIF result kèm level và location.', tags: ['sarif', 'mapping'] },
  [R + 'sarif.py::_sarif_level']: { summary: 'Ánh xạ severity finding sang level SARIF (note/warning/error).', tags: ['sarif', 'mapping'] },
  [R + 'sarif.py::_stable_rule_id']: { summary: 'Sinh rule id ổn định từ loại finding để tái sử dụng giữa các lần chạy.', tags: ['sarif', 'naming'], complexity: 'moderate' },
  [R + 'sarif.py::_location_for']: { summary: 'Dựng physical location SARIF từ node (file URI hoặc endpoint).', tags: ['sarif', 'location'] },
  [R + 'sarif.py::_result_tags']: { summary: 'Gắn tags cho SARIF result từ CWE/CVE/labels của finding.', tags: ['sarif', 'tags'] },
  [R + 'sarif.py::_partial_fingerprints']: { summary: 'Sinh partialFingerprints ổn định để CI khớp kết quả giữa các lần quét.', tags: ['sarif', 'fingerprint'] },

  [R + 'timeline.py::TimelineEvent']: { summary: 'Dataclass một sự kiện timeline: thời điểm, loại sự kiện và mô tả.', tags: ['data-model', 'timeline'] },
  [R + 'timeline.py::extract_timeline']: { summary: 'Trích danh sách TimelineEvent từ findings graph, sắp theo thời gian tăng dần.', tags: ['timeline', 'reporting'] },

  [R + 'tools.py::_load']: { summary: 'Load findings graph cho tool reporting: từ payload inline hoặc qua KG adapter.', tags: ['tool', 'loading', 'knowledge-graph'] },
  [R + 'tools.py::report_hackerone']: { summary: 'Tool sinh báo cáo HackerOne markdown từ findings graph.', tags: ['tool', 'hackerone', 'reporting'] },
  [R + 'tools.py::report_bugcrowd_csv']: { summary: 'Tool sinh CSV Bugcrowd từ findings graph.', tags: ['tool', 'bugcrowd', 'reporting'] },
  [R + 'tools.py::report_executive']: { summary: 'Tool sinh executive summary markdown.', tags: ['tool', 'executive-summary', 'reporting'] },
  [R + 'tools.py::report_timeline']: { summary: 'Tool trích timeline sự kiện tấn công từ findings graph.', tags: ['tool', 'timeline', 'reporting'] },
  [R + 'tools.py::report_sarif']: { summary: 'Tool render findings graph thành SARIF để tích hợp CI/GitHub code scanning.', tags: ['tool', 'sarif', 'reporting'] },

  'tests/unit/reporting/test_reporting.py::_seeded_graph': { summary: 'Fixture dựng findings graph giả với nhiều node finding cho test renderer.', tags: ['test', 'fixture', 'graph'] },
  'tests/unit/reporting/test_sarif.py::_seeded_graph': { summary: 'Fixture findings graph cho test render SARIF.', tags: ['test', 'fixture', 'graph'] },
  'tests/unit/reporting/test_reporting_tools_and_executive.py::_rich_graph': { summary: 'Fixture graph phong phú (chains, CVE, validated) cho test executive và tools.', tags: ['test', 'fixture', 'graph'] },
};

const calls = [
  { source: `function:${R}tools.py:report_hackerone`, target: `function:${R}hackerone.py:render_hackerone_markdown` },
  { source: `function:${R}tools.py:report_bugcrowd_csv`, target: `function:${R}bugcrowd.py:render_bugcrowd_csv` },
  { source: `function:${R}tools.py:report_executive`, target: `function:${R}executive.py:render_executive_summary` },
  { source: `function:${R}tools.py:report_timeline`, target: `function:${R}timeline.py:extract_timeline` },
  { source: `function:${R}tools.py:report_sarif`, target: `function:${R}sarif.py:render_sarif` },
  { source: `function:${R}tools.py:_load`, target: `function:${R}kg_adapter.py:load_engagement_graph` },
];

generate(19, { files, symbols, calls });
