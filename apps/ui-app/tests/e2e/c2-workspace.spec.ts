import { expect, openApp, test } from './fixtures';

test('C2 has four destinations and preserves legacy task, event and profile links', async ({ page }) => {
  await openApp(page, 'c2-listeners');
  await expect(page.locator('#nav-c2 .nav-submenu-item')).toHaveText(['Sessions', 'Listeners', 'Activity', 'Payloads']);
  for (const [legacy, canonical, panel] of [
    ['c2-tasks', 'c2-activity?tab=tasks', 'page-c2-tasks'],
    ['c2-events', 'c2-activity?tab=events', 'page-c2-events'],
    ['c2-profiles', 'c2-listeners?tab=profiles', 'page-c2-profiles'],
  ]) {
    await page.evaluate(hash => { location.hash = hash; }, legacy!);
    await expect(page).toHaveURL(new RegExp('#' + canonical!.replace('?', '\\?') + '$'));
    await expect(page.locator('#' + panel)).toBeVisible();
  }
  await page.locator('#page-c2-listeners [data-c2-workspace-tab="listeners"]').click();
  await expect(page.locator('#c2-listener-management')).toBeVisible();
  await expect(page.locator('#page-c2-profiles')).toBeHidden();
});

test('listener table preserves validated create, edit, start, stop, project and confirmed delete', async ({ page }) => {
  await openApp(page, 'c2-listeners');
  await page.locator('#page-c2-listeners [data-action="c2.listener-create-modal"]').click();
  await page.locator('#c2-modal [data-action="c2.listener-save"]').click();
  await expect(page.locator('#c2-listener-name')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#c2-listener-name').fill('compact-test');
  await page.locator('#c2-listener-port').fill('9001');
  await page.locator('#c2-listener-callback-host').fill('callback.example.test');
  await page.locator('#c2-modal [data-action="c2.listener-save"]').click();
  await expect(page.locator('#c2-modal')).toBeHidden();
  const row = page.locator('#c2-listener-grid tr').filter({ hasText: 'compact-test' });
  await expect(row).toContainText('callback.example.test');
  await row.locator('[data-action="c2.listener-start"]').click();
  await expect(row).toContainText('Running');
  await row.locator('[data-action="c2.listener-stop"]').click();
  await expect(row).toContainText('Stopped');
  await row.locator('[data-action="c2.listener-edit"]').click();
  await expect(page.getByLabel('Name', { exact: false }).filter({ visible: true }).first()).toBeVisible();
  await page.locator('#c2-listener-remark').fill('Retained operational note');
  await page.locator('#c2-modal [data-action="c2.listener-save"]').click();
  await row.locator('summary').click();
  await expect(row).toContainText('Retained operational note');
  const project = row.locator('select[data-change="c2.listener-project"]');
  const projectValue = await project.locator('option').nth(1).getAttribute('value');
  if (projectValue) await project.selectOption(projectValue);
  page.once('dialog', dialog => dialog.dismiss());
  await row.locator('[data-action="c2.listener-delete"]').click();
  await expect(row).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await row.locator('[data-action="c2.listener-delete"]').click();
  await expect(row).toHaveCount(0);
});

test('traffic profile configuration survives creation, editing and validation under Listeners', async ({ page }) => {
  await openApp(page, 'c2-listeners?tab=profiles');
  await page.locator('[data-action="c2.profile-create-modal"]').click();
  await page.locator('#c2-profile-name').fill('reusable-profile');
  await page.locator('#c2-profile-ua').fill('Test User-Agent');
  await page.locator('#c2-profile-request-headers').fill('{"X-Test":"request"}');
  await page.locator('#c2-profile-headers').fill('not json');
  await page.locator('#c2-modal [data-action="c2.profile-save"]').click();
  await expect(page.locator('#c2-form-error')).toContainText('JSON');
  await page.locator('#c2-profile-headers').fill('{"Server":"test-server"}');
  await page.locator('#c2-profile-body').fill('preserved body template');
  await page.locator('#c2-profile-jmin').fill('0');
  await page.locator('#c2-modal [data-action="c2.profile-save"]').click();
  await expect(page.locator('#c2-modal')).toBeHidden();
  const row = page.locator('#c2-profile-list tr').filter({ hasText: 'reusable-profile' });
  await row.locator('[data-action="c2.profile-edit"]').click();
  await expect(page.locator('#c2-profile-request-headers')).toContainText('X-Test');
  await expect(page.locator('#c2-profile-body')).toHaveValue('preserved body template');
  await expect(page.locator('#c2-profile-jmin')).toHaveValue('0');
  await page.locator('#c2-profile-ua').fill('Updated User-Agent');
  await page.locator('#c2-modal [data-action="c2.profile-save"]').click();
  await expect(row).toContainText('Updated User-Agent');
  await page.locator('#page-c2-listeners [data-c2-workspace-tab="listeners"]').click();
  await page.locator('[data-action="c2.listener-create-modal"]').click();
  await expect(page.locator('#c2-listener-profile-id option')).toContainText(['None', 'default', 'reusable-profile']);
  await page.keyboard.press('Escape');
  await expect(page.locator('#c2-modal')).toBeHidden();
});

test('Sessions lazily loads files, shows execution feedback, compact history and editable metadata', async ({ page }) => {
  await openApp(page, 'c2-sessions');
  await expect(page.locator('.c2-session-select')).toBeVisible();
  await expect(page.locator('#c2-session-connection')).toContainText('Check-in overdue');
  await page.locator('.c2-session-tab[data-tab="tasks"]').click();
  // Selecting a session does not dispatch hidden ls/pwd tasks.
  await expect(page.locator('#c2-session-tasks-list tbody tr')).toHaveCount(1);
  await expect(page.locator('#c2-session-tasks-list')).toContainText('labuser (demo)');
  await page.locator('.c2-session-tab[data-tab="files"]').click();
  await expect(page.locator('#c2-file-list')).toContainText('demo-folder');
  await expect(page.locator('#c2-current-path')).toContainText('labuser');
  await page.locator('#c2-file-list [data-action="c2.file-open"]').first().click();
  await expect(page.locator('#c2-current-path')).toContainText('demo-folder');
  await page.locator('#c2-current-path [data-action="c2.file-path"]').first().click();
  await expect(page.locator('#c2-current-path [aria-current="location"]')).toHaveText('/');
  await page.locator('.c2-session-tab[data-tab="info"]').click();
  await expect(page.locator('#c2-tab-info')).toContainText('External IP');
  await page.locator('[data-action="c2.session-note-edit"]').click();
  await page.locator('#c2-session-note-input').fill('Operator context');
  await page.locator('#c2-session-note-save').click();
  await expect(page.locator('#c2-session-note-view')).toHaveText('Operator context');
  await page.locator('.c2-session-tab[data-tab="terminal"]').click();
  await page.locator('#c2-terminal-container .xterm-helper-textarea').focus();
  await page.keyboard.type('echo demo'); await page.keyboard.press('Enter');
  await expect(page.locator('#c2-terminal-status')).toContainText('Command completed');
});

test('Activity separates C2 history, supports search/filter/reset and related session details', async ({ page }) => {
  await openApp(page, 'c2-activity');
  await expect(page.locator('#page-c2-activity')).toContainText('Workflow runs are managed in Workflows');
  await page.locator('#c2-tasks-search').fill('no-such-result');
  await expect(page.locator('#c2-task-list')).toContainText('No matches on this page');
  await page.locator('#c2-tasks-search').fill('whoami');
  await expect(page.locator('#c2-task-list tbody tr')).toHaveCount(1);
  await page.locator('#c2-task-list [data-action="c2.task-view"]').click();
  await expect(page.locator('#c2-modal [role="dialog"]')).toHaveAccessibleName('Task details');
  await expect(page.locator('#c2-task-result-pre')).toContainText('labuser (demo)');
  await page.keyboard.press('Escape');
  await page.locator('#c2-tasks-filter-status').selectOption('failed');
  await page.locator('[data-action="c2.tasks-filter"]').click();
  await expect(page.locator('#c2-tasks-stat-total')).toHaveText('0');
  await page.locator('[data-action="c2.tasks-reset"]').click();
  await expect(page.locator('#c2-tasks-search')).toHaveValue('');
  await expect(page.locator('#c2-tasks-stat-total')).toHaveText('1');
  await page.locator('#c2-task-list [data-action="c2.related-session"]').click();
  await expect(page).toHaveURL(/#c2-sessions\?session=sess-1$/);
  await expect(page.locator('.c2-session-hero__title')).toHaveText('lab-host-01');
});

test('event counters follow filters and audit deletion requires explicit confirmation', async ({ page }) => {
  await openApp(page, 'c2-activity?tab=events');
  await expect(page.locator('#c2-events-stat-total')).toHaveText('1');
  await expect(page.locator('#c2-events-stat-info')).toHaveText('1');
  await page.locator('#c2-events-filter-level').selectOption('warn');
  await page.locator('[data-action="c2.events-filter"]').click();
  await expect(page.locator('#c2-events-stat-total')).toHaveText('0');
  await expect(page.locator('#c2-events-stat-info')).toHaveText('0');
  await page.locator('[data-action="c2.events-reset"]').click();
  await page.locator('#c2-event-list [data-action="c2.event-view"]').click();
  await expect(page.locator('#c2-event-data-pre')).toBeVisible();
  await expect(page.locator('#c2-modal [data-action="c2.related-session"]')).toContainText('sess-1');
  await page.keyboard.press('Escape');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#c2-event-list [data-action="c2.event-delete"]').click();
  await expect(page.locator('#c2-event-list tbody tr')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#c2-event-list [data-action="c2.event-delete"]').click();
  await expect(page.locator('#c2-events-stat-total')).toHaveText('0');
});

test('payload configuration exposes compatibility, valid platforms and honest demo build errors', async ({ page }) => {
  await openApp(page, 'c2-payloads');
  await expect(page.locator('#c2-generate-oneliner-btn')).toBeDisabled();
  await page.getByLabel('Listener', { exact: true }).first().selectOption('lst-1');
  await expect(page.locator('#c2-payload-kind')).toHaveValue('curl_beacon');
  await expect(page.locator('#c2-payload-kind option[value="bash"]')).toBeDisabled();
  await page.locator('#c2-generate-oneliner-btn').click();
  await expect(page.locator('#c2-oneliner-output')).toContainText('Demo placeholder');
  await expect(page.locator('#c2-oneliner-copy')).toBeVisible();
  await page.locator('#c2-build-listener').selectOption('lst-1');
  await expect(page.locator('#c2-build-loopback-hint')).toBeVisible();
  await page.locator('#c2-build-os').selectOption('darwin');
  await expect(page.locator('#c2-build-arch option[value="386"]')).toBeDisabled();
  await page.locator('#c2-build-host').fill('https://not-a-host/path');
  await page.locator('#c2-build-btn').click();
  await expect(page.locator('#c2-build-host')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#c2-build-host').fill('callback.example.test');
  await page.locator('#c2-build-btn').click();
  await expect(page.locator('#c2-build-result')).toContainText('unavailable in demo mode');
  await expect(page.locator('#c2-build-btn')).toBeEnabled();
  await expect(page.locator('#page-c2-payloads')).not.toContainText('c2.payloads.');
});

test('C2 workspace is usable at mobile, tablet and desktop widths without page overflow', async ({ page }) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['c2-sessions', 'c2-listeners', 'c2-activity', 'c2-payloads']) {
      await openApp(page, route);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (route === 'c2-sessions') await expect(page.locator('.c2-session-select')).toBeInViewport();
      if (route === 'c2-activity') await expect(page.locator('#c2-task-list tbody tr')).toHaveCount(1);
    }
  }
});
