import { describe, expect, it } from 'vitest';
import { createRouter, pageIds, parseRoute, routeHash, type Navigation, type RouterPort } from './service';

function fixture(hash = '', canActivate?: RouterPort['canActivate']) {
  const writes: string[] = [];
  const events: Navigation[] = [];
  const callbacks = new Set<() => void>();
  const router = createRouter({
    readHash: () => hash,
    replaceHash(value) { hash = '#' + value; writes.push(hash); },
    onHash(listener) { callbacks.add(listener); return () => { callbacks.delete(listener); }; },
    ...(canActivate ? { canActivate } : {}),
  });
  router.subscribe(event => events.push(event));
  return { router, writes, events, external(value: string) { hash = value; callbacks.forEach(callback => callback()); }, silent(value: string) { hash = value; }, hash: () => hash, callbacks };
}

describe('typed router', () => {
  it('parses every legacy page, aliases, slash hashes and query values containing ?', () => {
    const aliases: Record<string, string> = { 'asset-overview': 'asset-library', tasks: 'workflows', 'c2-tasks': 'c2-activity', 'c2-events': 'c2-activity', 'c2-profiles': 'c2-listeners' };
    for (const page of pageIds) expect(parseRoute('#/' + page)?.page).toBe(aliases[page] || page);
    expect(routeHash(parseRoute('#c2-events?session=s_1')!)).toBe('c2-activity?session=s_1&tab=events');
    expect(routeHash(parseRoute('#c2-profiles')!)).toBe('c2-listeners?tab=profiles');
    expect(routeHash(parseRoute('#tasks?queue=q1')!)).toBe('workflows?queue=q1&tab=schedule');
    expect(parseRoute('#asset-overview?project=p1')).toEqual({ page: 'asset-library', query: new URLSearchParams('project=p1') });
    expect(parseRoute('#discover-assets')?.page).toBe('info-collect');
    expect(parseRoute('#c2')?.page).toBe('c2-listeners');
    expect(parseRoute('#/agents-management')?.page).toBe('roles-management');
    expect(parseRoute('#/operation-center')?.page).toBe('projects');
    expect(routeHash(parseRoute('#projects?project=p1')!)).toBe('operation-center?project=p1');
    expect(routeHash(parseRoute('#operation-center?project=p1')!)).toBe('operation-center?project=p1');
    expect(routeHash(parseRoute('#system-update')!)).toBe('settings?section=update');
    expect(parseRoute('#chat?conversation=a%2Fb&project=x?y')?.query.get('project')).toBe('x?y');
    expect(parseRoute('#unknown')).toBeNull();
  });
  it('starts once with a canonical default and ignores invalid external routes', () => {
    const f = fixture('#invalid');
    f.router.start(); f.router.start(); f.external('#bad');
    expect(f.router.page()).toBe('dashboard');
    expect(f.events).toHaveLength(1);
    expect(f.writes).toEqual(['#dashboard']);
    expect(f.callbacks.size).toBe(1);
    f.router.dispose(); expect(f.callbacks.size).toBe(0);
  });
  it('emits replaceState navigation exactly once, including same-page query navigation', () => {
    const f = fixture('#chat?conversation=a'); f.router.start();
    f.router.go('chat');
    f.router.navigate('chat?conversation=b');
    f.external('#chat?conversation=b');
    expect(f.events).toHaveLength(2);
    expect(f.events[1]).toMatchObject({ kind: 'replace', pageChanged: false, restore: true });
    expect(f.writes).toEqual(['#chat?conversation=b']);
    f.router.replaceQuery({ conversation: 'c' });
    expect(f.events[2]?.restore).toBe(false);
    expect(f.router.current()?.query.get('conversation')).toBe('c');
  });
  it('preserves feature-owned location queries only on chat, vulnerabilities and settings', () => {
    for (const page of ['chat', 'vulnerabilities', 'settings']) {
      const f = fixture('#' + page); f.router.start();
      f.silent('#' + page + '?filter=changed'); f.router.go(page);
      expect(f.router.current()?.query.get('filter')).toBe('changed');
    }
    const f = fixture('#dashboard?discard=yes'); f.router.start(); f.router.go('dashboard');
    expect(f.hash()).toBe('#dashboard');
    f.router.go('chat'); expect(f.hash()).toBe('#chat');
  });
  it('canonicalizes alias hashchanges without a second navigation and rejects absent pages', () => {
    const f = fixture('#c2-listeners', page => page !== 'workflows'); f.router.start();
    f.external('#/c2'); f.router.go('tasks');
    expect(f.hash()).toBe('#c2-listeners'); expect(f.events).toHaveLength(1);
    f.external('#/projects?project=p1');
    expect(f.hash()).toBe('#operation-center?project=p1');
    expect(f.router.page()).toBe('projects');
    const eventCount = f.events.length;
    f.external('#/operation-center?project=p1');
    expect(f.hash()).toBe('#operation-center?project=p1');
    expect(f.events).toHaveLength(eventCount);
    f.router.go('projects');
    expect(f.hash()).toBe('#operation-center');
  });
  it('redirects old agent bookmarks to the existing configuration page once', () => {
    const f = fixture('#agents-management'); f.router.start();
    expect(f.hash()).toBe('#roles-management');
    expect(f.events).toHaveLength(1);
    expect(f.router.page()).toBe('roles-management');
    f.external('#/agents-management');
    expect(f.hash()).toBe('#roles-management');
    expect(f.events).toHaveLength(1);
    expect(pageIds).not.toContain('agents-management');
  });
  it('does not expose mutable query state', () => {
    const f = fixture('#settings?section=token-usage'); f.router.start();
    f.router.current()?.query.delete('section');
    f.events[0]?.route.query.delete('section');
    expect(f.router.current()?.query.get('section')).toBe('token-usage');
  });
  it('redirects retired platform access links to Dashboard without carrying management queries', () => {
    for (const hash of ['#platform-rbac', '#/platform-rbac?user=old', '#settings?section=rbac']) {
      const f = fixture(hash); f.router.start();
      expect(f.hash()).toBe('#dashboard');
      expect(f.router.page()).toBe('dashboard');
      f.router.go('chat'); f.external(hash);
      expect(f.hash()).toBe('#dashboard');
      f.router.go('chat'); f.router.go('platform-rbac');
      expect(f.hash()).toBe('#dashboard');
    }
    expect(pageIds).not.toContain('platform-rbac');
  });
});
