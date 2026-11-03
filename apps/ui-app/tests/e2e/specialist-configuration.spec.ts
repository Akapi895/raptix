import { expect, openApp, test } from './fixtures';

/** Drives the skinned scope select; the native select behind it stays the source of truth. */
async function pickScope(modal: ReturnType<import('@playwright/test').Page['locator']>, value: 'global' | 'project'): Promise<void> {
  await modal.locator('[data-specialist-scope-toggle]').click();
  await modal.locator(`[data-specialist-scope-option="${value}"]`).click();
}

async function openRecon(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('#specialists-list').getByRole('button', { name: /Recon/ }).first().click();
  const modal = page.locator('#specialist-modal');
  await modal.waitFor({ state: 'visible' });
  await expect(modal).toHaveAttribute('aria-busy', 'false');
  return;
}

test('specialist additions persist, distinguish inheritance, support reset and keyboard tabs', async ({ page }) => {
  await openApp(page, 'agents');
  await openRecon(page);
  const modal = page.locator('#specialist-modal');
  await pickScope(modal, 'global');
  await expect(modal).toHaveAttribute('aria-busy', 'false');
  await modal.getByRole('tab', { name: 'Tools', exact: true }).click();
  await modal.getByRole('checkbox', { name: /solidity_scan/ }).check();
  await expect(modal.locator('[data-specialist-dirty]')).toHaveText('Unsaved changes');
  await modal.getByRole('button', { name: 'Save additions', exact: true }).click();
  await expect(modal.locator('[data-specialist-status]')).toContainText('Saved. New runs');
  await expect(modal.getByRole('tab', { name: 'Tools', exact: true })).toBeFocused();
  await modal.getByRole('tab', { name: 'Skills', exact: true }).click();
  await modal.getByRole('checkbox', { name: /SQL injection/ }).check();
  await modal.getByRole('tab', { name: 'MCP', exact: true }).click();
  await modal.getByRole('checkbox', { name: /echo_marker/ }).first().check();
  await modal.getByRole('button', { name: 'Save additions', exact: true }).click();
  await expect(modal.locator('[data-specialist-dirty]')).toContainText('Saved · revision');
  await page.reload();
  await openRecon(page);
  await pickScope(modal, 'project');
  await expect(modal).toHaveAttribute('aria-busy', 'false');
  await modal.getByRole('tab', { name: 'MCP', exact: true }).click();
  await expect(modal.getByRole('checkbox', { name: /echo_marker/ }).first()).toBeChecked();
  await expect(modal.getByRole('checkbox', { name: /echo_marker/ }).first()).toBeDisabled();
  await pickScope(modal, 'global');
  await expect(modal).toHaveAttribute('aria-busy', 'false');
  await modal.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(modal.getByRole('tab', { name: 'Skills', exact: true })).toBeFocused();
  await expect(modal.getByRole('checkbox', { name: /SQL injection/ })).toBeChecked();
  page.once('dialog', dialog => dialog.accept());
  await modal.getByRole('button', { name: 'Reset additions', exact: true }).click();
  await expect(modal.getByRole('checkbox', { name: /SQL injection/ })).not.toBeChecked();
  // Closing with unsaved changes asks first; the confirmed close discards only the editor draft.
  page.once('dialog', dialog => dialog.accept());
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(modal).toBeHidden();
  await openRecon(page);
  await modal.getByRole('tab', { name: 'Skills', exact: true }).click();
  await expect(modal.getByRole('checkbox', { name: /SQL injection/ })).toBeChecked();
});

