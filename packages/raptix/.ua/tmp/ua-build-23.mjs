import { fileN, fnN, clsN, E, contains, exportsFrom, importEdges, input, finish } from './ua-helpers.mjs';

const I = 'raptix/tools/interaction';
const T = 'tests/unit/tools';

const n23 = [
  fileN(`${I}/__init__.py`,
    'Package công cụ tương tác operator: re-export ask_user_question và complete_engagement_planning dùng cho các agent cần dừng graph và hỏi người điều phối.',
    ['entry-point', 'barrel', 'interaction', 'hitl'], 'simple'),
  fileN(`${I}/ask_user.py`,
    'Tool ask_user_question: dừng graph bằng langgraph interrupt, phát custom event có cấu trúc để CLI render picker nhiều lựa chọn, validate option bằng Pydantic và trả về lựa chọn của operator (kể cả free text).',
    ['hitl', 'interaction', 'interrupt', 'pydantic'], 'moderate',
    'Dùng InjectedToolCallId để CLI dedupe emission thứ hai khi ToolNode chạy lại tool body sau resume.'),
  fileN(`${I}/complete_planning.py`,
    'Tool complete_engagement_planning: validate bundle kế hoạch engagement (authorization được confirm bằng HMAC, mọi target nằm trong RoE) rồi phát event và interrupt chờ operator chốt planning.',
    ['hitl', 'planning', 'validation', 'engagement'], 'moderate'),
  fileN(`${T}/test_ask_user_question.py`,
    'Kiểm thử ask_user_question: event payload, trả interrupt verbatim cho single/multi select, free text, giới hạn option, coerce JSON/Python literal từ local model và strip hậu tố (Recommended).',
    ['test', 'hitl', 'interaction'], 'complex'),
  fileN(`${T}/test_complete_planning.py`,
    'Kiểm thử validate_planning_bundle: chấp nhận bundle đầy đủ authorization, từ chối authorization chưa confirm và target ngoài RoE.',
    ['test', 'planning', 'validation'], 'moderate'),

  fnN(`${I}/ask_user.py`, '_strip_recommended_suffix', [32, 54],
    'Bỏ hậu tố UI "(Recommended)" khỏi câu trả lời của operator để marker hiển thị không lọt vào tool result làm model hiểu sai giá trị.',
    ['utility', 'normalization'], 'simple'),
  fnN(`${I}/ask_user.py`, '_coerce_options_list', [57, 85],
    'Coerce danh sách option từ JSON string hoặc Python literal (do local model trả chuỗi), validate label/description/extra fields và raise ValueError khi vượt MAX_OPTIONS.',
    ['validation', 'coercion', 'pydantic'], 'moderate'),
  fnN(`${I}/ask_user.py`, 'ask_user_question', [118, 187],
    '@tool chính: truncate header, coerce options, phát custom event kèm InjectedToolCallId, gọi langgraph interrupt và trả giá trị operator chọn (strip hậu tố recommended, hỗ trợ free text khi chọn Other).',
    ['langchain-tool', 'hitl', 'interrupt', 'interaction'], 'complex'),

  fnN(`${I}/complete_planning.py`, 'validate_planning_bundle', [35, 66],
    'Kiểm tra bundle planning trên filesystem: các file bắt buộc tồn tại, authorization được confirm bằng HMAC và mọi target khai báo nằm trong scope RoE; trả danh sách lỗi cụ thể.',
    ['validation', 'planning', 'security'], 'moderate'),
  fnN(`${I}/complete_planning.py`, '_runtime_context', [69, 83],
    'Đọc engagement/workspace từ runtime config (env fallback) để phục vụ validation.',
    ['utility', 'configuration'], 'simple'),
  fnN(`${I}/complete_planning.py`, 'complete_engagement_planning', [94, 123],
    '@tool chốt planning: validate bundle, trả JSON lỗi nếu chưa đạt; nếu đạt thì phát custom event và interrupt chờ operator xác nhận hoàn tất planning.',
    ['langchain-tool', 'hitl', 'planning'], 'moderate'),

  fnN(`${T}/test_ask_user_question.py`, '_invoke', [25, 52],
    'Helper gọi ask_user_question trong fake graph context, thu event và interrupt để assert.',
    ['test-fixture', 'helper'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_emits_custom_event_with_id_and_payload', [55, 83],
    'Test custom event chứa id, header, options và allow_other đúng cấu trúc.',
    ['test', 'event'], 'moderate'),
  fnN(`${T}/test_ask_user_question.py`, 'test_returns_interrupt_value_verbatim_for_single_select', [86, 97],
    'Test trả về giá trị interrupt nguyên verbatim cho single select.',
    ['test', 'interrupt'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_returns_list_verbatim_for_multi_select', [100, 112],
    'Test multi select trả list nguyên verbatim.',
    ['test', 'interrupt'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_returns_free_text_when_allow_other_selected', [115, 127],
    'Test chọn Other trả về free text của operator.',
    ['test', 'interaction'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_skips_writer_when_outside_graph_context', [130, 147],
    'Test ngoài graph context tool vẫn trả kết quả, không phát event.',
    ['test', 'robustness'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_truncates_header_longer_than_max', [150, 166],
    'Test header dài hơn 60 ký tự được cắt.',
    ['test', 'truncation'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_coerces_options_json_string_from_local_models', [169, 190],
    'Test options dạng JSON string từ local model được coerce đúng.',
    ['test', 'coercion'], 'moderate'),
  fnN(`${T}/test_ask_user_question.py`, 'test_coerces_options_python_literal_string_from_local_models', [193, 209],
    'Test options dạng Python literal string được coerce qua ast.literal_eval.',
    ['test', 'coercion'], 'moderate'),
  fnN(`${T}/test_ask_user_question.py`, 'test_accepts_max_option_counts', [233, 246],
    'Test chấp nhận đúng số option tối đa cho single/multi select.',
    ['test', 'validation'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_rejects_option_without_label_or_description', [249, 259],
    'Test option thiếu label/description bị từ chối.',
    ['test', 'validation'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_strips_recommended_suffix_from_single_select_return', [262, 277],
    'Test strip hậu tố (Recommended) khỏi giá trị single select.',
    ['test', 'normalization'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_strips_recommended_suffix_from_multi_select_return', [280, 293],
    'Test strip hậu tố (Recommended) khỏi từng phần tử multi select.',
    ['test', 'normalization'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_preserves_free_text_without_recommended_suffix', [296, 310],
    'Test free text trả về nguyên vẹn không bị sửa đổi.',
    ['test', 'interaction'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_does_not_strip_recommended_when_not_a_trailing_suffix', [313, 328],
    'Test không strip khi chuỗi (Recommended) nằm giữa chứ không phải suffix cuối.',
    ['test', 'normalization'], 'simple'),
  fnN(`${T}/test_ask_user_question.py`, 'test_rejects_option_with_extra_fields', [331, 342],
    'Test option có field lạ bị từ chối do Pydantic strict.',
    ['test', 'validation'], 'simple'),

  fnN(`${T}/test_complete_planning.py`, '_write_bundle', [11, 50],
    'Helper dựng bundle planning hoàn chỉnh trên disk với authorization HMAC hợp lệ cho test.',
    ['test-fixture', 'planning'], 'moderate'),
  fnN(`${T}/test_complete_planning.py`, 'test_validate_planning_bundle_accepts_complete_authorized_bundle', [53, 63],
    'Test bundle đầy đủ + authorization hợp lệ được chấp nhận.',
    ['test', 'validation'], 'simple'),
];

const e23 = [];
for (const n of n23) e23.push(contains(n));
for (const n of n23) {
  if (n.type === 'file') continue;
  if (n.filePath === `${I}/ask_user.py` && n.name === 'ask_user_question') e23.push(exportsFrom(n));
  if (n.filePath === `${I}/complete_planning.py`) e23.push(exportsFrom(n));
}
for (const e of importEdges(input(23).batchImportData)) e23.push(e);
e23.push(
  E('function:raptix/agents/standard/soundwave.py:create_soundwave_agent', `function:${I}/ask_user.py:ask_user_question`, 'calls'),
  E('function:raptix/agents/standard/soundwave.py:create_soundwave_agent', `function:${I}/complete_planning.py:complete_engagement_planning`, 'calls'),
  E(`file:${I}/__init__.py`, `file:${T}/test_ask_user_question.py`, 'tested_by'),
  E(`file:${I}/ask_user.py`, `file:${T}/test_ask_user_question.py`, 'tested_by'),
  E(`file:${I}/complete_planning.py`, `file:${T}/test_complete_planning.py`, 'tested_by'),
);

finish(23, n23, e23);
