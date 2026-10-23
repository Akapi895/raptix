// Read-only audit of the deployed UI. Inventory coverage is not functional verification.
// Usage: node apps/web/tools/verify/deployed-checklist.mjs --app http://127.0.0.1:3001 --out <directory> [--groups G-01,G-07]
// Authentication: RAPTIX_VERIFY_USER / RAPTIX_VERIFY_PASSWORD. No run or business mutation is submitted.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { contrast } from './contrast.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const app = arg('--app', 'http://127.0.0.1:3001').replace(/\/$/, '');
const onlyGroups = arg('--groups', null)?.split(',') ?? null;
const checklistPath = path.resolve(root, arg('--checklist', 'docs/web-ui-completion-checklist-2026-10-22.md'));
const markdown = readFileSync(checklistPath, 'utf8');
const out = path.resolve(arg('--out', path.join(root, 'tests/local/artifacts', `deployed-ui-${Date.now()}`)));
mkdirSync(out, { recursive: true });
const hash = (text) => createHash('sha256').update(text).digest('hex');
const groups = new Map();
const criteria = [];
let section = null;
for (const [offset, line] of markdown.split('\n').entries()) {
  const table = line.match(/^\| ((?:G|J|X|D)-\d{2})(?:\s|\s*\|)/);
  const journey = line.match(/^### (U-\d{2})\.\s*(.+)/);
  if (table || journey) {
    const id = (table ?? journey)[1];
    if (!groups.has(id)) groups.set(id, { id, line: offset + 1, requirement: line, status: id.startsWith('D-') ? 'decision-required' : 'unverified', observations: [] });
  }
  if (/^## /.test(line)) section = null;
  if (/^### 3\.1\./.test(line)) section = 'G-01';
  if (/^### 3\.2\./.test(line)) section = 'G-07';
  if (/^## 7\./.test(line)) section = 'DOC';
  if (/^### 9\.2\./.test(line)) section = 'GATE';
  if (journey) section = journey[1];
  const checkbox = line.match(/^- \[([ xX])\] (.+)/);
  if (checkbox) {
    const group = section ?? 'OTHER';
    const number = criteria.filter((item) => item.group === group).length + 1;
    criteria.push({ id: `${group}.C${String(number).padStart(2, '0')}`, group, line: offset + 1, requirement: checkbox[2], fingerprint: hash(checkbox[2]), authoredChecked: checkbox[1] !== ' ', status: 'unverified', evidence: null });
  }
}
const report = {
  generatedAt: new Date().toISOString(), app,
  checklist: { path: path.relative(root, checklistPath), sha256: hash(markdown) },
  scope: 'Read-only deployed UI inspection; render probes do not certify functional checklist groups.',
  selectedGroups: onlyGroups,
  deployment: {}, probes: [], issues: [], groups: [], criteria,
  notExecuted: ['business mutations and independent review', 'live planning/execution/stream recovery', 'live tool/subagent/provider operations', 'complete keyboard/contrast matrix', 'product decisions D-01 through D-09'],
};
function issue(id, group, detail) {
  report.issues.push({ id, group, detail });
  const entry = groups.get(group);
  if (entry && entry.status !== 'decision-required') { entry.status = 'partial'; entry.observations.push(id); }
}
function criterion(prefix, status, evidence) {
  for (const item of criteria) if (item.requirement.startsWith(prefix)) { item.status = status; item.evidence = evidence; }
}
let browser;
try {
  const response = await fetch(app, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(`Entry HTTP ${response.status}`);
  const html = await response.text();
  const entry = html.match(/src="([^\"]+\.js)"/)?.[1];
  report.deployment.entryScript = entry ?? null;
  if (entry) {
    const bundle = await fetch(new URL(entry, app), { signal: AbortSignal.timeout(10000) });
    if (!bundle.ok) throw Error(`Entry script HTTP ${bundle.status}`);
    report.deployment.entrySha256 = hash(await bundle.text());
  }
  const capabilityResponse = await fetch(`${app}/api/capabilities`, { signal: AbortSignal.timeout(10000) });
  if (!capabilityResponse.ok) throw Error(`Capabilities HTTP ${capabilityResponse.status}`);
  const capabilities = await capabilityResponse.json();
  report.deployment.deploymentId = capabilities.deploymentId;
  report.deployment.mode = capabilities.mode;
  report.deployment.capabilities = capabilities.capabilities;
  browser = await chromium.launch({ headless: true, executablePath: process.env.RAPTIX_VERIFY_CHROMIUM || undefined });
  const context = await browser.newContext({ viewport: { width: 1360, height: 960 } });
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || pathname === '/api/auth/login') return route.continue();
    report.probes.push({ id: 'read-only-blocked-mutation', method: request.method(), path: pathname });
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${app}/?dataMode=real#/projects`, { waitUntil: 'domcontentloaded' });
  if (capabilities.mode === 'multi-user') {
    if (!process.env.RAPTIX_VERIFY_USER || !process.env.RAPTIX_VERIFY_PASSWORD) throw Error('Set RAPTIX_VERIFY_USER and RAPTIX_VERIFY_PASSWORD for this deployment');
    await page.locator('#login-username').fill(process.env.RAPTIX_VERIFY_USER);
    await page.locator('#login-password').fill(process.env.RAPTIX_VERIFY_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('#login-username').waitFor({ state: 'detached' });
  }
  for (const endpoint of ['/api/overview/findings', '/api/overview/operations', '/api/tasks']) {
    const response = await page.request.get(`${app}${endpoint}`);
    report.probes.push({ id: 'authenticated-section-read', path: endpoint, status: response.status() });
  }
  const projectResponse = await page.request.get(`${app}/api/engagements`);
  if (!projectResponse.ok()) throw Error(`Projects HTTP ${projectResponse.status()}`);
  const projects = await projectResponse.json();
  const project = arg('--project', projects[0]?.id);
  report.deployment.sampleProject = project ?? null;
  const pages = [['G-01', 'overview'], ['G-02', 'projects'], ['G-03', 'findings'], ['G-04', 'assets'], ['G-05', 'playbooks'], ['G-06', 'infrastructure'], ['G-07', 'settings']];
  const tabs = [['J-01', 'overview'], ['J-02', 'scope'], ['J-04', 'planning'], ['J-05', 'ai-workspace'], ['J-06', 'operations'], ['J-08', 'fleet'], ['J-09', 'c2'], ['J-10', 'findings'], ['J-11', 'evidence'], ['J-12', 'analysis'], ['J-13', 'reports'], ['J-14', 'team'], ['J-15', 'audit'], ['J-16', 'vault'], ['J-17', 'governance'], ['J-18', 'settings'], ['J-19', 'close']];
  if (project) pages.push(...tabs.map(([id, tab]) => [id, `project/${encodeURIComponent(project)}?tab=${tab}`]));
  for (const [id, route] of pages.filter(([id]) => !onlyGroups || onlyGroups.includes(id))) {
    const errors = [];
    const onError = (error) => errors.push(error.name);
    page.on('pageerror', onError);
    try {
      await page.goto(`${app}/?dataMode=real#/${route}`, { waitUntil: 'domcontentloaded' });
      await page.locator('main').first().waitFor();
      await page.locator('main h1').first().waitFor();
      await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
      const heading = await page.locator('main h1').first().innerText();
      const body = await page.locator('main').first().innerText();
      const boundary = body.includes('This screen failed to render');
      const probe = { id: `${id}.render`, route, render: heading.trim().length > 0 && !boundary && errors.length === 0, pageErrors: errors, heading };
      report.probes.push(probe);
      groups.get(id).observations.push(probe.id);
      if (!probe.render) issue(`${id}.render-failure`, id, 'Render boundary or browser exception; not accepted as config-gated.');
      if (id === 'G-01') {
        const missing = ['System health', 'Recent activity', 'Active operations'].filter((label) => !body.toLowerCase().includes(label.toLowerCase()));
        if (missing.length) issue('overview-content', id, `Missing proposed sections: ${missing.join(', ')}.`);
        const scopedKpis = await page.locator('main button').filter({ hasText: /Active agent instances|Active sessions/ }).allTextContents();
        if (scopedKpis.some((text) => text.includes('Per project'))) issue('overview-live-kpis', id, 'Agent/session KPI cards still say Per project rather than presenting the required aggregate metrics.');
      }
      if (id === 'G-03' && body.includes('A cross-project finding list is not integrated')) issue('global-findings', id, 'Count rollup and project links are not the required cross-project inventory.');
      if (id === 'G-04' && body.includes('Select an engagement')) issue('global-assets', id, 'Global asset inventory requires selecting one engagement.');
      if (id === 'G-05' && body.includes('Skill library')) issue('library-parity', id, 'Skill corpus is present; Playbook/Profile builder and Knowledge parity are not certified by this route.');
      if (id === 'G-06' && body.includes('not integrated')) issue('global-infrastructure', id, 'Global fleet/C2/session inventory states it is not integrated.');
      if (id === 'G-07' && /Acme Security \(Demo\)|This is a simulation|RT-2026-014/.test(body)) {
        issue('real-settings-demo', id, 'Real-mode Settings contains demo organization/project copy.');
        issue('demo-copy-authority', 'X-06', 'Real-mode presentation includes demo facts.');
        criterion('Real header/banner không còn', 'fail', 'real-settings-demo');
      }
      if (id === 'G-07' && !await page.getByRole('tab', { name: /AI.*model|AI.*mô hình/i }).count()) issue('ai-model-settings', id, 'AI/model configuration tab is not offered in real Settings.');
      if (id === 'G-07' && capabilities.mode === 'multi-user' && body.includes('local-single-user')) issue('trusted-identity-mismatch', id, 'Settings displays a local-single-user identity while this deployment is multi-user.');
      if (id === 'J-09' && !capabilities.capabilities?.c2?.available) {
        groups.get(id).status = 'config-gated';
        groups.get(id).observations.push('capabilities.c2.available=false');
      }
      if (id === 'G-01' || id === 'G-07') {
        await page.screenshot({ path: path.join(out, `${id}-real.png`), fullPage: true });
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        const tokens = await page.evaluate(() => {
          const style = getComputedStyle(document.documentElement);
          return Object.fromEntries(['--c-accent', '--c-bad', '--c-panel', '--c-primary', '--c-primary-fg', '--c-danger-fill', '--c-link'].map((key) => [key, style.getPropertyValue(key).trim()]));
        });
        const ratios = {
          primaryLabel: contrast(tokens['--c-primary-fg'] || '#FFFFFF', tokens['--c-primary'] || tokens['--c-accent']),
          dangerWhite: contrast('#FFFFFF', tokens['--c-danger-fill'] || tokens['--c-bad']),
          linkOnPanel: contrast(tokens['--c-link'] || tokens['--c-accent'], tokens['--c-panel']),
          accentOnPanel: contrast(tokens['--c-accent'], tokens['--c-panel']),
        };
        report.probes.push({ id: `${id}.dark-tokens`, tokens, ratios, scope: 'deployed semantic fill/text token combinations; not a complete rendered-state accessibility audit' });
        if (Object.values(ratios).some((ratio) => ratio < 4.5)) issue(`${id}.contrast`, 'X-03', 'Deployed dark token combinations for normal text fall below 4.5:1.');
        await page.evaluate(() => document.documentElement.classList.remove('dark'));
      }
      console.log(`${probe.render ? 'RENDERED' : 'FAIL'} ${id}; functional checklist remains unverified unless evidence explicitly maps a criterion.`);
    } catch (error) {
      report.probes.push({ id: `${id}.render`, route, render: false, error: error.name });
      issue(`${id}.probe-failed`, id, `Read-only probe failed (${error.name}); see the route and deployment.`);
    } finally {
      page.off('pageerror', onError);
    }
  }
} catch (error) {
  report.fatal = error.message.replaceAll(process.env.RAPTIX_VERIFY_PASSWORD ?? '\u0000', '<REDACTED>');
} finally {
  if (browser) await browser.close();
  report.groups = [...groups.values()];
  report.summary = { groups: report.groups.length, criteria: criteria.length, probes: report.probes.length, issues: report.issues.length, unverifiedCriteria: criteria.filter((item) => item.status === 'unverified').length, verdict: 'NOT CERTIFIED: read-only probes do not complete the checklist' };
  writeFileSync(path.join(out, 'audit.json'), JSON.stringify(report, null, 2));
  const summary = ['# Deployed UI checklist audit', '', `App: ${app}`, `Checklist SHA-256: ${report.checklist.sha256}`, '', report.summary.verdict, '', `Groups: ${report.summary.groups}; criteria: ${report.summary.criteria}; probes: ${report.summary.probes}; issues: ${report.summary.issues}; unverified criteria: ${report.summary.unverifiedCriteria}.`, '', '## Findings', '', ...report.issues.map((item) => `- **${item.group} / ${item.id}:** ${item.detail}`), '', '## Group coverage', '', '| ID | Status | Observations |', '|---|---|---|', ...report.groups.map((item) => `| ${item.id} | ${item.status} | ${item.observations.join(', ')} |`), '', '## Not executed', '', ...report.notExecuted.map((item) => `- ${item}`), '', report.fatal ? `Fatal: ${report.fatal}` : 'Detailed checkbox coverage: audit.json.'];
  writeFileSync(path.join(out, 'audit.md'), summary.join('\n'));
  console.log(JSON.stringify(report.summary));
  console.log(`Evidence: ${out}`);
}
process.exitCode = report.fatal || report.issues.length || report.summary.unverifiedCriteria ? 1 : 0;
