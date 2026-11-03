import { describe, expect, it, vi } from 'vitest';
import { actionArgument, actionFor, adaptAction, installInlineActions, registerActions, runActionCalls, type ActionContext } from './inline-actions';

function fakeContext(overrides: Partial<{ key: string; target: unknown; value: string }> = {}) {
  const element = { value: overrides.value ?? '' } as unknown as HTMLElement;
  const event = {
    key: overrides.key,
    target: overrides.target ?? element,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as Event;
  const context: ActionContext = { element, event, permit: () => true };
  return { context, element, event };
}

describe('inline action calls', () => {
  it('runs registered actions in order with their literal arguments', () => {
    const calls: unknown[][] = [];
    const dispose = registerActions({
      'test.first': (...args) => calls.push(['first', ...args]),
      'test.second': (...args) => calls.push(['second', ...args]),
    });
    const { context } = fakeContext();
    runActionCalls([['test.first', 'chat', 1], ['test.second', true]], context);
    expect(calls).toEqual([['first', 'chat', 1], ['second', true]]);
    dispose();
  });

  it('halts the rest of the list when a guard does not hold', () => {
    const run = vi.fn();
    const dispose = registerActions({ 'test.guarded': run });
    const { context } = fakeContext({ key: 'a' });
    runActionCalls([['$ifKey', 'Enter'], ['test.guarded']], context);
    expect(run).not.toHaveBeenCalled();
    dispose();
  });

  it('prevents the default and runs the action when the key matches', () => {
    const run = vi.fn();
    const dispose = registerActions({ 'test.open': run });
    const { context, event } = fakeContext({ key: ' ' });
    runActionCalls([['$ifKey', 'Enter', ' '], ['$prevent'], ['test.open', 'vulnerabilities']], context);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('vulnerabilities');
    dispose();
  });

  it('runs only when the event target is the element itself', () => {
    const run = vi.fn();
    const dispose = registerActions({ 'test.close': run });
    const inside = fakeContext({ target: {} });
    runActionCalls([['$ifTarget'], ['test.close']], inside.context);
    expect(run).not.toHaveBeenCalled();
    const backdrop = fakeContext();
    runActionCalls([['$ifTarget'], ['test.close']], backdrop.context);
    expect(run).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('passes element tokens through to the action', () => {
    const run = vi.fn();
    const dispose = registerActions({ 'test.value': run });
    const { context, element } = fakeContext({ value: 'needle' });
    runActionCalls([['test.value', '$value', '$this']], context);
    expect(run).toHaveBeenCalledWith('needle', element);
    dispose();
  });

  it('stops only the rest of a guarded list, not the next call list', () => {
    const run = vi.fn();
    const dispose = registerActions({ 'test.next': run });
    const { context } = fakeContext({ value: 'x' });
    runActionCalls([['$ifEmpty'], ['test.next']], context);
    expect(run).not.toHaveBeenCalled();
    runActionCalls([['test.next']], context);
    expect(run).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('keeps running later calls when one of them throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const later = vi.fn();
    const dispose = registerActions({
      'test.broken': () => { throw new Error('boom'); },
      'test.later': later,
    });
    runActionCalls([['test.broken'], ['test.later']], fakeContext().context);
    expect(later).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    dispose();
  });

  it('enforces write permissions before looking up or invoking a registered action', () => {
    const save = vi.fn(), read = vi.fn();
    const dispose = registerActions({ saveSkill: save, 'test.read': read });
    const { context } = fakeContext();
    const permit = vi.fn(() => false);
    runActionCalls([['saveSkill'], ['test.read']], { ...context, permit });
    expect(permit).toHaveBeenCalledWith('skills:write');
    expect(save).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
    runActionCalls([['saveSkill']], context);
    expect(save).toHaveBeenCalledOnce();
    dispose();
  });

  it('resolves only explicitly registered names, including dotted names', () => {
    const globalFunction = vi.fn();
    vi.stubGlobal('window', { C2: { loadSessions: globalFunction } });
    try {
      expect(actionFor('C2.loadSessions')).toBeUndefined();
      expect(globalFunction).not.toHaveBeenCalled();
      const closure = vi.fn();
      const dispose = registerActions({ 'C2.loadSessions': closure });
      runActionCalls([['C2.loadSessions']], fakeContext().context);
      expect(closure).toHaveBeenCalledOnce();
      expect(globalFunction).not.toHaveBeenCalled();
      dispose();
      expect(actionFor('C2.loadSessions')).toBeUndefined();
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps a newer registration when an older disposer runs', () => {
    const first = vi.fn(), second = vi.fn();
    const disposeFirst = registerActions({ 'test.replace': first });
    const disposeSecond = registerActions({ 'test.replace': second });
    disposeFirst();
    runActionCalls([['test.replace']], fakeContext().context);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    disposeSecond();
    expect(actionFor('test.replace')).toBeUndefined();
  });

  it('validates typed argument adapters before invoking the domain closure', () => {
    const domain = vi.fn((name: string, count: number, enabled: boolean) => ({ name, count, enabled }));
    const action = adaptAction([actionArgument.string, actionArgument.number, actionArgument.boolean], domain);
    expect(action('test', 3, true)).toEqual({ name: 'test', count: 3, enabled: true });
    expect(() => action(3, 'test', true)).toThrow(TypeError);
    expect(() => action('test', Infinity, true)).toThrow(TypeError);
    expect(() => action('test', 3)).toThrow(TypeError);
    expect(domain).toHaveBeenCalledOnce();
  });

  it('reports malformed calls without invoking them or losing later valid calls', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn();
    const dispose = registerActions({ 'test.valid': run });
    runActionCalls([null, 3, [], ['test.valid']], fakeContext().context);
    expect(error).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledOnce();
    dispose(); error.mockRestore();
  });

  it('passes checked, event and first-file tokens without coercion', () => {
    const run = vi.fn(), file = { name: 'report.txt' };
    const dispose = registerActions({ 'test.tokens': run });
    const { context, element, event } = fakeContext();
    Object.assign(element, { checked: true, files: [file] });
    runActionCalls([['test.tokens', '$checked', '$event', '$file']], context);
    expect(run).toHaveBeenCalledWith(true, event, file);
    dispose();
  });
});

/** Small event port: exercises installed delegation without a browser/server. */
function delegatedFixture() {
  class ElementPort {
    parentElement: ElementPort | null = null;
    attributes = new Map<string, string>();
    hasAttribute(name: string) { return this.attributes.has(name); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    matches(selector: string) { return selector.includes(':disabled') && this.attributes.has('disabled'); }
    closest(selector: string): ElementPort | null {
      const attribute = selector.slice(1, -1);
      return this.hasAttribute(attribute) ? this : this.parentElement?.closest(selector) ?? null;
    }
  }
  const listeners = new Map<string, { listener: EventListener; capture: boolean }>();
  const doc = {
    addEventListener(type: string, listener: EventListener, options: AddEventListenerOptions) {
      listeners.set(type, { listener, capture: !!options.capture });
      options.signal?.addEventListener('abort', () => listeners.delete(type));
    },
  } as unknown as Document;
  vi.stubGlobal('Element', ElementPort);
  vi.stubGlobal('HTMLElement', ElementPort);
  const parent = new ElementPort(), child = new ElementPort(); child.parentElement = parent;
  const dispose = installInlineActions(doc, () => true);
  const fire = (type: string, target = child) => {
    const event = new Event(type, { bubbles: false, cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    listeners.get(type)?.listener(event);
    return event;
  };
  return { parent, child, fire, listeners, dispose: () => { dispose(); vi.unstubAllGlobals(); } };
}

describe('delegated markup events', () => {
  it('runs nested action lists in bubbling order, preserving stop/default flags', () => {
    const fixture = delegatedFixture(), called: string[] = [];
    const dispose = registerActions({ child: () => called.push('child'), parent: () => called.push('parent') });
    try {
      fixture.child.attributes.set('data-act-click', '[["child"],["$prevent"]]');
      fixture.parent.attributes.set('data-act-click', '[["parent"]]');
      expect(fixture.fire('click').defaultPrevented).toBe(true);
      expect(called).toEqual(['child', 'parent']);
      called.length = 0;
      fixture.child.attributes.set('data-act-click', '[["$stop"],["child"]]');
      fixture.fire('click');
      expect(called).toEqual(['child']);
    } finally { dispose(); fixture.dispose(); }
  });

  it('captures non-bubbling enter/leave events only on their actual target', () => {
    const fixture = delegatedFixture(), enter = vi.fn(), leave = vi.fn(), menu = vi.fn();
    const dispose = registerActions({ enter, leave, menu });
    try {
      fixture.parent.attributes.set('data-act-mouseenter', '[["enter"]]');
      fixture.parent.attributes.set('data-act-mouseleave', '[["leave"]]');
      fixture.child.attributes.set('data-act-contextmenu', '[["$prevent"],["menu","$event"]]');
      expect(fixture.listeners.get('mouseenter')?.capture).toBe(true);
      fixture.fire('mouseenter'); expect(enter).not.toHaveBeenCalled();
      fixture.fire('mouseenter', fixture.parent); expect(enter).toHaveBeenCalledOnce();
      fixture.fire('mouseleave', fixture.parent); expect(leave).toHaveBeenCalledOnce();
      const event = fixture.fire('contextmenu');
      expect(event.defaultPrevented).toBe(true); expect(menu).toHaveBeenCalledWith(event);
    } finally { dispose(); fixture.dispose(); }
  });

  it('ignores disabled controls and removes every listener on disposal', () => {
    const fixture = delegatedFixture(), run = vi.fn();
    const dispose = registerActions({ run });
    try {
      fixture.child.attributes.set('data-act-click', '[["run"]]');
      fixture.child.attributes.set('disabled', '');
      fixture.fire('click'); expect(run).not.toHaveBeenCalled();
      fixture.child.attributes.delete('disabled');
      fixture.fire('click'); expect(run).toHaveBeenCalledOnce();
      fixture.dispose(); expect(fixture.listeners.size).toBe(0);
    } finally { dispose(); fixture.dispose(); }
  });
});
