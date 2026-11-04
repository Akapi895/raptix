import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const paragraph = 'Assessment evidence should use the available document width and wrap naturally as the viewport changes. '.repeat(8);
const longPath = '/workspace/' + 'assessment-evidence/'.repeat(24) + 'report.md';
const codeLine = '    preserve_indentation = "' + 'evidence '.repeat(50) + '"';
const markdown = `# Assessment report

${paragraph}

${paragraph}

## Verification

### Recorded observations

- First observation
  - Nested observation with \\backslashes
- Second observation

1. Capture evidence
2. Review results

> Evidence must remain readable.
>
> ${paragraph}

Inline code: \`${longPath}\`

https://example.test/${'long-path/'.repeat(35)}

| Host | Status | Evidence | Owner | Service | Protocol | Result | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| example.test | Verified | Captured | Operator | HTTPS | TLS | Confirmed | Review configuration |

\`\`\`python
${codeLine}
print("captured")
\`\`\`

![Evidence diagram](/static/logo.png)

<script>window.markdownInjection = true</script>

## End of report`;

async function ready(page: Page, route: string) {
  await page.goto(`/?mock-reset=1#${route}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('#csai-mock-badge')).toBeVisible();
}

async function installContent(page: Page, content = markdown) {
  await page.evaluate(content => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname === '/api/chat-uploads/download') return new Response(content);
      return original(input, init);
    };
  }, content);
}

async function assertDocument(page: Page, selector: string, images = true) {
  const root = page.locator(selector);
  await expect(root.locator('h1')).toHaveText('Assessment report');
  await expect(root.locator('h2')).toHaveCount(2);
  await expect(root.locator('ul ul li')).toHaveText('Nested observation with \\backslashes');
  await expect(root.locator('pre code')).toContainText(codeLine);
  const geometry = await root.evaluate(element => {
    const pre = element.querySelector('pre')!;
    const table = element.querySelector('table')!;
    const scroll = table.parentElement!;
    const para = element.querySelector('p')!;
    const css = getComputedStyle(element);
    return {
      width: element.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
      paragraph: para.getBoundingClientRect().width,
      overflow: element.scrollWidth - element.clientWidth,
      codeWhiteSpace: getComputedStyle(pre).whiteSpace,
      codeOverflow: getComputedStyle(pre).overflowX,
      codeScrollable: pre.scrollWidth > pre.clientWidth,
      tableOverflow: getComputedStyle(scroll).overflowX,
      tableFits: scroll.clientWidth <= element.clientWidth + 1,
      tableWidth: scroll.clientWidth,
      rootWidth: element.clientWidth,
      tableClass: scroll.className,
      tableScrollable: scroll.scrollWidth > scroll.clientWidth,
      imgFits: [...element.querySelectorAll('img')].every(img => img.getBoundingClientRect().width <= element.clientWidth),
    };
  });
  expect(geometry.paragraph).toBeCloseTo(geometry.width, 0);
  expect(geometry.width).toBeGreaterThan(150);
  expect(geometry.overflow, JSON.stringify(geometry)).toBeLessThanOrEqual(1);
  expect(geometry.codeWhiteSpace).toBe('pre');
  expect(geometry.codeOverflow).toBe('auto');
  expect(geometry.codeScrollable).toBe(true);
  expect(geometry.tableOverflow).toBe('auto');
  expect(geometry.tableFits, JSON.stringify(geometry)).toBe(true);
  if (page.viewportSize()!.width === 390) expect(geometry.tableScrollable).toBe(true);
  expect(geometry.imgFits).toBe(true);
  await test.info().attach(`Markdown geometry: ${selector}`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
  await expect(root.locator('img')).toHaveCount(images ? 1 : 0);
  if (images) await expect.poll(() => root.locator('img').evaluate(img => img instanceof HTMLImageElement && img.naturalWidth > 0)).toBe(true);
  await expect(root.locator('script')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.has(window, 'markdownInjection'))).toBe(false);
}

test('User messages keep Markdown source as plain text', async ({ page }) => {
  await ready(page, 'dashboard');
  await page.evaluate(content => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== '/api/conversations/conv-recon-01') return response;
      return Response.json({ ...await response.json(), messages: [{ id: 'user-markdown', role: 'user', content }] });
    };
  }, markdown);
  await page.evaluate(() => location.hash = 'chat?conversation=conv-recon-01');
  const bubble = page.locator('#chat-messages .message.user .message-bubble');
  await expect(bubble).toContainText('# Assessment report');
  await expect(bubble.locator('h1, table, pre, img, script')).toHaveCount(0);
});

test('Long file metadata leaves the Markdown body scrollable on desktop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await ready(page, 'dashboard');
  await installContent(page);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== '/api/chat-uploads') return response;
      const payload = await response.json();
      payload.files.forEach((file: { absolutePath: string }) => { file.absolutePath = '/workspace/' + 'long-evidence-folder/'.repeat(180) + 'assessment.md'; });
      return Response.json(payload);
    };
  });
  await page.evaluate(() => location.hash = 'files');
  await page.locator('#chat-files-filter-name').fill('assessment');
  await page.locator('.fm-file-open').filter({ hasText: 'assessment.md' }).click();
  const body = page.locator('#chat-files-preview-body');
  await expect(body.locator('h1')).toHaveText('Assessment report');
  expect((await body.boundingBox())!.height).toBeGreaterThan(150);
  const meta = page.locator('#chat-files-preview-meta');
  expect(await meta.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await body.evaluate(el => el.scrollTop = el.scrollHeight);
  await expect(body.getByRole('heading', { name: 'End of report' })).toBeInViewport();
  await expect(page.locator('#chat-files-preview-download')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('files-long-metadata.png'), animations: 'disabled' });
});

for (const width of [1440, 1024, 768, 390]) {
  test(`Short Markdown keeps preview geometry in dark mode at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page, 'files');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await installContent(page, '# Short report\n\nA brief assessment.');
    await page.locator('#chat-files-filter-name').fill('assessment');
    await page.locator('.fm-file-open').filter({ hasText: 'assessment.md' }).click();
    await expect(page.locator('#chat-files-preview-body h1')).toHaveText('Short report');
    const dialog = page.locator('.fm-preview-dialog');
    await page.locator('#chat-files-preview-modal').evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
    const bounds = await dialog.boundingBox();
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    expect(await dialog.boundingBox()).toEqual(bounds);
    await expect(page.locator('#chat-files-preview-body > pre')).toHaveText('# Short report\n\nA brief assessment.');
    await page.getByRole('button', { name: 'Rendered', exact: true }).click();
    expect(await dialog.boundingBox()).toEqual(bounds);
    await page.screenshot({ path: testInfo.outputPath(`files-short-dark-${width}.png`), animations: 'disabled' });
  });

  test(`Files Markdown fills the preview and keeps local overflow at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ready(page, 'files');
    await installContent(page);
    await page.locator('#chat-files-filter-name').fill('assessment');
    const file = page.locator('.fm-file-open').filter({ hasText: 'assessment.md' });
    await file.click();
    const body = page.locator('#chat-files-preview-body');
    await assertDocument(page, '#chat-files-preview-body');
    const dialog = page.locator('.fm-preview-dialog');
    await page.screenshot({ path: testInfo.outputPath(`files-${width}.png`), animations: 'disabled' });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await body.locator('pre').scrollIntoViewIfNeeded();
    await body.locator('pre').focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => body.locator('pre').evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    if (width === 390) {
      const table = body.locator('.markdown-table-scroll');
      await table.focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    }
    await page.screenshot({ path: testInfo.outputPath(`files-details-${width}.png`), animations: 'disabled' });
    await body.evaluate(el => el.scrollTop = el.scrollHeight);
    expect(await body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(body.getByRole('heading', { name: 'End of report' })).toBeInViewport();
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    await expect(body.locator('pre')).toHaveText(markdown);
    expect(await body.locator('pre').evaluate(el => el.getBoundingClientRect().width)).toBe(await body.evaluate(el => el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight)));
    expect(await dialog.boundingBox()).toEqual(bounds);
    await page.getByRole('button', { name: 'Rendered', exact: true }).click();
    await expect(body.locator('h1')).toBeVisible();
    expect(await dialog.boundingBox()).toEqual(bounds);
    await page.locator('#chat-files-preview-copy').click();
    await expect(page.locator('#chat-files-preview-feedback')).toHaveText('Path copied');
    const download = page.waitForEvent('download');
    await page.locator('#chat-files-preview-download').click();
    expect((await download).suggestedFilename()).toBe('assessment.md');
    await page.keyboard.press('Escape');
    await expect(file).toBeFocused();
  });

  test(`Chat, Knowledge, findings and WebShell contain Markdown at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page, 'dashboard');
    await page.evaluate(content => {
      const original = window.fetch.bind(window);
      const item = { id: 'markdown-layout', title: 'Layout report', content, format: 'markdown', category: 'Reports' };
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.pathname === '/api/knowledge/items') return Response.json({ items: [item], total: 1, document_page: true });
        if (url.pathname === '/api/knowledge/items/markdown-layout') return Response.json(item);
        if (url.pathname === '/api/knowledge/graph-configuration') return Response.json({ enabled: false, revision: 1, status: { graph_available: false } });
        if (url.pathname.endsWith('/ai-history')) return Response.json({ messages: [{ role: 'assistant', content }] });
        if (url.pathname.endsWith('/ai-conversations')) return Response.json([]);
        const response = await original(input, init);
        if (url.pathname === '/api/vulnerabilities') {
          const findings = await response.json();
          findings.vulnerabilities.forEach((finding: { description: string }) => { finding.description = content; });
          return Response.json(findings);
        }
        if (url.pathname === '/api/conversations/conv-recon-01') {
          const conversation = await response.json();
          conversation.messages = [{ id: 'markdown-layout', role: 'assistant', content }];
          return Response.json(conversation);
        }
        if (/^\/api\/vulnerabilities\/vuln-[^/]+$/.test(url.pathname)) return Response.json({ ...await response.json(), description: content });
        return response;
      };
    }, markdown);
    await page.evaluate(() => location.hash = 'chat?conversation=conv-recon-01');
    await assertDocument(page, '#chat-messages .message-bubble');
    // Real scroll input detaches Chat's conversation-restore follow mode.
    await page.locator('#chat-messages').hover();
    await page.mouse.wheel(0, -100_000);
    await page.locator('#chat-messages .message-bubble h1').scrollIntoViewIfNeeded();
    await expect(page.locator('#chat-messages .message-bubble h1')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`chat-${width}.png`), animations: 'disabled' });
    await page.locator('#chat-messages .message-bubble pre').scrollIntoViewIfNeeded();
    await expect(page.locator('#chat-messages .message-bubble pre')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`chat-details-${width}.png`), animations: 'disabled' });
    await page.evaluate(() => location.hash = 'knowledge');
    await page.locator('[data-action="knowledge.document"]').filter({ hasText: 'Layout report' }).click();
    await assertDocument(page, '#knowledge-document-modal .kn-prose', false);
    await page.screenshot({ path: testInfo.outputPath(`knowledge-${width}.png`), animations: 'disabled' });
    await page.locator('#knowledge-document-modal .kn-prose pre').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`knowledge-details-${width}.png`), animations: 'disabled' });
    await page.getByRole('button', { name: 'Raw source', exact: true }).click();
    await expect(page.locator('.kn-source-content')).toHaveText(markdown);
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await assertDocument(page, '#knowledge-document-modal .kn-prose', false);
    await page.keyboard.press('Escape');
    await page.evaluate(() => location.hash = 'vulnerabilities');
    await page.locator('.vm-title').first().click();
    await assertDocument(page, '#vm-detail-panel .vm-section:first-child .vm-prose');
    await page.screenshot({ path: testInfo.outputPath(`finding-${width}.png`), animations: 'disabled' });
    await page.locator('#vm-detail-panel .vm-section:first-child .vm-prose pre').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`finding-details-${width}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.evaluate(() => location.hash = 'webshell');
    await page.locator('[data-action="webshell.select"]').first().click();
    await page.locator('[data-action="webshell.tab"][data-tab="ai"]').click();
    await assertDocument(page, '.webshell-ai-msg.assistant');
    const transcript = page.locator('#webshell-ai-messages');
    const transcriptBox = await transcript.boundingBox();
    expect(transcriptBox!.x).toBeGreaterThanOrEqual(0);
    expect(transcriptBox!.x + transcriptBox!.width).toBeLessThanOrEqual(width);
    expect(transcriptBox!.height).toBeGreaterThan(120);
    expect(await page.locator('.webshell-ai-main').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`webshell-${width}.png`), animations: 'disabled' });
    await page.locator('.webshell-ai-msg.assistant pre').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`webshell-details-${width}.png`), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`API description Markdown wraps long references at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/openapi/spec', route => route.fulfill({ json: { paths: {
      '/layout': { get: { description: `# Layout report\n\n${paragraph}\n\n- First observation\n- Second observation\n\n\`${longPath}\`\n\nhttps://example.test/${'path/'.repeat(100)}\n\n\`\`\`text\n${codeLine}\n\`\`\`` } },
    } } }));
    await page.goto('http://127.0.0.1:4174/api-docs');
    await page.locator('.description-toggle-btn').click();
    const description = page.locator('.api-description-detail');
    await expect(description.getByRole('heading', { name: 'Layout report' })).toBeVisible();
    expect(await description.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await description.locator('pre').evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth, overflow: getComputedStyle(el).overflowX, page: document.documentElement.scrollWidth, viewport: innerWidth }))).toMatchObject({ overflow: 'auto', page: width });
    expect(await description.locator('pre').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`api-docs-${width}.png`), animations: 'disabled' });
  });
}
