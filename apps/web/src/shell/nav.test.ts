import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The flag is read when the navigation model is built, so each case loads a fresh copy of the module.
// This file has its own module graph, so the reset cannot disturb the shell tests.

// The first import loads the navigation graph; keep that cold start out of the test timer.
beforeAll(async () => {
  await import('./nav');
}, 30_000);

afterEach(() => {
  globalThis.localStorage.removeItem('raptix.assetMap');
  vi.resetModules();
});

async function executionLabels(): Promise<string[]> {
  const nav = await import('./nav');
  return nav.PROJECT_NAV.find(group => group.group === 'OPERATIONS')?.items.map(item => item.label) ?? [];
}

describe('navigation model and the asset map flag', () => {
  it('keeps the Execution group unchanged while the flag is off', async () => {
    expect(await executionLabels()).toEqual(['AI Workspace', 'Operations', 'C2 Sessions']);
  });

  it('lists the asset map beside Execution in the project menu while the flag is on', async () => {
    globalThis.localStorage.setItem('raptix.assetMap', '1');
    expect(await executionLabels()).toEqual(['AI Workspace', 'Operations', 'Asset Map', 'C2 Sessions']);
  });
});

describe('global navigation', () => {
  it('lists the seven global pages in proposal order and keeps Reports in the project menu only', async () => {
    const nav = await import('./nav');
    const globalLabels = nav.NAV.flatMap(group => group.items.map(item => item.label));
    expect(globalLabels).toEqual(['Overview', 'Projects', 'Findings', 'Assets', 'Capabilities', 'Infrastructure', 'Settings']);
    expect(nav.PROJECT_NAV.flatMap(group => group.items.map(item => item.label))).toContain('Reports');
  });
});

describe('project section ownership', () => {
  it('keeps resource pages inside the project menu under their owning section', async () => {
    const nav = await import('./nav');
    const owner = (page: string) => nav.projectSection({ page }, nav.PROJECT_NAV)?.to;
    expect(owner('report')).toBe('reports');
    expect(owner('report-review')).toBe('reports');
    expect(owner('finding')).toBe('findings');
    expect(owner('asset-scope')).toBe('assets');
    expect(owner('asset-new')).toBe('assets');
    expect(owner('ai-plan-review')).toBe('planning');
    expect(owner('no-such-page')).toBeUndefined();
  });
});
