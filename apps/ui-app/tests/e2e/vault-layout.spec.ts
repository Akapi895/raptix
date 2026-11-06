import { expect, openApp, test } from './fixtures';

for (const width of [1440, 768, 390]) {
  test(`Vault project context and actions at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('raptix.activeProjectId', 'proj-lab-web'));
    await openApp(page);
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('csai-mock-state-v1')!);
      state.roles.find((role: { id: string }) => role.id === 'role-admin').permissions.push('vault:read', 'vault:write');
      localStorage.setItem('csai-mock-state-v1', JSON.stringify(state));
    });
    await page.goto('/#dashboard');
    await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
    await page.evaluate(() => {
      const original = window.fetch.bind(window);
      (window as Window & { vaultMutations?: string[] }).vaultMutations = [];
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.pathname.includes('/vault/secrets/') && (init?.method === 'DELETE' || url.pathname.endsWith('/promote'))) (window as Window & { vaultMutations?: string[] }).vaultMutations!.push(url.pathname);
        if (init?.method === 'DELETE' && /\/vault\/secrets\/[^/]+$/.test(url.pathname)) return Response.json({});
        if (url.pathname === '/api/vault/global-secrets') return Response.json({ secrets: [{ id: 'g1', project_id: null, scope: 'GLOBAL', name: 'Shared secret', description: '', kind: 'credential', source_project_id: 'proj-lab-web', revoked_at: null, created_at: '2026-11-02T00:00:00Z', created_by: 'operator' }] });
        const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/vault\/secrets(?:\/([^/]+)\/(reveal|promote))?$/);
        if (!match) return original(input, init);
        if (match[3] === 'reveal') return Response.json({ plaintext: 'sensitive-fixture' });
        if (match[3] === 'promote') return Response.json({});
        return Response.json({ secrets: [{ id: 's1', project_id: match[1], scope: 'PROJECT', name: `Secret ${match[1]}`, description: 'Test credential', kind: 'credential', source_project_id: null, revoked_at: null, created_at: '2026-11-03T00:00:00Z', created_by: 'operator' }] });
      };
    });
    await page.evaluate(() => { location.hash = 'vault'; });
    const row = page.locator('.vault-secret-row').filter({ hasText: 'Secret proj-' });
    await expect(row).toContainText('Secret proj-lab-web');
    await expect(page.locator('.vault-secret-row').filter({ hasText: 'Shared secret' })).toContainText('global');
    await expect(row.locator('.vault-secret-name')).toBeInViewport();
    if (width <= 700) expect(await page.locator('#vault-secrets').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(row.locator('.vault-secret-value')).toHaveText('••••••••');
    await expect(page.locator('#vault-project-select')).toHaveCount(0);
    if (width <= 700) {
      const summary = row.locator('summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(row.locator('.vault-actions-menu')).toHaveAttribute('open', '');
      await page.keyboard.press('Escape');
      await expect(summary).toBeFocused();
      await summary.click();
    }
    await page.screenshot({ path: testInfo.outputPath(`vault-${width}.png`), animations: 'disabled' });
    await row.getByRole('button', { name: 'Reveal', exact: true }).filter({ visible: true }).click();
    await expect(row.locator('.vault-secret-value')).toHaveText('sensitive-fixture');
    if (width <= 700) await row.locator('summary').click();
    page.once('dialog', dialog => { expect(dialog.message()).toContain('Secret proj-lab-web'); void dialog.dismiss(); });
    await row.getByRole('button', { name: /revoke/i }).filter({ visible: true }).click();
    await expect(row).toContainText('Secret proj-lab-web');
    page.once('dialog', dialog => { expect(dialog.message()).toContain('Secret proj-lab-web'); void dialog.dismiss(); });
    await row.getByRole('button', { name: /promote/i }).filter({ visible: true }).click();
    expect(await page.evaluate(() => (window as Window & { vaultMutations?: string[] }).vaultMutations)).toEqual([]);
    if (width === 1440) {
      page.once('dialog', dialog => dialog.accept());
      await row.getByRole('button', { name: /promote/i }).filter({ visible: true }).click();
      await expect.poll(() => page.evaluate(() => (window as Window & { vaultMutations?: string[] }).vaultMutations?.length)).toBe(1);
      await expect(row.getByRole('button', { name: /revoke/i }).filter({ visible: true })).toBeEnabled();
      page.once('dialog', dialog => dialog.accept());
      await row.getByRole('button', { name: /revoke/i }).filter({ visible: true }).click();
      await expect.poll(() => page.evaluate(() => (window as Window & { vaultMutations?: string[] }).vaultMutations?.length)).toBe(2);
    }
    await page.locator('#csai-project-switcher .csai-ps-trigger').click();
    await page.locator('.csai-ps-option').filter({ hasText: 'Internal API Review' }).click();
    await expect(row).not.toContainText('proj-lab-web');
    await expect(row.locator('.vault-secret-value')).toHaveText('••••••••');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
