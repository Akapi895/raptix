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

async function executionLabels(): Promise<{ mock: string[]; real: string[] }> {
  const nav = await import('./nav');
  const labels = (groups: typeof nav.MOCK_PROJECT_NAV) => groups.find(group => group.group === 'OPERATIONS')?.items.map(item => item.label) ?? [];
  return { mock: labels(nav.MOCK_PROJECT_NAV), real: labels(nav.REAL_PROJECT_NAV) };
}

describe('navigation model and the asset map flag', () => {
  it('keeps the Execution group unchanged while the flag is off', async () => {
    const labels = await executionLabels();
    expect(labels.mock).toEqual(['AI Workspace', 'Operations', 'Sessions']);
    expect(labels.real).toEqual(['AI Workspace', 'Operations', 'Sessions']);
  });

  it('lists the asset map beside Execution in both project menus while the flag is on', async () => {
    globalThis.localStorage.setItem('raptix.assetMap', '1');
    const labels = await executionLabels();
    expect(labels.mock).toEqual(['AI Workspace', 'Operations', 'Asset Map', 'Sessions']);
    expect(labels.real).toEqual(['AI Workspace', 'Operations', 'Asset Map', 'Sessions']);
  });
});

describe('global navigation', () => {
  it('lists the seven global pages in proposal order and keeps Reports in the project menus only', async () => {
    const nav = await import('./nav');
    const globalLabels = nav.NAV.flatMap(group => group.items.map(item => item.label));
    expect(globalLabels).toEqual(['Overview', 'Projects', 'Findings', 'Assets', 'Capabilities', 'Infrastructure', 'Settings']);
    for (const groups of [nav.MOCK_PROJECT_NAV, nav.REAL_PROJECT_NAV]) {
      expect(groups.flatMap(group => group.items.map(item => item.label))).toContain('Reports');
    }
  });
});

describe('project section ownership', () => {
  it('keeps resource pages inside the real project menu under their owning section', async () => {
    const nav = await import('./nav');
    const owner = (page: string) => nav.projectSection({ page }, nav.REAL_PROJECT_NAV)?.to;
    expect(owner('report')).toBe('reports');
    expect(owner('report-review')).toBe('reports');
    expect(owner('finding')).toBe('findings');
    expect(owner('asset-scope')).toBe('assets');
    expect(owner('asset-new')).toBe('assets');
    expect(owner('ai-plan-review')).toBe('planning');
    expect(owner('no-such-page')).toBeUndefined();
  });
});
