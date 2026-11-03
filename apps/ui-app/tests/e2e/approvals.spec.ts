import { test, expect } from '@playwright/test';
import { PERMISSION_CATALOG } from '../../src/mock/seed';

const permissions = Object.keys(PERMISSION_CATALOG);

// Go-shaped responses exercise the production UI independently of demo transport.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(perms => {
    localStorage.setItem('raptix-auth', JSON.stringify({ token: 'approval-e2e', expiresAt: new Date(Date.now() + 3600_000).toISOString(), permissions: perms, roles: ['admin'], scope: 'all' }));
  }, permissions);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    switch (path) {
      case '/api/auth/validate': data = { token: 'approval-e2e', expires_at: new Date(Date.now() + 3600_000).toISOString(), user: { id: 'approval-admin', username: 'admin', display_name: 'Administrator' }, permissions, permission_scopes: {}, roles: ['admin'], scope: 'all' }; break;
      case '/api/roles': data = { roles: [] }; break;
      case '/api/projects': data = { projects: [] }; break;
      case '/api/config': data = { hitl: { default_mode: 'approval', default_reviewer: 'human', default_timeout_seconds: 300, audit_backend: 'typesafe', audit_model: 'jev-latest', tool_whitelist: ['read_file', 'tool_search', 'existing_custom_tool'] } }; break;
      case '/api/hitl/default-config': data = { defaultMode: 'approval', defaultReviewer: 'human', defaultTimeoutSeconds: 300, hitlGlobalToolWhitelist: ['read_file', 'tool_search'], auditBackend: 'typesafe', auditModel: 'jev-latest' }; break;
      case '/api/hitl/pending': data = { total: 1, items: [{ id: 'approval-1', conversationId: 'conversation-long-project-identifier-123456789', toolName: 'terminal_run', mode: 'review_edit', createdAt: '2026-10-30T10:20:00Z', payload: JSON.stringify({ argumentsObj: { command: 'nmap -sV 192.0.2.10', timeout: 60 }, userMessage: 'Check the services on the authorized lab target.', thinking: 'Identify exposed services before testing.', planning: 'Run a bounded service scan.' }) }] }; break;
      case '/api/workflows/runs/pending': data = { runs: [] }; break;
      case '/api/hitl/tool-whitelist': data = { toolWhitelist: ['read_file', 'tool_search', 'existing_custom_tool'] }; break;
      case '/api/hitl/audit-strategy': data = { auditAgentPrompt: 'Approve bounded, read-only inspection of authorized targets. Reject destructive operations or requests outside the assessment scope.', auditAgentPromptReviewEdit: 'Narrow tool arguments to the authorized scope before approving. Reject when arguments cannot be safely adjusted.', defaultAuditAgentPrompt: 'Default approval strategy', defaultAuditAgentPromptReviewEdit: 'Default review strategy' }; break;
      case '/api/config/tools': data = { total_pages: 1, tools: [{ name: 'read_file' }, { name: 'terminal_run' }, { name: 'tool_search' }, { name: 'scan', is_external: true, external_mcp: 'lab' }] }; break;
      case '/api/hitl/logs': data = { total: 2, retentionDays: 30, items: [{ id: 'log-approved-1', conversationId: 'conversation-long-project-identifier-123456789', toolName: 'read_file', decision: 'approve', status: 'decided', decidedBy: 'audit_agent', auditBackend: 'typesafe', auditModel: 'jev-latest', comment: 'Read-only inspection within the authorized project scope.', decidedAt: '2026-10-30T10:10:00Z' }, { id: 'log-rejected-2', conversationId: 'conversation-2', toolName: 'terminal_run', decision: 'reject', status: 'timeout', decidedBy: 'system', comment: 'Approval timed out; execution was not allowed.', decidedAt: '2026-10-30T09:50:00Z' }] }; break;
      default: await route.fulfill({ status: 403, json: { error: 'Unavailable in approval fixture' } }); return;
    }
    await route.fulfill({ json: data });
  });
});

for (const [name, width, height, theme] of [['desktop', 1440, 1000, 'light'], ['tablet', 900, 900, 'light'], ['mobile', 390, 844, 'light'], ['small-mobile', 320, 844, 'light'], ['dark', 1440, 1000, 'dark']] as const) {
  test(`approval workspace layout and context — ${name}`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.goto('http://127.0.0.1:4174/#hitl');
    await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
    await expect(page.locator('#login-overlay')).toBeHidden();
    await expect(page.locator('#page-hitl')).toHaveClass(/active/);
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await expect(page.locator('#page-hitl h2')).toHaveText('Execution Approvals');
    await expect(page.locator('.hitl-pending-payload').first()).toContainText('nmap -sV 192.0.2.10');
    await expect(page.locator('#hitl-pending-pagination')).toBeHidden();
    await expect(page.locator('.hitl-page-tab > span:first-child')).toHaveText(['Requests', 'Policy', 'History']);
    const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const capture = async (tab: string) => {
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
        document.querySelector('#page-hitl .page-content')?.scrollTo(0, 0);
        document.querySelector('#page-hitl')?.scrollTo(0, 0);
      });
      await page.screenshot({ path: info.outputPath(`${tab}-${name}.png`), fullPage: true });
    };
    await noOverflow();
    await capture('requests');
    await page.locator('#hitl-tab-policy').click();
    await expect(page.locator('#hitl-audit-agent-prompt')).toHaveValue(/Approve bounded/);
    await expect(page.locator('#hitl-selected-tools')).toContainText('existing_custom_tool');
    await expect(page.locator('#hitl-page-sensitive-tools')).toHaveCount(0);
    await expect(page.locator('#hitl-panel-policy')).toContainText('apply globally');
    await expect(page.locator('#hitl-strategy-save-btn')).toBeVisible();
    await expect(page.locator('#hitl-page-whitelist-save-btn')).toBeVisible();
    await page.locator('#hitl-tool-search').fill('lab::scan');
    await page.locator('#hitl-tool-options').getByRole('checkbox', { name: 'lab::scan', exact: true }).check();
    await expect(page.locator('#hitl-selected-tools')).toContainText('lab::scan');
    await noOverflow();
    await capture('policy');
    await page.locator('#hitl-tab-logs').click();
    await expect(page.locator('.hitl-logs-table tbody tr')).toHaveCount(2);
    await expect(page.locator('.hitl-logs-table')).toContainText('Approval timed out; execution was not allowed.');
    await expect(page.locator('.hitl-logs-table')).toContainText('TypeSafe Jev');
    await expect(page.locator('#hitl-logs-pagination')).toBeHidden();
    await noOverflow();
    await capture('history');
    expect(errors).toEqual([]);
  });
}
