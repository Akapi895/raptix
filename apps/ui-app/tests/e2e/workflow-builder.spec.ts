import type { Page } from '@playwright/test';
import type { Core } from 'cytoscape';
import { test, expect, openApp } from './fixtures';

async function findNode(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Find a node', exact: true }).click();
  await page.locator('#workflow-navigator-search').fill(name);
  await page.locator('.workflow-navigator-item').first().click();
  await expect(page.locator('#workflow-properties')).toBeVisible();
}

// Read renderer coordinates, but exercise editing through real pointer/keyboard input.
async function clickCanvasNode(page: Page, id: string, button: 'left' | 'right' = 'left'): Promise<void> {
  const point = await page.evaluate(nodeId => {
    const canvas = document.getElementById('workflow-canvas') as HTMLElement & { _cyreg: { cy: Core } };
    const position = canvas._cyreg.cy.getElementById(nodeId).renderedPosition();
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + position.x, y: rect.top + position.y };
  }, id);
  await page.mouse.click(point.x, point.y, { button });
}

async function graphSnapshot(page: Page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('workflow-canvas') as HTMLElement & { _cyreg: { cy: Core } };
    const cy = canvas._cyreg.cy;
    return {
      nodes: cy.nodes().map(node => ({ id: node.id(), data: node.data() as unknown, position: { ...node.position() } })).sort((a, b) => a.id.localeCompare(b.id)),
      edges: cy.edges().map(edge => ({ id: edge.id(), source: edge.source().id(), target: edge.target().id(), data: edge.data() as unknown })).sort((a, b) => a.id.localeCompare(b.id)),
    };
  });
}

test('visible node deletion confirms consequences, removes connections, revalidates and restores the exact graph', async ({ page }) => {
  await openApp(page, 'workflows');
  await findNode(page, 'Port scan');
  const before = await graphSnapshot(page);
  const remove = page.getByRole('button', { name: 'Delete node', exact: true });
  await expect(remove).toBeVisible();
  expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Delete node “Port scan”?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('2 connected edges');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await graphSnapshot(page)).toEqual(before);
  await expect(page.locator('#workflow-save-state')).toHaveText('Saved');
  await remove.click();
  await dialog.getByRole('button', { name: 'Delete node', exact: true }).click();
  await expect(page.locator('#workflow-deletion-message')).toHaveText('Deleted node “Port scan”. 2 connected edges removed.');
  await expect(page.locator('#workflow-properties')).toBeHidden();
  const after = await graphSnapshot(page);
  expect(after.nodes).toEqual(before.nodes.filter(node => node.id !== 'recon'));
  expect(after.edges).toEqual(before.edges.filter(edge => edge.source !== 'recon' && edge.target !== 'recon'));
  await expect(page.locator('#workflow-validation-button')).toHaveClass(/has-errors/);
  await expect(page.locator('#workflow-save-state')).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: 'Undo deletion', exact: true }).click();
  expect(await graphSnapshot(page)).toEqual(before);
  await expect(page.locator('#workflow-validation-button')).toHaveText('Definition valid');
  await expect(page.locator('#workflow-tool-arguments')).toHaveValue(/"ports": "80,443,3000"/);
  await expect(page.locator('#workflow-deletion-message')).toContainText('Deletion undone');
  await expect(page.locator('#workflow-undo-delete-btn')).toBeHidden();
  await page.locator('#workflow-save-btn').click();
  await expect(page.locator('#workflow-save-state')).toHaveText('Saved');
});

