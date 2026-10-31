import type { Page } from '@playwright/test';
import { test, expect, openApp } from './fixtures';

async function reloadSavedState(page: Page): Promise<void> {
  // openApp resets the demo once; subsequent reloads must read the saved writes.
  await page.evaluate(() => history.replaceState(null, '', '/' + location.hash));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
}

test('knowledge CRUD survives navigation and reload through the installed bridge', async ({ page }) => {
  await openApp(page, 'knowledge-management');
  await page.locator('[data-action="knowledge.add"]').click();
  await page.locator('#knowledge-item-category').fill('Migration evidence');
  await page.locator('#knowledge-item-title').fill('Integrated knowledge');
  await page.locator('#knowledge-item-content').fill('# Evidence\nCreated through the real shell.');
  await page.locator('[data-action="knowledge.save"]').click();
  await expect(page.locator('#knowledge-item-modal')).toBeHidden();
  const item = page.locator('.knowledge-item-card').filter({ hasText: 'Integrated knowledge' });
  await expect(item).toBeVisible();
  await item.locator('[data-action="knowledge.edit"]').click();
  await expect(page.locator('#knowledge-item-content')).toHaveValue('# Evidence\nCreated through the real shell.');
  await page.locator('#knowledge-item-title').fill('Edited knowledge');
  await page.locator('[data-action="knowledge.save"]').click();
  await expect(page.locator('#knowledge-item-modal')).toBeHidden();
  await reloadSavedState(page);
  const edited = page.locator('.knowledge-item-card').filter({ hasText: 'Edited knowledge' });
  await expect(edited).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await edited.locator('[data-action="knowledge.delete"]').click();
  await expect(edited).toHaveCount(0);
  await reloadSavedState(page);
  await expect(page.locator('.knowledge-item-card').filter({ hasText: 'Edited knowledge' })).toHaveCount(0);
});

test('assets CRUD parses a target, edits ownership and persists deletion', async ({ page }) => {
  await openApp(page, 'asset-library');
  await page.locator('#page-asset-library [data-assets-click="asset.edit"]').first().click();
  await page.locator('#asset-edit-target').fill('https://migration.example.test:8443');
  await page.locator('#asset-edit-tags').fill('migration, evidence');
  await page.locator('#asset-editor-submit').click();
  await expect(page.locator('#asset-editor-modal')).toBeHidden();
  const row = page.locator('#asset-table-body tr').filter({ hasText: 'migration.example.test' });
  await expect(row).toBeVisible();
  await row.locator('.asset-target-link').click();
  await expect(page.locator('#asset-detail-grid')).toContainText('8443');
  await expect(page.locator('#asset-detail-grid')).toContainText('evidence');
  await page.locator('[data-assets-click="asset.edit-detail"]').click();
  // The editor shows its ownership group inline; there is no disclosure to open.
  await page.locator('#asset-edit-responsible').fill('Migration owner');
  await page.locator('#asset-editor-submit').click();
  await expect(page.locator('#asset-editor-modal')).toBeHidden();
  await expect(row).toContainText('Migration owner');
  await reloadSavedState(page);
  await expect(row).toContainText('Migration owner');
  page.once('dialog', dialog => dialog.accept());
  await row.locator('[data-assets-click="asset.delete"]').click();
  await expect(row).toHaveCount(0);
  await reloadSavedState(page);
  await expect(row).toHaveCount(0);
});

test('task queue CRUD edits a subtask and removes the persisted queue', async ({ page }) => {
  await openApp(page, 'tasks');
  await page.locator('[data-tasks-click="showBatchImportModal"]').click();
  await page.locator('#batch-queue-title').fill('Integrated queue');
  await page.locator('#batch-tasks-input').fill('First evidence task\nSecond evidence task');
  await page.locator('[data-tasks-click="createBatchQueue"]').click();
  await expect(page.locator('#batch-queue-detail-title')).toContainText('Integrated queue');
  await expect(page.locator('.batch-task-item')).toHaveCount(2);
  await page.locator('.batch-task-edit-btn').first().click();
  await page.locator('.batch-task-inline-edit textarea').fill('Edited evidence task');
  await page.locator('.batch-task-inline-edit textarea').press('Tab');
  await expect(page.locator('.batch-task-message').first()).toHaveText('Edited evidence task');
  await page.locator('[data-tasks-click="closeBatchQueueDetailModal"]').first().click();
  await reloadSavedState(page);
  await page.locator('#batch-queues-list').getByRole('button', { name: 'Integrated queue', exact: true }).click();
  await expect(page.locator('.batch-task-message').first()).toHaveText('Edited evidence task');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#batch-queue-delete-btn').click();
  await expect(page.locator('#batch-queue-detail-modal')).toBeHidden();
  await expect(page.locator('#batch-queues-list')).not.toContainText('Integrated queue');
  await reloadSavedState(page);
  await expect(page.locator('#batch-queues-list')).not.toContainText('Integrated queue');
});

test('workflow CRUD composes a valid graph, saves metadata and persists deletion', async ({ page }) => {
  await openApp(page, 'workflows');
  await page.getByRole('button', { name: 'Choose a workflow', exact: true }).click();
  await expect(page.locator('#workflow-list .workflow-list-item').first()).toBeVisible();
  const before = await page.locator('.workflow-list-item').count();
  await page.locator('[data-wf-click="openWorkflowAiModal"]').first().click();
  await page.locator('#workflow-ai-prompt').fill('Create a report with human approval');
  await page.locator('#workflow-ai-generate-btn').click();
  await expect(page.locator('#workflow-ai-apply-btn')).toBeEnabled();
  await page.locator('#workflow-ai-apply-btn').click();
  await expect(page.locator('#workflow-ai-canvas-status')).toBeHidden();
  // The AI draft carries its own id and name; saving it adds one workflow to the list.
  await page.locator('[data-wf-click="saveWorkflowDraft"]').click();
  await expect(page.locator('.workflow-list-item')).toHaveCount(before + 1);
  await page.getByRole('button', { name: 'Choose a workflow', exact: true }).click();
  const seeded = page.locator('.workflow-list-item').filter({ hasText: 'Recon then validate' });
  await seeded.locator('[data-wf-click="editMeta"]').click();
  await page.locator('#workflow-name').fill('Edited workflow');
  await page.locator('[data-wf-click="applyWorkflowMetaModal"]').click();
  await page.locator('[data-wf-click="saveWorkflowDraft"]').click();
  await expect(page.locator('#workflow-list')).toContainText('Edited workflow');
  await reloadSavedState(page);
  await page.getByRole('button', { name: 'Choose a workflow', exact: true }).click();
  await page.locator('.workflow-list-item').filter({ hasText: 'Edited workflow' }).locator('[data-wf-click="select"]').click();
  await expect(page.locator('#workflow-canvas-title')).toHaveText('Edited workflow');
  await page.locator('#workflow-more-actions summary').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-wf-click="deleteCurrent"]').click();
  await expect(page.locator('#workflow-list')).not.toContainText('Edited workflow');
  await reloadSavedState(page);
});