test('project additions do not leak and failed saves retain an editable draft', async ({ page }) => {
  await openApp(page, 'agents');
  await openRecon(page);
  const modal = page.locator('#specialist-modal');
  await expect(modal.locator('[data-specialist-scope] option[value="project"]')).toBeEnabled();
  await pickScope(modal, 'project');
  await expect(modal).toHaveAttribute('aria-busy', 'false');
  await modal.getByRole('tab', { name: 'Skills', exact: true }).click();
  await modal.getByRole('checkbox', { name: /SQL injection/ }).check();
  await modal.getByRole('button', { name: 'Save additions', exact: true }).click();
  await expect(modal.locator('[data-specialist-status]')).toContainText('Saved. New runs');
  const otherProject = await page.evaluate(async () => {
    const response = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Isolated specialist test' }) });
    return (await response.json() as { id: string }).id;
  });
  await page.goto(`/${otherProject}/#agents`);
  await openRecon(page);
  await modal.getByRole('tab', { name: 'Skills', exact: true }).click();
  await expect(modal.getByRole('checkbox', { name: /SQL injection/ })).not.toBeChecked();
  await modal.getByRole('checkbox', { name: /SQL injection/ }).check();
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (String(input).includes('/specialists/') && init?.method === 'PUT') return Promise.resolve(Response.json({ error: 'Configuration changed. Reload before saving.' }, { status: 409 }));
      return original(input, init);
    };
  });
  await modal.getByRole('button', { name: 'Save additions', exact: true }).click();
  await expect(modal.locator('[data-specialist-status]')).toContainText('Configuration changed');
  await expect(modal.getByRole('checkbox', { name: /SQL injection/ })).toBeChecked();
  await expect(modal.getByRole('button', { name: 'Save additions', exact: true })).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss());
  await modal.locator('[data-specialist-close]').click();
  await expect(modal).toBeVisible();
  // A confirmed close ends the edit; reopening shows the saved project state again.
  page.once('dialog', dialog => dialog.accept());
  await modal.locator('[data-specialist-close]').click();
  await expect(modal).toBeHidden();
  await openRecon(page);
  await modal.getByRole('tab', { name: 'Skills', exact: true }).click();
  await expect(modal.getByRole('checkbox', { name: /SQL injection/ })).not.toBeChecked();
});

test('specialist modal remains usable at mobile and desktop widths without horizontal overflow', async ({ page }) => {
  await openApp(page, 'agents');
  await openRecon(page);
  const modal = page.locator('#specialist-modal');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await modal.getByRole('tab', { name: 'Tools', exact: true }).click();
    expect(await modal.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await expect(modal.locator('[data-specialist-capability-search]')).toBeVisible();
    await modal.locator('[data-specialist-capability-search]').fill('no-match');
    await expect(modal.locator('[data-specialist-no-results]')).toBeVisible();
    await modal.locator('[data-specialist-capability-search]').fill('');
    await page.screenshot({ path: `test-results/specialist-modal-${width}.png`, fullPage: true });
  }
});

test('repeat opens reuse catalogs and saving invalidates inherited configuration caches', async ({ page }) => {
  await openApp(page, 'agents');
  await openRecon(page);
  const modal = page.locator('#specialist-modal');
  await modal.locator('[data-specialist-close]').click();
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (String(input).includes('/specialists/recon/catalog')) throw new Error('Repeat open fetched the catalog again');
      return original(input, init);
    };
  });
  await openRecon(page);
  await expect(modal.locator('[data-specialist-content]')).toContainText('Effective configuration');
  await pickScope(modal, 'global');
  await expect(modal).toHaveAttribute('aria-busy', 'false');
  await modal.getByRole('tab', { name: 'Skills', exact: true }).click();
  await modal.getByRole('checkbox', { name: /SQL injection/ }).check();
  await modal.locator('[data-specialist-save]').click();
  await expect(modal.locator('[data-specialist-status]')).toContainText('Saved. New runs');
  await pickScope(modal, 'project');
  await expect(modal).toHaveAttribute('aria-busy', 'false');
  await expect(modal.getByRole('checkbox', { name: /SQL injection/ })).toBeChecked();
  await expect(modal.getByRole('checkbox', { name: /SQL injection/ })).toBeDisabled();
});

test('catalog search reveals built-ins, details expand, scrolling keeps controls accessible and saved resets persist', async ({ page }) => {
  await openApp(page, 'agents');
  await openRecon(page);
  const modal = page.locator('#specialist-modal');
  await modal.getByRole('tab', { name: 'Tools', exact: true }).click();
  const builtins = modal.locator('[data-specialist-builtins]');
  await expect(builtins).not.toHaveAttribute('open');
  await modal.locator('[data-specialist-capability-search]').fill('bash');
  await expect(builtins).toHaveAttribute('open', '');
  await expect(builtins.getByText('bash', { exact: true })).toBeVisible();
  await expect(modal.locator('[data-specialist-no-results]')).toBeHidden();
  await expect(modal.getByRole('checkbox', { name: 'bash', exact: true })).toHaveCount(0);
  await modal.locator('[data-specialist-capability-search]').fill('solidity');
  const capability = modal.locator('.specialist-capability').filter({ hasText: 'solidity_scan' });
  await capability.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(capability.locator('details')).toHaveAttribute('open', '');
  await capability.getByRole('checkbox').check();
  await modal.locator('[data-specialist-save]').click();
  await expect(modal.locator('[data-specialist-status]')).toContainText('Saved. New runs');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 812 });
    const pinned = await modal.evaluate(node => {
      const panel = node.querySelector<HTMLElement>('[data-specialist-content]')!;
      const controls = [...node.querySelectorAll<HTMLElement>('.modal-header, .specialist-toolbar, .modal-footer')];
      const before = controls.map(control => control.getBoundingClientRect().top);
      panel.scrollTop = panel.scrollHeight;
      return controls.every((control, index) => control.getBoundingClientRect().top === before[index] && control.getBoundingClientRect().bottom <= innerHeight);
    });
    expect(pinned).toBe(true);
  }
  page.once('dialog', dialog => dialog.accept());
  await modal.locator('[data-specialist-reset]').click();
  await modal.locator('[data-specialist-save]').click();
  await expect(modal.locator('[data-specialist-status]')).toContainText('Saved. New runs');
  await page.reload();
  await openRecon(page);
  await modal.getByRole('tab', { name: 'Tools', exact: true }).click();
  await expect(modal.getByRole('checkbox', { name: /solidity_scan/ })).not.toBeChecked();
});