test('right-click targets the clicked node and supports dismissal, confirmation and keyboard undo', async ({ page }) => {
  await openApp(page, 'workflows');
  await findNode(page, 'Port scan');
  await clickCanvasNode(page, 'probe', 'right');
  const menu = page.getByRole('menu', { name: 'Node actions', exact: true });
  await expect(menu).toBeVisible();
  await expect(page.locator('#workflow-prop-label')).toHaveValue('HTTP probe');
  await expect(menu.getByRole('menuitem', { name: 'Delete node' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.locator('#workflow-canvas')).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Delete node “HTTP probe”?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete node', exact: true }).click();
  await expect(page.locator('#workflow-deletion-message')).toContainText('HTTP probe');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#workflow-prop-label')).toHaveValue('HTTP probe');
  await expect(page.locator('#workflow-validation-button')).toHaveText('Definition valid');
});

test('Delete and Backspace respect text, JSON, contenteditable and native text undo', async ({ page }) => {
  await openApp(page, 'workflows');
  await findNode(page, 'Port scan');
  const before = await graphSnapshot(page);
  // Pointer selection moves focus from the inspector to the canvas for shortcuts.
  await clickCanvasNode(page, 'recon');
  await page.keyboard.press('Delete');
  await expect(page.locator('#workflow-delete-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('#workflow-tool-arguments').focus();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await expect(page.locator('#workflow-delete-dialog')).not.toBeVisible();
  await page.locator('#workflow-tool-arguments').fill('{"ports":"80,443,3000"}');
  await page.locator('#workflow-prop-label').focus();
  await page.keyboard.press('End');
  await page.keyboard.type('X');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#workflow-prop-label')).toHaveValue('Port scan');
  await page.evaluate(() => {
    const editable = document.createElement('div'); editable.contentEditable = 'plaintext-only'; editable.id = 'deletion-editable-test';
    editable.innerHTML = '<span>Editable text</span>'; document.getElementById('workflow-property-form')!.append(editable); editable.focus();
  });
  await page.keyboard.press('Delete'); await page.keyboard.press('Backspace');
  await expect(page.locator('#workflow-delete-dialog')).not.toBeVisible();
  expect((await graphSnapshot(page)).nodes.length).toBe(before.nodes.length);
  await clickCanvasNode(page, 'recon');
  await page.keyboard.press('Backspace');
  await page.locator('#workflow-delete-confirm').click();
  await findNode(page, 'HTTP probe');
  await page.locator('#workflow-prop-label').focus(); await page.keyboard.press('End'); await page.keyboard.type('X'); await page.keyboard.press('Control+z');
  await expect(page.locator('#workflow-prop-label')).toHaveValue('HTTP probe');
  expect((await graphSnapshot(page)).nodes.length).toBe(before.nodes.length - 1);
  await page.locator('#workflow-tool-arguments').focus(); await page.keyboard.press('Control+z');
  expect((await graphSnapshot(page)).nodes.length).toBe(before.nodes.length - 1);
  await page.locator('#workflow-canvas').focus();
  await page.keyboard.press('Meta+z');
  await expect(page.locator('#workflow-tool-arguments')).toHaveValue(/"ports":\s*"80,443,3000"/);
  await expect(page.locator('#workflow-validation-button')).toHaveText('Definition valid');
});

test('multiple deletions undo in order without losing later edits and do not cross workflows', async ({ page }) => {
  await openApp(page, 'workflows');
  await findNode(page, 'Port scan');
  const before = await graphSnapshot(page);
  for (const name of ['Port scan', 'HTTP probe']) {
    await findNode(page, name);
    await page.locator('#workflow-property-delete-btn').click();
    await page.locator('#workflow-delete-confirm').click();
  }
  await page.keyboard.press('Control+z');
  await expect(page.locator('#workflow-prop-label')).toHaveValue('HTTP probe');
  await page.locator('#workflow-prop-label').fill('Renamed probe');
  await page.locator('#workflow-canvas').focus();
  await page.keyboard.press('Control+z');
  const restored = await graphSnapshot(page);
  expect(restored.nodes.length).toBe(before.nodes.length);
  expect(restored.edges).toEqual(before.edges);
  expect(restored.nodes.find(node => node.id === 'probe')!.data).toMatchObject({ label: 'Renamed probe' });
  await page.locator('#workflow-property-delete-btn').click(); await page.locator('#workflow-delete-confirm').click();
  await page.getByRole('button', { name: 'Choose a workflow', exact: true }).click();
  await page.locator('#workflow-search').fill('regression');
  await page.locator('[data-wf-click="select"]').click();
  const next = await graphSnapshot(page);
  await page.locator('#workflow-canvas').focus(); await page.keyboard.press('Control+z');
  expect(await graphSnapshot(page)).toEqual(next);
  await expect(page.locator('#workflow-deletion-feedback')).toBeHidden();
});

test('narrow deletion controls and long-name confirmation fit without hiding recovery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, 'workflows');
  await findNode(page, 'Port scan');
  await page.locator('#workflow-prop-label').fill('Long node name '.repeat(12));
  await page.locator('#workflow-property-delete-btn').click();
  const dialog = await page.locator('#workflow-delete-dialog').boundingBox();
  expect(dialog!.x).toBeGreaterThanOrEqual(0); expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(390);
  expect(Math.abs(dialog!.x + dialog!.width / 2 - 195)).toBeLessThanOrEqual(1);
  await page.locator('#workflow-delete-confirm').click();
  await expect(page.getByRole('button', { name: 'Undo deletion', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Undo deletion', exact: true }).click();
  await expect(page.locator('#workflow-validation-button')).toHaveText('Definition valid');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('contextual editing locates invalid JSON, preserves object arguments and supports dry run and export', async ({ page }) => {
  await openApp(page, 'workflows');
  await expect(page.locator('#workflow-properties')).toBeHidden();
  await expect(page.locator('#workflow-switcher')).toBeHidden();
  await expect(page.locator('#workflow-validation-button')).toHaveText('Definition valid');
  await findNode(page, 'Port scan');
  await expect(page.locator('#workflow-tool-arguments')).toHaveValue(/"ports": "80,443,3000"/);
  await expect(page.locator('#workflow-tool-timeout')).toBeHidden();
  await page.locator('#workflow-tool-arguments').fill('{bad json');
  await expect(page.locator('#workflow-tool-arguments')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#workflow-save-state')).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: 'Close properties', exact: true }).click();
  await page.locator('#workflow-save-btn').click();
  await expect(page.locator('#workflow-validation-menu')).toBeVisible();
  await page.locator('.workflow-issue').filter({ hasText: 'tool arguments must be valid JSON' }).click();
  await expect(page.locator('#workflow-tool-arguments')).toBeFocused();
  await page.locator('#workflow-tool-arguments').fill('{"ports":"443"}');
  await page.getByRole('button', { name: 'Format JSON', exact: true }).click();
  await expect(page.locator('#workflow-tool-arguments')).toHaveValue('{\n  "ports": "443"\n}');
  await expect(page.locator('#workflow-validation-button')).toHaveText('Definition valid');
  await page.locator('#workflow-save-btn').click();
  await expect(page.locator('#workflow-save-state')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Dry run', exact: true }).click();
  await page.locator('#workflow-dry-run-modal button[type="submit"]').click();
  await expect(page.locator('#workflow-dry-run-output')).toContainText('Dry run completed');
  await expect(page.locator('#workflow-validation-button')).toHaveText('Definition valid');
  await page.locator('#workflow-more-actions summary').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#workflow-package-export-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  await page.getByRole('button', { name: 'Close properties', exact: true }).click();
  await findNode(page, 'Approve findings');
  await expect(page.locator('#workflow-hitl-prompt')).toHaveValue('Confirm the services before validation');
  await expect(page.locator('#workflow-tool-arguments')).toHaveCount(0);
});

test('builds and validates a true/false branch using canvas connections and automatic layout', async ({ page }) => {
  await openApp(page, 'workflows');
  await page.getByRole('button', { name: 'Choose a workflow', exact: true }).click();
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  await page.locator('#workflow-id').fill('branch-check');
  await page.locator('#workflow-name').fill('Branch check');
  await page.locator('[data-wf-click="applyWorkflowMetaModal"]').click();
  await expect(page.locator('#workflow-canvas-empty')).toBeVisible();
  await page.locator('#workflow-validation-button').click();
  await page.locator('.workflow-issue').filter({ hasText: 'Add start node' }).click();
  await expect(page.locator('#workflow-start-input-keys')).toBeVisible();
  for (const type of ['condition', 'output', 'output']) {
    await page.getByRole('button', { name: 'Add node', exact: true }).click();
    await page.locator('#workflow-node-search').fill(type);
    await page.locator(`#workflow-add-menu [data-node-type="${type}"]`).click();
  }
  await page.getByRole('button', { name: 'Close properties', exact: true }).click();
  await page.locator('[data-wf-click="layoutWorkflowGraph"]').click();
  await page.waitForTimeout(600);
  await page.locator('#workflow-connect-btn').click();
  await clickCanvasNode(page, 'node-1'); await clickCanvasNode(page, 'node-2');
  await clickCanvasNode(page, 'node-2'); await clickCanvasNode(page, 'node-3');
  await clickCanvasNode(page, 'node-2'); await clickCanvasNode(page, 'node-4');
  await page.locator('#workflow-canvas').press('Escape');
  await expect(page.locator('#workflow-connect-btn')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#workflow-validation-button')).toHaveText('Definition valid');
  await page.locator('[data-wf-click="layoutWorkflowGraph"]').click();
  await page.waitForTimeout(600);
  const layout = await page.evaluate(() => {
    const canvas = document.getElementById('workflow-canvas') as HTMLElement & { _cyreg: { cy: Core } };
    const cy = canvas._cyreg.cy;
    return { nodes: cy.nodes().map(node => ({ id: node.id(), x: node.position().x, y: node.position().y })), branches: cy.edges().map(edge => (edge.data('config') as { branch?: string }).branch).filter(Boolean) };
  });
  expect(layout.branches.sort()).toEqual(['false', 'true']);
  expect(layout.nodes[0]!.x).toBeLessThan(layout.nodes[1]!.x);
  expect(layout.nodes[2]!.y).not.toEqual(layout.nodes[3]!.y);
  await page.locator('#workflow-save-btn').click();
  await expect(page.locator('#workflow-save-state')).toHaveText('Saved');
});

test('narrow layout keeps canvas, save and searchable node menus usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, 'workflows');
  const canvas = await page.locator('#workflow-canvas').boundingBox();
  expect(canvas!.height).toBeGreaterThan(350);
  const save = await page.locator('#workflow-save-btn').boundingBox();
  expect(save!.x + save!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Choose a workflow', exact: true }).click();
  await page.locator('#workflow-search').fill('regression');
  await expect(page.locator('.workflow-list-item')).toHaveCount(1);
  await page.locator('[data-wf-click="select"]').click();
  await expect(page.locator('#workflow-canvas-title')).toHaveText('API regression set');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.locator('#workflow-node-search').fill('unmatched');
  await expect(page.locator('#workflow-node-no-results')).toBeVisible();
  await page.locator('#workflow-node-search').fill('agent');
  await page.locator('#workflow-add-menu [data-node-type="agent"]').click();
  await expect(page.locator('#workflow-agent-instruction')).toBeVisible();
  await page.getByRole('button', { name: 'Close properties', exact: true }).click();
  const zoom = await page.locator('#workflow-zoom').innerText();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('#workflow-zoom')).not.toHaveText(zoom);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.locator('#workflow-canvas-title')).toHaveText('API regression set');
  const tools = await page.locator('.workflow-canvas-tools').boundingBox();
  expect(tools!.x + tools!.width).toBeLessThanOrEqual(320);
});
