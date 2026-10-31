import { test, expect, openApp } from './fixtures';

test('every Settings section is a keyboard-operable control with current location', async ({ page }) => {
  await openApp(page, 'settings');
  const navigation = page.getByRole('navigation', { name: 'Settings sections' });
  const sections = navigation.getByRole('button');
  await expect(sections).toHaveCount(12);
  for (let index = 0; index < await sections.count(); index++) {
    const section = sections.nth(index);
    await section.focus();
    await expect(section).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press(index % 2 ? 'Space' : 'Enter');
    await expect(section).toHaveAttribute('aria-current', 'page');
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
    const id = await section.getAttribute('data-section');
    await expect(page.locator(`#settings-section-${id}`)).toBeVisible();
  }
});

test('mobile demo indicator leaves every bottom navigation destination reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  const badge = page.locator('#csai-mock-badge');
  const bar = page.locator('#m-tabbar');
  await expect(bar).toBeVisible();
  const badgeBox = await badge.boundingBox(), barBox = await bar.boundingBox();
  expect(badgeBox!.y + badgeBox!.height).toBeLessThanOrEqual(barBox!.y);
  await bar.locator('[data-tab="chat"]').click();
  await expect(page.locator('#page-chat')).toHaveClass(/active/);
  await bar.locator('[data-tab="dashboard"]').click();
  await expect(page.locator('#page-dashboard')).toHaveClass(/active/);
});

test('tablet utilities, Settings values and WebShell workspace are not clipped', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1000 });
  await openApp(page, 'settings?section=token-usage');
  for (const selector of ['#user-avatar-btn', '#notification-bell-btn', '.header-actions [data-desktop-action="open-api-docs"]']) {
    const control = page.locator(selector), box = await control.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(768);
  }
  const value = page.locator('.token-usage-primary [data-metric="usageTotal"] strong');
  await expect(value).toHaveText('243,630');
  expect(await value.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    return range.getClientRects().length;
  })).toBe(1);
  await page.goto('/#webshell');
  await page.locator('#webshell-list [data-action="webshell.select"]').first().click();
  const workspace = page.locator('#webshell-workspace');
  expect((await workspace.boundingBox())!.width).toBeGreaterThan(500);
  await expect(page.locator('.webshell-layout')).toHaveCSS('flex-direction', 'column');
});
