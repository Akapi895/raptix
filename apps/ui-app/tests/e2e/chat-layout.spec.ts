import { expect, openApp, test } from './fixtures';

test('conversation picker searches the current project and supports keyboard selection', async ({ page }) => {
  await openApp(page, 'chat');
  const picker = page.locator('#chat-conversation-picker');
  await picker.locator('summary').press('Enter');
  const search = page.locator('#chat-conversation-search');
  await expect(search).toBeFocused();
  await expect(page.locator('#conversations-list .conversation-item')).toHaveCount(2);
  await expect(page.locator('#conversations-pagination')).toBeHidden();
  await expect(page.locator('#recent-conversations-section .section-title')).toContainText('Lab Web Perimeter');
  await search.fill('does-not-exist');
  await expect(page.locator('#conversations-list .conversation-item')).toHaveCount(0);
  await search.fill('Recon');
  await expect(page.locator('#conversations-list .conversation-item')).toHaveCount(1);
  await page.locator('#conversations-list .conversation-content').press('Enter');
  await expect(picker).not.toHaveAttribute('open', '');
  await expect(page).toHaveURL(/conversation=conv-recon-01/);
  await expect(page.locator('#chat-conversation-current')).toHaveText('Recon of 198.51.100.0/24');
  await expect(page.locator('#chat-messages .message')).not.toHaveCount(0);
  await expect(page.locator('#chat-messages .chat-welcome-empty-state')).toHaveCount(0);
  await page.locator('.chat-new-task').click();
  await expect(page.locator('#chat-conversation-current')).toHaveText('New task');
  await expect(page.locator('.chat-welcome-empty-state')).toBeVisible();
  await picker.locator('summary').click();
  await search.press('Escape');
  await expect(picker.locator('summary')).toBeFocused();
  await expect(picker).not.toHaveAttribute('open', '');
});

