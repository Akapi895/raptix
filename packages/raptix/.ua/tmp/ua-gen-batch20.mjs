import { generate } from './ua-gen-engine.mjs';

const E = 'raptix/skills/engine/';
const S = 'raptix/skills/engine/server/';

const files = {
  [E + '__init__.py']: {
    summary: 'Façade công khai của skills engine (Skillogy): re-export SkillEnvelope, proto dataclass và helper làm việc với backend Neo4j.',
    tags: ['barrel', 'entry-point', 'skills-engine', 'facade'],
    complexity: 'simple',
    symbolTags: ['skills-engine', 'facade'],
  },
  [E + '__main__.py']: {
    summary: 'Entry point tiến trình skills engine: dựng Neo4jBackend chờ Bolt sẵn sàng, seed graph nếu rỗng, khởi động REST và ingest embeddings nền.',
    tags: ['entry-point', 'server', 'neo4j', 'skills-engine'],
    complexity: 'moderate',
    symbolTags: ['entry-point', 'server', 'skills-engine'],
  },
  [E + 'embed_ingest.py']: {
    summary: 'Ingest embedding kỹ năng: dựng văn bản embed từ metadata, bỏ qua bản ghi chưa đổi (input sha) và ghi vector vào Neo4j theo lô.',
    tags: ['embeddings', 'ingest', 'neo4j', 'skills-engine'],
    complexity: 'simple',
    symbolTags: ['embeddings', 'ingest', 'skills-engine'],
  },
  [E + 'embeddings.py']: {
    summary: 'Client embedding tương thích OpenAI qua proxy nội bộ: cache đĩa theo sha, retry/backoff có Retry-After, batch giữ thứ tự và degrade an toàn.',
    tags: ['embeddings', 'http-client', 'cache', 'skills-engine'],
    complexity: 'complex',
    symbolTags: ['embeddings', 'client', 'cache'],
  },
  [E + 'proto/__init__.py']: {
    summary: 'Giao thức dữ liệu skills engine: các dataclass SkillMeta/SkillEnvelope và request/response cho list, load, ingest skill.',
    tags: ['protocol', 'data-model', 'skills-engine', 'serialization'],
    complexity: 'simple',
    symbolTags: ['protocol', 'data-model', 'skills-engine'],
  },
  [S + '__init__.py']: {
    summary: 'Barrel package server của skills engine: re-export build_app và Neo4jBackend.',
    tags: ['barrel', 'server', 'skills-engine'],
    complexity: 'simple',
    symbolTags: ['server', 'skills-engine'],
  },
  [S + 'app.py']: {
    summary: 'build_app: REST API cho skills engine (health, find, load, traverse, moc) trên backend Neo4j, kèm bearer auth tùy chọn.',
    tags: ['rest-api', 'server', 'skills-engine', 'fastapi'],
    complexity: 'complex',
    symbolTags: ['rest-api', 'server', 'skills-engine'],
  },
  [S + 'neo4j_backend.py']: {
    summary: 'Neo4jBackend: truy vấn đồ thị kỹ năng (find fusion keyword+vector, load envelope, traverse, MOC) với guard read-only chặn Cypher ghi.',
    tags: ['neo4j', 'cypher', 'skills-engine', 'security'],
    complexity: 'complex',
    symbolTags: ['neo4j', 'cypher', 'skills-engine'],
  },
  'tests/unit/skillogy/test_app.py': {
    summary: 'Kiểm thử REST API skills engine với backend giả: health, find, load, traverse, moc và bearer auth.',
    tags: ['test', 'rest-api', 'skills-engine'],
    complexity: 'complex',
    symbolTags: ['test', 'rest-api', 'skillogy'],
  },
  'tests/unit/skillogy/test_embed_ingest.py': {
    summary: 'Kiểm thử ingest embedding: bỏ qua khi thiếu proxy, tái embed khi nội dung/model đổi và đếm bản ghi lỗi.',
    tags: ['test', 'embeddings', 'skills-engine'],
    complexity: 'moderate',
    symbolTags: ['test', 'embeddings', 'skillogy'],
  },
  'tests/unit/skillogy/test_embeddings.py': {
    summary: 'Kiểm thử client embeddings: availability, cache hit/miss, parse response OpenAI, retry/backoff và degrade khi retry cạn.',
    tags: ['test', 'embeddings', 'retry'],
    complexity: 'complex',
    symbolTags: ['test', 'embeddings', 'skillogy'],
  },
  'tests/unit/skillogy/test_find_skill_fusion.py': {
    summary: 'Kiểm thử find skill fusion: xếp hạng khi khớp cả hai leg, tôn trọng limit, tiebreak theo tên và dedupe.',
    tags: ['test', 'search', 'skills-engine'],
    complexity: 'simple',
    symbolTags: ['test', 'search', 'skillogy'],
  },
  'tests/unit/skillogy/test_seed.py': {
    summary: 'Kiểm thử seed: chỉ chạy khi graph rỗng và bỏ qua nếu đã có dữ liệu.',
    tags: ['test', 'seed', 'skills-engine'],
    complexity: 'simple',
    symbolTags: ['test', 'seed', 'skillogy'],
  },
};

