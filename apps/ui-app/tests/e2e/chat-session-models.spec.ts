import { expect, openApp, test } from './fixtures';

// The composer hides the model shortcut below 520px of its own width (container query), so the picker needs room.
test.use({ viewport: { width: 1600, height: 960 } });

test('choosing a model saves it to the session channel and the composer shows it', async ({ page }) => {
  await openApp(page, 'chat');
  await page.locator('#chat-model-shortcut').click();
  await expect(page.locator('#chat-system-model-menu')).toBeVisible();
  await page.locator('button.chat-system-model-setting-row', { has: page.locator('#chat-system-model-current-value') }).click();
  const option = page.locator('#chat-system-model-list [data-model="demo-small"]');
  await expect(option).toBeVisible({ timeout: 10_000 });

  await option.click();

  await expect(page.locator('#chat-model-shortcut-text')).toHaveText('demo-small');
  await expect(page.locator('#chat-system-model-status')).toHaveAttribute('data-tone', 'success');
  await expect(page.locator('#chat-system-model-menu')).toBeHidden({ timeout: 5_000 });
});

for (const enabled of [false, true]) {
  test(`chat follows backend transport with no mode selector (multi enabled: ${enabled})`, async ({ page }) => {
    await openApp(page, 'chat');
    await expect(page.locator('#agent-mode-wrapper,#agent-mode-select,.agent-mode-option')).toHaveCount(0);
    await page.evaluate(async enabled => {
      localStorage.setItem('raptix-chat-agent-mode', 'plan_execute');
      const response = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ multi_agent: { enabled } }) });
      if (!response.ok) throw new Error('Could not set demo backend config');
      const captured: { path: string; body: Record<string, unknown> }[] = [];
      Object.assign(window, { capturedAgentRequests: captured });
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
        if (/\/api\/(?:eino-agent|multi-agent)\/stream/.test(path)) captured.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return original(input, init);
      };
    }, enabled);
    await page.locator('#chat-input').fill('Summarize the recorded demo findings.');
    await page.locator('#chat-input').press('Enter');
    const requests = () => page.evaluate(() => (window as typeof window & { capturedAgentRequests: { path: string; body: Record<string, unknown> }[] }).capturedAgentRequests);
    await expect.poll(async () => (await requests()).length).toBe(1);
    const [sent] = await requests();
    expect(sent?.path).toBe(enabled ? '/api/multi-agent/stream' : '/api/eino-agent/stream');
    expect(sent?.body).toMatchObject({ message: 'Summarize the recorded demo findings.' });
    expect(sent?.body).not.toHaveProperty('agentMode');
    expect(sent?.body).not.toHaveProperty('orchestration');
    await expect(page.locator('.message.assistant').last()).toContainText(/scan|recorded|completed|target|refresh/i, { timeout: 20000 });
  });
}

test('reasoning effort chosen in the picker is remembered and shown on the composer', async ({ page }) => {
  await openApp(page, 'chat');
  await page.locator('#chat-model-shortcut').click();
  await page.locator('button.chat-system-model-setting-row', { has: page.locator('#chat-system-model-effort-value') }).click();
  await expect(page.locator('#chat-system-model-subview')).toBeVisible();

  await page.locator('#chat-system-model-list .chat-system-model-option').filter({ has: page.getByText('high', { exact: true }) }).click();

  await expect(page.locator('#chat-model-shortcut-effort')).toHaveText('high');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('raptix-chat-reasoning-effort'))).toBe('high');
  await expect(page.locator('#chat-system-model-menu')).toBeHidden({ timeout: 5_000 });
});