test('conversation picker does not mix conversations from another project', async ({ page }) => {
  await openApp(page, 'chat');
  await page.locator('.csai-ps-trigger').click();
  const options = page.locator('.csai-ps-option');
  await expect(options).toHaveCount(2);
  await options.filter({ hasText: 'Internal' }).click();
  await page.locator('#chat-conversation-picker summary').click();
  await expect(page.locator('#recent-conversations-section .section-title')).toContainText('Internal');
  await expect(page.locator('#conversations-list')).not.toContainText('Recon of 198.51.100.0/24');
});

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`chat controls and Workspace remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openApp(page, 'chat');
    await expect(page.locator('#csai-ws-panel')).toBeVisible();
    await expect(page.locator('#chat-model-shortcut')).toBeVisible();
    await page.locator('#chat-tools-btn').click();
    await expect(page.locator('#chat-input')).toHaveValue('@');
    await expect(page.locator('#mention-suggestions .mention-item').first()).toBeVisible();
    await page.locator('#chat-input').press('Escape');
    await page.locator('#chat-hitl-shortcut').click();
    await expect(page.locator('#chat-reasoning-wrapper')).toBeVisible();
    await page.locator('#chat-hitl-shortcut').press('Escape');
    await expect(page.locator('#chat-reasoning-wrapper')).toBeHidden();
    await page.locator('#chat-model-shortcut').click();
    await expect(page.locator('#chat-system-model-menu')).toBeVisible();
    await page.locator('#chat-model-shortcut').press('Escape');
    await page.locator('#csai-ws-panel-tab-progress').click();
    await expect(page.locator('#csai-ws-panel-body')).toContainText('No plan to display');
    await page.locator('#csai-ws-panel-tab-progress').press('ArrowRight');
    await expect(page.locator('#csai-ws-panel-tab-agents')).toBeFocused();
    await expect(page.locator('#csai-ws-panel-tab-agents')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#csai-ws-panel-tab-artifacts')).toHaveCount(0);
    const overflow = await page.locator('#page-chat').evaluate(root =>
      [...root.querySelectorAll<HTMLElement>('.chat-taskbar, #chat-input-container, .chat-composer-footer, #csai-ws-panel')]
        .filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.id || element.className));
    expect(overflow).toEqual([]);
  });
}

test('transcript and Workspace scroll without moving each other or the composer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, 'chat?conversation=conv-recon-01');
  await expect(page.locator('#csai-ws-panel-body')).toContainText('No recorded agents');
  await expect(page.locator('#chat-messages .message.assistant')).toBeVisible();
  // Exercise the overflow contract with long transcript and workspace content.
  await page.evaluate(() => {
    for (const selector of ['#chat-messages', '#csai-ws-panel-body']) {
      const container = document.querySelector(selector)!;
      const source = container.firstElementChild!;
      for (let index = 0; index < 30; index++) container.appendChild(source.cloneNode(true));
      container.scrollTop = 0;
    }
  });
  const composer = page.locator('#chat-input-container');
  const before = await composer.boundingBox();
  await page.locator('#chat-messages').hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.locator('#chat-messages').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('#csai-ws-panel-body').evaluate(element => element.scrollTop)).toBe(0);
  const transcriptTop = await page.locator('#chat-messages').evaluate(element => element.scrollTop);
  await page.locator('#csai-ws-panel-body').hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.locator('#csai-ws-panel-body').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('#chat-messages').evaluate(element => element.scrollTop)).toBe(transcriptTop);
  expect(await composer.boundingBox()).toEqual(before);
});

test('Workspace distinguishes loading, running activity and plan status', async ({ page }) => {
  await openApp(page, 'chat?conversation=conv-recon-01');
  await expect(page.locator('#csai-ws-panel-body')).toContainText('No recorded agents');
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (path.endsWith('/api/conversations/conv-recon-01')) {
        return new Response(JSON.stringify({ messages: [{ id: 'execution-turn', role: 'assistant', processDetails: [
          { eventType: 'progress', data: { einoAgent: 'Recon Lead', einoRole: 'orchestrator' } },
          { eventType: 'tool_call', data: { einoAgent: 'Recon Lead', toolName: 'task', toolCallId: 'delegate-1', argumentsObj: { subagent_type: 'Web Tester' } } },
          { eventType: 'progress', data: { einoAgent: 'Web Tester' } },
          { eventType: 'tool_call', data: { einoAgent: 'Web Tester', toolName: 'task', toolCallId: 'delegate-2', argumentsObj: { subagent_type: 'Evidence Reviewer' } } },
          { eventType: 'tool_result', data: { einoAgent: 'Web Tester', toolCallId: 'delegate-2', success: false } },
          { eventType: 'tool_call', data: { einoAgent: 'Recon Lead', toolName: 'task', toolCallId: 'delegate-3', argumentsObj: { subagent_type: 'Report Writer' } } },
        ] }] }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (path.endsWith('/api/agent-loop/tasks')) {
        await new Promise(resolve => setTimeout(resolve, 700));
        return new Response(JSON.stringify({ tasks: [
          { conversationId: 'conv-recon-01', title: 'Checking web services', status: 'running' },
          { conversationId: 'another-conversation', title: 'Other project activity', status: 'running' },
        ] }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (path.endsWith('/plan-tasks')) return new Response(JSON.stringify({ total: 3, completed: 1, tasks: [
        { id: '1', subject: 'Enumerate services', status: 'completed' },
        { id: '2', subject: 'Validate exposure', status: 'in_progress', activeForm: 'Checking HTTP responses' },
        { id: '3', subject: 'Write findings', status: 'blocked', blockedBy: ['2'] },
      ] }), { headers: { 'Content-Type': 'application/json' } });
      return original(input, init);
    };
  });
  await page.locator('#csai-ws-panel-tab-agents').click();
  await expect(page.locator('#csai-ws-panel-body')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#csai-ws-panel-body')).toContainText('Loading workspace');
  const body = page.locator('#csai-ws-panel-body');
  await expect(body.locator('.csai-wsp-agent-row')).toHaveCount(4);
  await expect(body.getByRole('img', { name: 'Running', exact: true })).toHaveCount(2);
  await expect(body.getByRole('img', { name: 'Failed', exact: true })).toHaveCount(1);
  await expect(body.getByRole('img', { name: 'Pending', exact: true })).toHaveCount(1);
  const lead = body.locator('summary.csai-wsp-agent-row').filter({ hasText: 'Recon Lead' });
  await lead.press('Enter');
  await expect(body.locator('.csai-wsp-agent-name').filter({ hasText: 'Web Tester' })).toBeHidden();
  // A background refresh retains expansion state and keyboard focus.
  await page.waitForTimeout(3300);
  await expect(lead).toBeFocused();
  await expect(body.locator('.csai-wsp-agent-name').filter({ hasText: 'Web Tester' })).toBeHidden();
  await lead.press('Enter');
  await expect(body.locator('.csai-wsp-agent-name').filter({ hasText: 'Evidence Reviewer' })).toBeVisible();
  await expect(page.locator('#csai-ws-panel-body')).not.toContainText('Other project activity');
  await expect(page.locator('#csai-ws-panel-body')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#csai-ws-panel-tab-progress').click();
  await expect(page.getByRole('progressbar', { name: 'Plan completion' })).toHaveAttribute('aria-valuenow', '1');
  await expect(page.locator('#csai-ws-panel-body')).toContainText('Checking HTTP responses');
  await expect(page.locator('#csai-ws-panel-body')).toContainText('blocked by 2');
});

test('Workspace routes conversation files to the unified file manager', async ({ page }) => {
  await openApp(page, 'chat?conversation=conv-recon-01');
  await expect(page.locator('#csai-ws-panel-tab-artifacts')).toHaveCount(0);
  await page.locator('.csai-wsp-files-link').click();
  await expect(page).toHaveURL(/#chat-files\?conversation=conv-recon-01/);
  await expect(page.locator('#chat-files-filter-conv')).toHaveValue('conv-recon-01');
  await expect(page.locator('#chat-files-list-wrap')).toContainText('assessment.md');
});
