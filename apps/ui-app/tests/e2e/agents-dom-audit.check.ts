/** DOM-level design audit for the Agents page; complements the e2e specs. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4199';
const browser = await chromium.launch();
const findings: string[] = [];
try {
  const page = await browser.newPage({ colorScheme: 'light', viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/?mock-reset=1#agents');
  await page.locator('#csai-mock-badge').waitFor();
  await page.locator('#login-overlay').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !!document.querySelector('#specialists-list .agent-card-specialist'));

  // 1. Grid composition at three widths.
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const columns = await page.evaluate(() => getComputedStyle(document.querySelector('.agents-grid')!).gridTemplateColumns.split(' ').length);
    const cards = await page.locator('#specialists-list .agent-card-specialist').count();
    if (overflow) findings.push(`horizontal overflow at ${width}px`);
    const expected = width >= 1280 ? 4 : width >= 1024 ? 3 : width >= 700 ? 2 : 1;
    if (cards === 3 && columns > expected) findings.push(`unexpected column count ${columns} at ${width}px (expected <= ${expected})`);
    console.info(`grid ${width}px: ${columns} columns, ${cards} cards, overflow=${overflow}`);
  }

  // 2. Tab semantics + keyboard.
  const tabState = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.agents-tab')];
    return { selected: tabs.filter(t => t.getAttribute('aria-selected') === 'true').length, controls: tabs.map(t => t.tabIndex) };
  });
  assert.equal(tabState.selected, 1, 'exactly one selected tab');
  assert.deepEqual(tabState.controls, [0, -1]);
  await page.locator('#agents-tab-specialists').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#agents-tab-custom').getAttribute('aria-selected'), 'true', 'arrow key moves tab');
  assert.equal(await page.locator('#agents-panel-custom').isHidden(), false, 'panel follows tab');
  await page.keyboard.press('ArrowLeft');

  // 3. Card focus ring + hover affordance (queried fresh: the grid re-renders when badges settle).
  await page.waitForTimeout(600);
  await page.locator('#specialists-list .agent-card-specialist').first().focus();
  const cardStyles = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('#specialists-list .agent-card-specialist');
    if (!card) return null;
    const s = getComputedStyle(card);
    return { outline: s.outlineStyle, border: s.borderTopWidth };
  });
  assert.equal(cardStyles?.outline, 'solid', 'visible focus outline on card');
  assert.equal(cardStyles?.border, '1px', 'card has hairline border');

  // 4. Contrast of key text roles (WCAG 4.5:1). Badges are data-driven and may be absent while indicators load.
  // Evaluated from a raw string so the bundler cannot rewrite the probe.
  const contrast = await page.evaluate(`(() => {
    const luminance = rgb => { const channel = i => { const c = (rgb[i] ?? 0) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2); };
    const parse = color => (color.match(/\\d+/g) ?? []).map(Number);
    const ratio = (fg, bg) => { const l1 = luminance(parse(fg)); const l2 = luminance(parse(bg)); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const name = document.querySelector('.agent-card-name');
    const desc = document.querySelector('.agent-card-desc');
    const badge = document.querySelector('.agent-card-specialist .agent-card-badge') ?? document.querySelector('.agent-card-badge');
    const bg = getComputedStyle(document.querySelector('.agent-card-specialist')).backgroundColor;
    return {
      name: ratio(getComputedStyle(name).color, bg),
      desc: ratio(getComputedStyle(desc).color, bg),
      badge: badge ? ratio(getComputedStyle(badge).color, getComputedStyle(badge).backgroundColor) : null,
    };
  })()`) as { name: number; desc: number; badge: number | null };
  console.info('contrast', contrast);
  for (const [role, value] of Object.entries(contrast)) if (value !== null && value < 4.5) findings.push(`contrast ${role} ${value.toFixed(2)}:1 below 4.5:1`);

  // 5. Modal shell: fixed header/footer, scrolling body.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#specialists-list .agent-card-specialist').first().click();
  const modal = page.locator('#specialist-modal');
  await modal.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getElementById('specialist-modal')?.getAttribute('aria-busy') === 'false');
  const shell = await modal.evaluate(node => {
    const content = node.querySelector<HTMLElement>('.specialist-modal-content')!;
    const body = node.querySelector<HTMLElement>('.modal-body')!;
    const header = node.querySelector<HTMLElement>('.modal-header')!;
    const footer = node.querySelector<HTMLElement>('.specialist-actions')!;
    const headerRect = header.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return {
      width: content.getBoundingClientRect().width,
      bodyScrollsWhenLong: getComputedStyle(body).overflowY === 'auto' && body.clientHeight > 0,
      bodyFlexes: ['1 1 auto', '1 1 0%'].includes(getComputedStyle(body).flex),
      headerFixed: headerRect.top > 0 && headerRect.height < 200,
      footerInside: footerRect.bottom <= window.innerHeight + 1,
      footerButtons: [...footer.querySelectorAll('button')].map(b => b.textContent?.trim() ?? ''),
      saveDisabled: (footer.querySelector('[data-specialist-save]') as HTMLButtonElement).disabled,
      dialog: node.getAttribute('role'),
      labelledby: node.getAttribute('aria-labelledby'),
    };
  });
  console.info('modal shell', shell);
  assert.equal(shell.dialog, 'dialog');
  assert.ok(shell.width >= 850 && shell.width <= 1000, `modal width ${shell.width} within 850-1000`);
  assert.ok(shell.bodyScrollsWhenLong, 'modal body is the scrolling region');
  assert.ok(shell.bodyFlexes, 'modal body flexes between header and footer');
  assert.ok(shell.footerInside, 'footer visible without scrolling');
  assert.equal(shell.saveDisabled, true, 'Save disabled when clean');
  assert.deepEqual(shell.footerButtons, ['Reset additions', 'Cancel', 'Save additions']);

  // 6. Dirty state: check a capability -> Save enables -> Escape warns.
  await modal.getByRole('tab', { name: 'Tools', exact: true }).click();
  const first = modal.locator('input[type="checkbox"]:not([disabled])').first();
  await first.check();
  assert.equal(await modal.locator('[data-specialist-dirty]').innerText(), 'Unsaved changes');
  assert.equal(await modal.locator('[data-specialist-save]').isDisabled(), false, 'Save enabled when dirty');
  let dialogs = 0;
  page.once('dialog', d => { dialogs++; d.dismiss(); });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal(await modal.isVisible(), true, 'Escape with unsaved changes keeps the modal open');
  assert.equal(dialogs, 1, 'discard confirmation shown');

  // 7. Tab switch preserves the unsaved selection.
  await modal.getByRole('tab', { name: 'Overview', exact: true }).click();
  await modal.getByRole('tab', { name: 'Tools', exact: true }).click();
  assert.equal(await first.isChecked(), true, 'unsaved selection survives tab switches');

  // 8. Scope switch asks before discarding.
  dialogs = 0;
  page.once('dialog', d => { dialogs++; d.dismiss(); });
  await modal.locator('[data-specialist-scope-toggle]').click();
  await modal.locator('[data-specialist-scope-option="project"]').click();
  await page.waitForTimeout(400);
  assert.equal(dialogs, 1, 'scope switch confirms discard');
  assert.equal(await modal.isVisible(), true, 'dismissed confirm keeps edits');

  // 9. Cancel closes without saving; reopening shows saved state.
  dialogs = 0;
  page.once('dialog', d => { dialogs++; d.accept(); });
  await modal.locator('[data-specialist-cancel]').click();
  await page.waitForTimeout(300);
  assert.equal(dialogs, 1, 'cancel with unsaved changes confirms');
  await page.waitForTimeout(200);
  assert.equal(await modal.isVisible(), false, 'confirmed cancel closes');

  // 10. Mobile modal layout: header stacks, footer wraps, no overflow.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('#specialists-list .agent-card-specialist').first().click();
  await page.waitForFunction(() => document.getElementById('specialist-modal')?.getAttribute('aria-busy') === 'false');
  const mobileOverflow = await modal.evaluate(node => node.scrollWidth > node.clientWidth + 1);
  assert.equal(mobileOverflow, false, 'no modal overflow at 375px');
  await page.keyboard.press('Escape');

  // 11. Custom agents empty search state.
  await page.getByRole('tab', { name: 'Custom Agents', exact: true }).click();
  await page.locator('#roles-search').fill('zzz-none');
  await page.waitForTimeout(450);
  await expectText(page, '#roles-list', 'No matching agents');

  assert.deepEqual(errors, [], 'no page errors');
  console.info(findings.length ? 'FINDINGS:\n- ' + findings.join('\n- ') : 'AUDIT CLEAN');
} finally { await browser.close(); }

async function expectText(page: import('@playwright/test').Page, selector: string, text: string): Promise<void> {
  await page.waitForFunction(([sel, expected]) => (document.querySelector(sel!)?.textContent ?? '').includes(expected!), [selector, text], { timeout: 10000 });
}