test('a delayed specialist shows a skeleton and cannot overwrite a later specialist', async ({ page }) => {
  await openApp(page, 'agents');
  await page.evaluate(() => {
    const original = window.fetch;
    const release = new Promise<void>(resolve => document.addEventListener('release-recon', () => resolve(), { once: true }));
    let reads = 0;
    window.fetch = async (input, init) => {
      if (String(input).includes('/specialists/recon/catalog')) { document.body.dataset.reconCatalogReads = String(++reads); await release; }
      return original(input, init);
    };
  });
  await page.locator('[data-specialist-id="recon"]').click();
  const modal = page.locator('#specialist-modal');
  await expect(modal.locator('.specialist-skeleton')).toBeVisible();
  await expect(modal.locator('[data-specialist-save]')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.locator('[data-specialist-id="recon"]').click();
  await expect(modal.locator('.specialist-skeleton')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-recon-catalog-reads', '1');
  await page.keyboard.press('Escape');
  await page.locator('[data-specialist-id="ad_operator"]').click();
  await expect(modal).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => document.dispatchEvent(new Event('release-recon')));
  await expect(modal.locator('#specialist-modal-title')).toHaveText('AD Operator');
  await expect(modal.locator('[data-specialist-content]')).toContainText('Effective configuration');
});

test('switching projects in the same session keeps cached selections isolated', async ({ page }) => {
  await openApp(page, 'agents');
  const projectA = await page.evaluate(() => localStorage.getItem('raptix.activeProjectId'));
  expect(projectA).toBeTruthy();
  const projects = await page.evaluate(async () => (await (await fetch('/api/projects?limit=200')).json()).projects as { id: string; name: string }[]);
  const nameA = projects.find(project => project.id === projectA)!.name;
  const projectB = projects.find(project => project.id !== projectA)!;
  await openRecon(page);
  const modal = page.locator('#specialist-modal');
  await pickScope(modal, 'project');
  await expect(modal).toHaveAttribute('aria-busy', 'false');
  await modal.getByRole('tab', { name: 'Skills', exact: true }).click();
  await modal.getByRole('checkbox', { name: /SQL injection/ }).check();
  await modal.locator('[data-specialist-save]').click();
  await expect(modal.locator('[data-specialist-status]')).toContainText('Saved. New runs');
  await modal.locator('[data-specialist-close]').click();
  for (const [name, checked] of [[projectB.name, false], [nameA, true]] as const) {
    await page.locator('.csai-ps-trigger').click();
    await page.locator('.csai-ps-option').filter({ hasText: name }).click();
    await openRecon(page);
    await modal.getByRole('tab', { name: 'Skills', exact: true }).click();
    await expect(modal.getByRole('checkbox', { name: /SQL injection/ })).toBeChecked({ checked });
    await modal.locator('[data-specialist-close]').click();
  }
});

test('focus, expiry and explicit refresh reload cached catalog metadata', async ({ page }) => {
  await openApp(page, 'agents');
  await page.evaluate(() => {
    const original = window.fetch;
    let reads = 0;
    window.fetch = (input, init) => {
      if (String(input).includes('/specialists/recon/catalog')) document.body.dataset.catalogReads = String(++reads);
      return original(input, init);
    };
  });
  await openRecon(page);
  const modal = page.locator('#specialist-modal');
  await modal.locator('[data-specialist-close]').click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await openRecon(page);
  await expect(page.locator('body')).toHaveAttribute('data-catalog-reads', '2');
  await modal.locator('[data-specialist-close]').click();
  await page.clock.install();
  await page.clock.fastForward(31_000);
  await openRecon(page);
  await expect(page.locator('body')).toHaveAttribute('data-catalog-reads', '3');
  await modal.getByRole('button', { name: 'Refresh configuration and catalogs' }).click();
  await expect(modal).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('body')).toHaveAttribute('data-catalog-reads', '4');
});
