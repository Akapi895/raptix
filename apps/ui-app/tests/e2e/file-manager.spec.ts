import { expect, openApp, test } from './fixtures';
import type { Page } from '@playwright/test';

const list = '#chat-files-list-wrap';
const tree = '#chat-files-tree';
const modal = '#chat-files-preview-modal';
async function filters(page: Page) { await page.locator('#chat-files-filter-menu summary').click(); }
async function installInventory(page: Page, options: { count?: number; denied?: boolean } = {}) {
  await page.evaluate(({ count, denied }) => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
      if (url.pathname === '/api/chat-uploads' && (!init?.method || init.method === 'GET')) {
        if (denied) return Response.json({ error: 'Forbidden' }, { status: 403 });
        const names = count ? Array.from({ length: count }, (_, index) => `result-${String(index).padStart(4, '0')}.json`) : ['unsafe.html', 'capture.png', 'archive.zip', 'oversized.log', 'report.pdf'];
        return Response.json({ files: names.map((name, index) => ({ name, relativePath: '__workspace__/projects/proj-lab-web/results/' + name, source: 'workspace', projectId: 'proj-lab-web', projectName: 'Lab Web Perimeter', size: name === 'oversized.log' ? 4 * 1024 ** 2 : 200, modifiedUnix: 1800000000 - index })), folders: [], total: names.length });
      }
      if (url.pathname === '/api/chat-uploads/download') {
        const name = url.searchParams.get('path') || '';
        if (name.endsWith('.png')) return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'image/png' } });
        if (name.endsWith('.pdf')) return new Response('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF', { headers: { 'Content-Type': 'application/pdf' } });
        return new Response('<script>window.badFilePreview = true</script>\n<h1>Assessment evidence</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
      return original(input, init);
    };
  }, options);
  await page.locator('#chat-files-refresh-btn').click();
}

test('all files use project context, source/type filters, sorting, and conversation selection', async ({ page }) => {
  await openApp(page, 'chat-files');
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(4);
  await expect(page.locator(list)).not.toContainText('notes.md');
  await expect(page.locator('#chat-files-filter-project')).toHaveCount(0);
  await page.locator('#chat-files-sort').selectOption('name-asc');
  await expect(page.locator(`${list} .fm-file-open strong`).first()).toHaveText('assessment.md');
  await filters(page);
  await page.locator('#chat-files-filter-source').selectOption('workspace');
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(1);
  await expect(page.locator(list)).toContainText('hosts.json');
  await page.locator('#chat-files-filter-menu button').click();
  await page.locator('#chat-files-filter-name').fill('ASSESSMENT');
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(1);
  await page.locator('#chat-files-filter-name').fill('');
  await page.locator('#chat-files-filter-conv').selectOption('conv-recon-01');
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(2);
  await page.locator('#chat-files-refresh-btn').click();
  await expect(page.locator('#chat-files-filter-conv')).toHaveValue('conv-recon-01');
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(2);
  await expect(page.locator(list)).not.toContainText('hosts.json');
  await expect(page.locator('#chat-files-pagination').getByRole('button', { name: 'Next' })).toHaveCount(0);
  await page.locator('.csai-ps-trigger').click();
  await page.locator('.csai-ps-option').filter({ hasText: 'Internal' }).click();
  await expect(page.locator(list)).toContainText('notes.md');
  await expect(page.locator(list)).not.toContainText('assessment.md');
  await expect(page.locator('#chat-files-filter-conv')).toHaveValue('');
});

test('Explorer, breadcrumbs, empty folders, new folders, and folder deletion use actual storage paths', async ({ page }) => {
  await openApp(page, 'chat-files');
  await page.locator(`${tree} [data-action="chat-files.expand"][data-path="uploads"]`).click();
  await page.locator(`${tree} [data-action="chat-files.expand"][data-path="uploads/2026-10-31"]`).click();
  await page.locator(`${tree} [data-action="chat-files.navigate"][data-path="uploads/2026-10-31/conv-recon-01"]`).click();
  await expect(page.locator(list)).toContainText('evidence');
  await page.locator(`${list} [data-path$="/evidence"]`).click();
  await expect(page.locator(list)).toContainText('This folder is empty');
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.locator('#chat-files-mkdir-input').fill('screenshots');
  await page.locator('[data-action="chat-files.mkdirSubmit"]').click();
  await expect(page.locator(`${list} [data-path$="/screenshots"]`)).toBeVisible();
  await page.locator(`${list} [data-path$="/screenshots"]`).click();
  await expect(page.locator('#chat-files-breadcrumb')).toContainText('screenshots');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
  await expect(page.locator('#chat-files-breadcrumb')).toContainText('All files');
  await page.locator('#chat-files-breadcrumb [data-path=""]').click();
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(4);
});

