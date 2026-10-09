import { fileN, fnN, clsN, E, contains, exportsFrom, importEdges, input, finish } from './ua-helpers.mjs';

const B = 'raptix/tools/browser';
const T = 'tests/unit/tools';

const n25 = [
  fileN(`${B}/__init__.py`,
    'Package browser: re-export browser_action (tool Playwright multiplex) và BrowserSessionManager; Playwright được import lười nên agent vẫn boot khi môi trường thiếu dependency.',
    ['entry-point', 'barrel', 'browser', 'playwright'], 'simple'),
  fileN(`${B}/tools.py`,
    'Tool browser_action duy nhất đa hợp 13 sub-action (launch, goto, click, type, scroll, screenshot, eval_js, console_logs, page_source, pdf, list_tabs, switch_tab, close) trên Playwright persistent session; mỗi action trả JSON, lỗi trả {"error": ...} thay vì raise, đóng handle có timeout 5s chống treo.',
    ['langchain-tool', 'browser', 'playwright', 'automation'], 'complex'),
  fileN(`${T}/test_browser.py`,
    'Kiểm thử browser_action với fake Playwright chain: singleton session manager, dispatch validation, hint cài đặt khi thiếu Playwright, các action goto/click/type/screenshot/eval_js/console_logs và quản lý tab.',
    ['test', 'browser', 'playwright'], 'complex'),
  fileN(`${T}/test_browser_cleanup.py`,
    'Kiểm thử dọn dẹp session browser: _safe_close có timeout, log exception, tiếp tục khi page.close raise giữa chừng và bound tổng thể khi browser.close treo.',
    ['test', 'cleanup', 'robustness'], 'moderate'),

  clsN(`${B}/tools.py`, 'BrowserSessionManager', [109, 261],
    'Quản lý session Playwright per-process: launch browser/context, tạo tab, điều phối goto/click/type/scroll/screenshot/eval_js/console_logs/page_source/pdf/list_tabs/switch_tab/close với active-tab tracking.',
    ['browser', 'playwright', 'session', 'state'], 'complex'),
  fnN(`${B}/tools.py`, '_safe_close', [39, 65],
    'Đóng một Playwright handle với timeout 5s và log exception để một handle treo không làm kẹt cleanup của cả session.',
    ['cleanup', 'robustness', 'async'], 'simple'),
  fnN(`${B}/tools.py`, 'get_session_manager', [268, 274],
    'Trả singleton BrowserSessionManager của process (thread-safe bằng lock).',
    ['singleton', 'utility'], 'simple'),
  fnN(`${B}/tools.py`, '_dispatch', [288, 331],
    'Dispatcher trung tâm: validate action và params JSON, thiếu Playwright → trả hint cài đặt decepticon[browser], thiếu tham số → trả lỗi JSON có gợi ý, rồi gọi method tương ứng trên session manager.',
    ['dispatch', 'validation', 'routing'], 'moderate'),
  fnN(`${B}/tools.py`, 'browser_action', [335, 372],
    '@tool multiplex duy nhất expose cho agent: nhận action + kwargs, chạy async dispatcher trong event loop và luôn trả JSON string kể cả khi lỗi để agent loop không đứt quãng.',
    ['langchain-tool', 'browser', 'multiplex'], 'moderate'),

  fnN(`${T}/test_browser.py`, '_fake_page', [36, 55],
    'Helper dựng fake Playwright Page với các method async cần thiết cho test.',
    ['test-fixture', 'playwright'], 'simple'),
  fnN(`${T}/test_browser.py`, '_fake_browser_chain', [58, 75],
    'Helper dựng chuỗi fake browser→context→page phục vụ test launch.',
    ['test-fixture', 'playwright'], 'simple'),
  fnN(`${T}/test_browser.py`, 'test_missing_playwright_surfaces_install_hint', [111, 120],
    'Test thiếu Playwright trả JSON lỗi kèm hint cài decepticon[browser].',
    ['test', 'error-handling'], 'simple'),
  fnN(`${T}/test_browser.py`, 'test_goto_returns_url_status_title', [132, 148],
    'Test goto trả url/status/title lấy từ page.',
    ['test', 'navigation'], 'simple'),
  fnN(`${T}/test_browser.py`, 'test_click_invokes_page_click', [151, 166],
    'Test click truyền selector đúng xuống page.click.',
    ['test', 'interaction'], 'simple'),
  fnN(`${T}/test_browser.py`, 'test_type_invokes_page_fill', [169, 185],
    'Test type gọi page.fill với text và selector đúng.',
    ['test', 'interaction'], 'simple'),
  fnN(`${T}/test_browser.py`, 'test_screenshot_returns_base64_png', [188, 197],
    'Test screenshot trả ảnh PNG base64.',
    ['test', 'screenshot'], 'simple'),
  fnN(`${T}/test_browser.py`, 'test_eval_js_returns_result', [200, 212],
    'Test eval_js trả kết quả evaluate của page.',
    ['test', 'javascript'], 'simple'),
  fnN(`${T}/test_browser.py`, 'test_console_logs_returns_captured_messages', [215, 229],
    'Test console_logs trả buffer message đã capture.',
    ['test', 'console'], 'simple'),
  fnN(`${T}/test_browser.py`, 'test_list_tabs_and_switch_tab', [243, 258],
    'Test list_tabs và switch_tab quản lý đúng tab set và active tab.',
    ['test', 'tabs'], 'moderate'),

  fnN(`${T}/test_browser_cleanup.py`, '_propagate_decepticon_logger', [29, 38],
    'Helper gắn capture handler vào logger decepticon để assert log trong test.',
    ['test-fixture', 'logging'], 'simple'),
  fnN(`${T}/test_browser_cleanup.py`, 'test_safe_close_logs_raised_exception', [42, 54],
    'Test _safe_close log exception khi close raise, không propagate ra ngoài.',
    ['test', 'cleanup', 'logging'], 'simple'),
  fnN(`${T}/test_browser_cleanup.py`, 'test_safe_close_bounded_by_timeout', [58, 74],
    'Test _safe_close bị chặn bởi timeout khi handle treo vĩnh viễn.',
    ['test', 'cleanup', 'timeout'], 'simple'),
  fnN(`${T}/test_browser_cleanup.py`, 'test_close_continues_when_page_close_raises', [78, 131],
    'Test close tổng tiếp tục đóng browser khi page.close raise giữa chừng.',
    ['test', 'cleanup', 'robustness'], 'moderate'),
  fnN(`${T}/test_browser_cleanup.py`, 'test_close_bounded_when_browser_close_hangs', [135, 159],
    'Test tổng thời gian close bị chặn khi browser.close treo không hồi đáp.',
    ['test', 'cleanup', 'timeout'], 'moderate'),
];

const e25 = [];
for (const n of n25) e25.push(contains(n));
for (const n of n25) {
  if (n.type === 'file') continue;
  if (n.filePath === `${B}/tools.py` && ['BrowserSessionManager', 'get_session_manager', 'browser_action'].includes(n.name)) e25.push(exportsFrom(n));
}
for (const e of importEdges(input(25).batchImportData)) e25.push(e);
e25.push(
  E(`file:${B}/tools.py`, `file:${T}/test_browser.py`, 'tested_by'),
  E(`file:${B}/tools.py`, `file:${T}/test_browser_cleanup.py`, 'tested_by'),
);

finish(25, n25, e25);
