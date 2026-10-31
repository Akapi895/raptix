import { describe, expect, it } from 'vitest';
import { routerAction } from './actions';

describe('structured router actions', () => {
  it('recognizes navigation, menus and sidebar controls', () => {
    expect(routerAction('navigate', 'projects')).toEqual({ kind: 'navigate', value: 'projects' });
    expect(routerAction('submenu', 'security')).toEqual({ kind: 'submenu', value: 'security' });
    expect(routerAction('sidebar', '')).toEqual({ kind: 'sidebar' });
    expect(routerAction('conversation-sidebar', '')).toEqual({ kind: 'conversation-sidebar' });
  });
  it('never interprets expressions or other feature handlers', () => {
    for (const value of ['chat?conversation=x', 'chat;evil()', 'getPage()', '']) expect(routerAction('navigate', value)).toBeNull();
    expect(routerAction('unknown', 'chat')).toBeNull();
  });
});