test('uploads remain associated with the selected conversation; upload edit, rename and delete survive consolidation', async ({ page }) => {
  await openApp(page, 'chat-files');
  await page.locator('#chat-files-filter-conv').selectOption('conv-recon-01');
  await expect(page.locator(list)).toContainText('scan-results.txt');
  await page.locator('#chat-files-upload-input').setInputFiles({ name: 'field-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('assessment notes') });
  await expect(page.locator(list)).toContainText('field-notes.txt');
  await expect(page.locator('#chat-files-status')).toContainText('Upload complete');
  const row = page.locator(`${list} tr`).filter({ hasText: 'field-notes.txt' });
  await row.getByRole('button', { name: 'More actions for field-notes.txt' }).click();
  await page.getByRole('menuitem', { name: 'Edit as text' }).click();
  await expect(page.locator('#chat-files-edit-textarea')).toHaveValue(/Demo content/);
  await page.locator('#chat-files-edit-textarea').fill('updated notes');
  await page.locator('[data-action="chat-files.editSave"]').click();
  await expect(page.locator('#chat-files-edit-modal')).toBeHidden();
  await row.getByRole('button', { name: 'More actions for field-notes.txt' }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await page.locator('#chat-files-rename-input').fill('reviewed-notes.txt');
  await page.locator('[data-action="chat-files.renameSubmit"]').click();
  await expect(page.locator(list)).toContainText('reviewed-notes.txt');
  await page.locator(`${list} tr`).filter({ hasText: 'reviewed-notes.txt' }).getByRole('button', { name: 'More actions for reviewed-notes.txt' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('menuitem', { name: 'Delete file', exact: true }).click();
  await expect(page.locator(list)).not.toContainText('reviewed-notes.txt');
});

test('text previews are inert, modal actions download and copy paths, Escape restores focus', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page, 'chat-files');
  await installInventory(page);
  const file = page.locator(`${list} .fm-file-open`).filter({ hasText: 'unsafe.html' });
  await file.click();
  await expect(page.locator(`${modal} pre`)).toContainText('<script>window.badFilePreview');
  await expect(page.locator(`${modal} script`)).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.has(window, 'badFilePreview'))).toBe(false);
  await expect(page.locator('#chat-files-preview-meta')).toContainText('__workspace__/projects/proj-lab-web/results/unsafe.html');
  await page.locator('#chat-files-preview-copy').click();
  await expect(page.locator('#chat-files-preview-feedback')).toHaveText('Path copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('__workspace__/projects/proj-lab-web/results/unsafe.html');
  const download = page.waitForEvent('download');
  await page.locator('#chat-files-preview-download').click();
  expect((await download).suggestedFilename()).toBe('unsafe.html');
  await page.keyboard.press('Escape');
  await expect(page.locator(modal)).toBeHidden();
  await expect(file).toBeFocused();
  await page.locator(`${list} tr`).filter({ hasText: 'unsafe.html' }).getByRole('button', { name: 'More actions for unsafe.html' }).click();
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Delete file' })).toHaveCount(0);
});

test('image and PDF previews, unsupported formats, size limits, and file type filters', async ({ page }) => {
  await openApp(page, 'chat-files');
  await installInventory(page);
  await page.locator(`${list} .fm-file-open`).filter({ hasText: 'capture.png' }).click();
  await expect(page.locator(`${modal} img`)).toBeVisible();
  expect(await page.locator(`${modal} img`).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.locator(`${list} .fm-file-open`).filter({ hasText: 'archive.zip' }).click();
  await expect(page.locator(modal)).toContainText('Preview not available');
  await page.keyboard.press('Escape');
  await page.locator(`${list} .fm-file-open`).filter({ hasText: 'oversized.log' }).click();
  await expect(page.locator(modal)).toContainText('File too large to preview');
  await page.keyboard.press('Escape');
  await page.locator(`${list} .fm-file-open`).filter({ hasText: 'report.pdf' }).click();
  await expect(page.locator(`${modal} iframe`)).toHaveAttribute('sandbox', '');
  await page.keyboard.press('Escape');
  await filters(page);
  await page.locator('#chat-files-filter-type').selectOption('image');
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(1);
  await expect(page.locator(list)).toContainText('capture.png');
});

test('large inventories paginate rows and keep search across all inventory entries', async ({ page }) => {
  await openApp(page, 'chat-files');
  await installInventory(page, { count: 1205 });
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(20);
  await expect(page.locator('#chat-files-pagination')).toContainText('1205');
  await page.locator('#chat-files-pagination').getByRole('button', { name: 'Next' }).click();
  await expect(page.locator(`${list} .fm-file-open strong`).first()).toHaveText('result-0020.json');
  await page.locator('#chat-files-filter-name').fill('result-1204');
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(1);
  await expect(page.locator(list)).toContainText('result-1204.json');
});

test('permission errors replace stale content and provide retry', async ({ page }) => {
  await openApp(page, 'chat-files');
  await expect(page.locator(list)).toContainText('assessment.md');
  await installInventory(page, { denied: true });
  await expect(page.locator(list)).toContainText('You do not have permission');
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(0);
  await expect(page.locator(list).getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.locator(tree)).toContainText('Folders unavailable');
});

test('refresh keeps the conversation filter while its options reload', async ({ page }) => {
  await openApp(page, 'chat-files');
  await page.locator('#chat-files-filter-conv').selectOption('conv-recon-01');
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(2);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname === '/api/conversations') await new Promise(resolve => setTimeout(resolve, 400));
      return original(input, init);
    };
  });
  await page.locator('#chat-files-refresh-btn').click();
  await expect(page.locator('#chat-files-filter-conv')).toBeEnabled();
  await expect(page.locator('#chat-files-filter-conv')).toHaveValue('conv-recon-01');
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(2);
  await expect(page.locator(list)).not.toContainText('hosts.json');
});

