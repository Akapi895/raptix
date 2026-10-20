import { afterEach, describe, expect, it, vi } from 'vitest';

// The flag is read when the navigation model is built, so each case loads a fresh copy of the module.
// This file has its own module graph, so the reset cannot disturb the shell tests.

afterEach(() => {
  globalThis.localStorage.removeItem('raptix.assetMap');
  vi.resetModules();
});

async function executionLabels(): Promise<{ mock: string[]; real: string[] }> {
  const nav = await import('./nav');
  const labels = (groups: typeof nav.MOCK_PROJECT_NAV) => groups.find(group => group.group === 'EXECUTION')?.items.map(item => item.label) ?? [];
  return { mock: labels(nav.MOCK_PROJECT_NAV), real: labels(nav.REAL_PROJECT_NAV) };
}

describe('navigation model and the asset map flag', () => {
  it('keeps the Execution group unchanged while the flag is off', async () => {
    const labels = await executionLabels();
    expect(labels.mock).toEqual(['AI Workspace', 'Execution', 'C2 Sessions']);
    expect(labels.real).toEqual(['AI Workspace', 'Execution', 'C2 Sessions']);
  });

  it('lists the asset map beside Execution in both project menus while the flag is on', async () => {
    globalThis.localStorage.setItem('raptix.assetMap', '1');
    const labels = await executionLabels();
    expect(labels.mock).toEqual(['AI Workspace', 'Execution', 'Asset Map', 'C2 Sessions']);
    expect(labels.real).toEqual(['AI Workspace', 'Execution', 'Asset Map', 'C2 Sessions']);
  });
});
