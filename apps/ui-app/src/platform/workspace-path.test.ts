import { describe, expect, it } from 'vitest';
import { createWorkspacePath } from './workspace-path';

function fakeWindow(pathname: string, hash = ''): Window {
  const location = { pathname, hash };
  const history = { state: null as unknown, replaceState: (state: unknown, _title: string, url: string) => {
    history.state = state;
    const [path, rest] = url.split('#');
    location.pathname = path || '/';
    location.hash = rest ? '#' + rest : '';
  } };
  return { location, history } as unknown as Window;
}

describe('workspace path boundary', () => {
  it('reads the single path segment as the active project id', () => {
    expect(createWorkspacePath(fakeWindow('/')).read()).toBe('');
    expect(createWorkspacePath(fakeWindow('/proj-123')).read()).toBe('proj-123');
    expect(createWorkspacePath(fakeWindow('/proj-123/')).read()).toBe('proj-123');
    expect(createWorkspacePath(fakeWindow('/proj-123/extra')).read()).toBe('');
    expect(createWorkspacePath(fakeWindow('/a%20b/')).read()).toBe('a b');
  });

  it('writes the id as a path segment while preserving the current hash', () => {
    const win = fakeWindow('/', '#dashboard');
    const path = createWorkspacePath(win);
    path.write('proj-123');
    expect(win.location.pathname).toBe('/proj-123/');
    expect(win.location.hash).toBe('#dashboard');
    path.write('');
    expect(win.location.pathname).toBe('/');
    expect(win.location.hash).toBe('#dashboard');
  });

  it('is a no-op when the id already matches the path, and survives a denied history API', () => {
    const win = fakeWindow('/proj-123/', '#dashboard');
    let calls = 0;
    const original = win.history.replaceState.bind(win.history);
    win.history.replaceState = (...args) => { calls++; return original(...args); };
    createWorkspacePath(win).write('proj-123');
    expect(calls).toBe(0);
    const denied = fakeWindow('/');
    denied.history.replaceState = () => { throw new DOMException('Denied', 'SecurityError'); };
    expect(() => createWorkspacePath(denied).write('proj-456')).not.toThrow();
  });

  it('falls back to empty/no-op outside a browser environment', () => {
    const path = createWorkspacePath(undefined);
    expect(path.read()).toBe('');
    expect(() => path.write('proj-123')).not.toThrow();
  });
});