test('preview failures remain local, retain Download, and never expose invalid inventory paths', async ({ page }) => {
  await openApp(page, 'chat-files');
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname === '/api/chat-uploads' && (!init?.method || init.method === 'GET')) return Response.json({ files: [
        { name: 'private.txt', relativePath: '__workspace__/projects/proj-lab-web/private.txt', projectId: 'proj-lab-web', source: 'workspace', size: 20 },
        { name: 'traversal.txt', relativePath: '../../private.txt', projectId: 'proj-lab-web', source: 'upload' },
      ], folders: ['../private'] });
      if (url.pathname === '/api/chat-uploads/download') return Response.json({ error: 'Forbidden' }, { status: 403 });
      return original(input, init);
    };
  });
  await page.locator('#chat-files-refresh-btn').click();
  await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(1);
  await expect(page.locator(list)).not.toContainText('traversal.txt');
  await page.locator(`${list} .fm-file-open`).click();
  await expect(page.locator(`${modal} [role="alert"]`)).toContainText('permission');
  await expect(page.locator('#chat-files-preview-download')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator(modal)).toBeHidden();
});

test('download actions and filtered export use existing endpoints', async ({ page }) => {
  await openApp(page, 'chat-files');
  await expect(page.locator(list)).toContainText('assessment.md');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download assessment.md', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('assessment.md');
  const exported = page.waitForEvent('download');
  await page.locator('#chat-files-export-btn').click();
  expect((await exported).suggestedFilename()).toBe('chat-uploads-demo.zip');
});

test('folder uploads and drag-and-drop retain the upload directory', async ({ page }) => {
  await openApp(page, 'chat-files');
  await page.locator(`${tree} [data-action="chat-files.expand"][data-path="uploads"]`).click();
  await page.locator(`${tree} [data-action="chat-files.expand"][data-path="uploads/2026-10-31"]`).click();
  await page.locator(`${tree} [data-action="chat-files.navigate"][data-path="uploads/2026-10-31/conv-recon-01"]`).click();
  await page.locator(`${list} [data-path$="/evidence"]`).click();
  await expect(page.locator(list)).toContainText('This folder is empty');
  await page.locator(list).evaluate(element => {
    const data = new DataTransfer(); data.items.add(new File(['evidence'], 'evidence.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await expect(page.locator(list)).toContainText('evidence.txt');
  await page.locator(`${list} .fm-file-open`).click();
  await expect(page.locator('#chat-files-preview-meta')).toContainText('2026-10-31/conv-recon-01/evidence/evidence.txt');
});

for (const width of [1440, 1280, 1024, 768, 390, 320]) {
  test(`file manager and modal fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openApp(page, 'chat-files');
    await expect(page.locator(`${list} .fm-file-open`)).toHaveCount(4);
    const more = page.getByRole('button', { name: 'More actions for assessment.md' });
    const moreBox = await more.boundingBox();
    expect(moreBox!.x + moreBox!.width).toBeLessThanOrEqual(width);
    await more.click();
    await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Download', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const explorer = page.locator('#chat-files-explorer');
    if (width <= 1100) { await expect(explorer).toBeHidden(); await page.locator('#chat-files-explorer-toggle').click(); }
    await expect(explorer).toBeVisible();
    const bounds = await explorer.boundingBox();
    if (width > 760) expect(bounds!.width).toBeGreaterThanOrEqual(280);
    await page.locator('#chat-files-explorer-toggle').click();
    await expect(explorer).toBeHidden();
    await page.locator(`${list} .fm-file-open`).first().click();
    await expect(page.locator(`${modal} pre`)).toBeVisible();
    const overflows = await page.evaluate(() => ['#page-chat-files', '.fm-main', '.fm-toolbar', '.fm-list', '.fm-table', '.fm-preview-dialog'].filter(selector => { const node = document.querySelector<HTMLElement>(selector)!; return node.scrollWidth > node.clientWidth + 1; }));
    expect(overflows).toEqual([]);
    const box = await page.locator('.fm-preview-dialog').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
  });
}