const symbols = {
  [E + '__main__.py::_setup_logging']: { summary: 'Cấu hình logging cho tiến trình engine theo mức cài đặt.', tags: ['logging', 'utility'] },
  [E + '__main__.py::_build_backend']: { summary: 'Dựng Neo4jBackend từ cấu hình Bolt URI và thông tin xác thực.', tags: ['neo4j', 'backend'] },
  [E + '__main__.py::_seed_if_empty']: { summary: 'Seed phase/asset-type/MOC vào graph nếu chưa có dữ liệu; bỏ qua khi graph đã populated.', tags: ['seed', 'neo4j'], complexity: 'moderate' },
  [E + '__main__.py::_start_rest']: { summary: 'Khởi chạy server REST (uvicorn) cho skills engine trên host/port cấu hình.', tags: ['rest-api', 'server'] },
  [E + '__main__.py::_ingest_in_background']: { summary: 'Chạy ingest embedding trong thread nền để không chặn khởi động REST.', tags: ['embeddings', 'background'] },
  [E + '__main__.py::main']: { summary: 'Orchestration khởi động engine: logging, backend, seed, REST rồi ingest embedding nền.', tags: ['entry-point', 'orchestration'], complexity: 'moderate' },

  [E + 'embed_ingest.py::build_embed_text']: { summary: 'Dựng văn bản embedding từ tên, mô tả và when_to_use, bỏ qua trường rỗng.', tags: ['embeddings', 'utility'] },
  [E + 'embed_ingest.py::ingest_embeddings']: { summary: 'Embed kỹ năng chưa có vector (so khớp input sha + model), ghi vector vào Neo4j theo lô và trả thống kê.', tags: ['embeddings', 'ingest', 'neo4j'], complexity: 'moderate' },

  [E + 'embeddings.py::embed_model']: { summary: 'Trả tên model embedding từ cấu hình proxy.', tags: ['embeddings', 'configuration'] },
  [E + 'embeddings.py::embed_dim']: { summary: 'Xác định số chiều vector embedding từ env override hoặc mặc định của model.', tags: ['embeddings', 'configuration'] },
  [E + 'embeddings.py::available']: { summary: 'Kiểm tra proxy embedding đã được cấu hình hay chưa.', tags: ['embeddings', 'availability'] },
  [E + 'embeddings.py::_request_embeddings']: { summary: 'Gọi API embeddings OpenAI-compatible, parse shape chuẩn và trả vector theo thứ tự.', tags: ['embeddings', 'http'], complexity: 'moderate' },
  [E + 'embeddings.py::_retry_after']: { summary: 'Tính thời gian chờ backoff từ header Retry-After, có trần tối đa.', tags: ['retry', 'backoff'] },
  [E + 'embeddings.py::embed_batch']: { summary: 'Embed một lô văn bản: cache hit trước, gọi proxy cho phần miss, giữ nguyên thứ tự và degrade trả None khi lỗi.', tags: ['embeddings', 'batch', 'cache'], complexity: 'complex' },
  [E + 'embeddings.py::embed_text']: { summary: 'Embed một văn bản đơn với cache; lỗi fail-fast cho truy vấn thời gian thực.', tags: ['embeddings', 'query'] },

  [E + 'proto/__init__.py::SkillMeta']: { summary: 'Metadata kỹ năng: tên, mô tả, when_to_use, path và tags.', tags: ['protocol', 'data-model'] },
  [E + 'proto/__init__.py::SkillEnvelope']: { summary: 'Phong bì kỹ năng đầy đủ: metadata + nội dung hướng dẫn, dùng cho load/ingest.', tags: ['protocol', 'data-model'] },
  [E + 'proto/__init__.py::SkillListRequest']: { summary: 'Yêu cầu liệt kê kỹ năng: query, limit và filter.', tags: ['protocol', 'data-model'] },
  [E + 'proto/__init__.py::SkillListResponse']: { summary: 'Phản hồi liệt kê: danh sách SkillMeta kèm thông tin truy vấn.', tags: ['protocol', 'data-model'] },
  [E + 'proto/__init__.py::SkillLoadRequest']: { summary: 'Yêu cầu tải nội dung đầy đủ của một kỹ năng theo path.', tags: ['protocol', 'data-model'] },
  [E + 'proto/__init__.py::SkillIngestRequest']: { summary: 'Yêu cầu ingest kỹ năng mới vào graph.', tags: ['protocol', 'data-model'] },
  [E + 'proto/__init__.py::SkillIngestResponse']: { summary: 'Phản hồi ingest: trạng thái và số node/edge đã ghi.', tags: ['protocol', 'data-model'] },

  [S + 'app.py::build_app']: { summary: 'Dựng FastAPI app cho skills engine: các endpoint health/find/load/traverse/moc, gắn backend và bearer auth tùy chọn.', tags: ['rest-api', 'fastapi', 'skills-engine'], complexity: 'complex' },

  [S + 'neo4j_backend.py::_path_under_any_prefix']: { summary: 'Kiểm tra đường dẫn kỹ năng nằm trong một trong các prefix được phép.', tags: ['security', 'validation'] },
  [S + 'neo4j_backend.py::assert_read_only']: { summary: 'Chặn câu Cypher ghi (CREATE/MERGE/DELETE/SET/CALL ghi) — chỉ cho phép đọc.', tags: ['security', 'cypher', 'guard'] },
  [S + 'neo4j_backend.py::Neo4jBackend']: { summary: 'Backend Neo4j cho skills engine: find fusion (keyword + vector), load envelope, traverse đồ thị, đọc MOC và seed; mọi truy vấn đi qua guard read-only.', tags: ['neo4j', 'cypher', 'skills-engine'], complexity: 'complex' },

  'tests/unit/skillogy/test_app.py::_FakeBackend': { summary: 'Backend giả trả dữ liệu kỹ năng cố định cho test REST API.', tags: ['test-double', 'fixture', 'backend'] },
  'tests/unit/skillogy/test_embed_ingest.py::_FakeBackend': { summary: 'Backend giả ghi nhận vector được ghi và trạng thái embedding.', tags: ['test-double', 'fixture', 'backend'] },
  'tests/unit/skillogy/test_embeddings.py::_FakeResp': { summary: 'HTTP response giả lập cho test client embeddings.', tags: ['test-double', 'fixture', 'http'] },
  'tests/unit/skillogy/test_seed.py::_FakeBackend': { summary: 'Backend giả đếm node hiện có để test logic seed-if-empty.', tags: ['test-double', 'fixture', 'backend'] },
};

const calls = [
  { source: `function:${E}__main__.py:_start_rest`, target: `function:${E}server/app.py:build_app` },
  { source: `function:${E}__main__.py:_build_backend`, target: `class:${E}server/neo4j_backend.py:Neo4jBackend` },
  { source: `function:${E}__main__.py:_seed_if_empty`, target: `class:${E}server/neo4j_backend.py:Neo4jBackend` },
  { source: `function:${E}__main__.py:_ingest_in_background`, target: `function:${E}embed_ingest.py:ingest_embeddings` },
  { source: `function:${E}embed_ingest.py:ingest_embeddings`, target: `function:${E}embeddings.py:embed_batch` },
  { source: `function:${E}embeddings.py:embed_batch`, target: `function:${E}embeddings.py:_request_embeddings` },
  { source: `function:${E}server/app.py:build_app`, target: `class:${E}server/neo4j_backend.py:Neo4jBackend` },
];

generate(20, { files, symbols, calls });
