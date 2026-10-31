import { test, expect, openApp } from './fixtures';

test('legacy queues remain editable through Schedule, including cron, concurrency, task reruns and outputs', async ({ page }) => {
  await openApp(page, 'tasks');
  await expect(page).toHaveURL(/#workflows\?tab=schedule$/);
  await expect(page.locator('.nav-item[data-page="tasks"]')).toHaveCount(0);
  await expect(page.locator('#batch-queues-list table')).toBeVisible();
  await page.locator('[data-tasks-click="showBatchImportModal"]').click();
  await page.locator('#batch-queue-title').fill('Recurring independent batch');
  await page.locator('#batch-tasks-input').fill('Input one\nInput two');
  await page.locator('#batch-queue-concurrency').fill('2');
  await page.locator('#batch-queue-schedule-mode').selectOption('cron', { force: true });
  await page.locator('#batch-queue-cron-expr').fill('0 2 * * *');
  await page.locator('[data-tasks-click="createBatchQueue"]').click();
  await expect(page.locator('#batch-queue-detail-content')).toContainText('Independent batch tasks');
  await expect(page.locator('#bq-concurrency-val')).toHaveText('2');
  await expect(page.locator('#bq-schedule-val')).toContainText('0 2 * * *');
  await page.locator('[data-tasks-change="scheduleEnabled"]').uncheck();
  await expect(page.locator('[data-tasks-change="scheduleEnabled"]')).not.toBeChecked();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.batch-task-run-btn').first().click();
  await expect(page.locator('.batch-task-item').first()).toContainText('Demo: task completed');
  await page.locator('[data-tasks-click="closeBatchQueueDetailModal"]').click();
  await page.evaluate(() => history.replaceState(null, '', '/' + location.hash)); await page.reload();
  await page.locator('#batch-queues-list').getByRole('button', { name: 'Recurring independent batch', exact: true }).click();
  await expect(page.locator('#bq-concurrency-val')).toHaveText('2');
  await expect(page.locator('[data-tasks-change="scheduleEnabled"]')).not.toBeChecked();
});

test('executes saved workflows, inspects graph node records, approves a run and preserves builder edits', async ({ page }) => {
  await openApp(page, 'workflows');
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await expect(page.locator('#workflow-runs-list')).toContainText('No runs found');
  await page.getByRole('button', { name: 'Run workflow', exact: true }).click();
  await expect(page.locator('#batch-queue-workflow')).not.toHaveValue('');
  await page.locator('#batch-queue-title').fill('Workflow execution test');
  await page.locator('#batch-tasks-input').fill('Test input');
  await page.locator('[data-tasks-click="createBatchQueue"]').click();
  await expect(page.locator('#batch-queue-detail-content')).toContainText('Workflow:');
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await page.locator('#workflow-runs-list [data-orch-click="selectRun"]').first().click();
  await expect(page.locator('#workflow-run-graph canvas').first()).toBeVisible();
  await page.locator('#workflow-run-nodes button').first().click();
  await expect(page.locator('#workflow-run-node-detail')).toContainText('Test input');
  const approve = page.getByRole('button', { name: 'Approve & continue', exact: true });
  await expect(approve).toBeVisible(); await page.locator('#workflow-run-comment').fill('Reviewed in orchestration test'); await approve.click();
  await expect(page.locator('#workflow-run-summary')).toContainText('completed');
  await expect(page.locator('#workflow-run-output')).toContainText('Demo workflow execution');
  await page.getByRole('button', { name: 'Rerun current definition', exact: true }).click();
  await expect(page.locator('#batch-queue-detail-title')).toContainText('Rerun');
  await page.getByRole('button', { name: 'Builder', exact: true }).click();
  await expect(page.locator('#workflow-save-state')).toHaveText('Saved');
  await expect(page.locator('#workflow-properties')).toBeHidden();
  await page.getByRole('button', { name: 'Find a node', exact: true }).click();
  await page.locator('#workflow-navigator-search').fill('Port scan');
  await page.locator('.workflow-navigator-item').first().click();
  await page.locator('#workflow-prop-label').fill('Unsaved builder change');
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await page.locator('#workflow-runs-list [data-orch-click="selectRun"]').first().click();
  await expect(page.locator('#workflow-run-graph canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Builder', exact: true }).click();
  await expect(page.locator('#workflow-save-state')).toHaveText('Unsaved changes');
  await expect(page.locator('#workflow-prop-label')).toHaveValue('Unsaved builder change');
});

test('compact run and schedule views fit narrow and wide screens', async ({ page }) => {
  await openApp(page, 'workflows?tab=runs');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(page.locator('#batch-queues-list')).toBeVisible();
    await expect(page.locator('#workflow-builder')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole('button', { name: 'Runs', exact: true }).click();
    await expect(page.locator('#workflow-runs-list')).toBeVisible();
    await expect(page.locator('#workflow-builder')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});
