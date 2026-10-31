// Delegated actions for the markup. An element names what it does in data attributes instead of an inline handler:
//
//   data-act-click='[["switchPage","chat"]]'
//
// The value is a list of calls, run in order. A call is a registered name followed by its arguments.
// Arguments are JSON values, or tokens that are read from the event when it runs:
// "$this" (the element), "$value" (its value), "$checked", "$event", "$file" (its first file).
// Calls whose name starts with "$" are guards and flags: "$stop" and "$prevent" act on the event, "$ifTarget" stops the rest when the
// event target is not the element, "$ifKey" stops the rest unless the key is one of the given keys, "$ifEmpty" stops the rest when the
// element's value is not blank, and "$clickById" clicks another element.

export type ActionFn = (...args: unknown[]) => unknown;

export interface ActionContext {
  element: HTMLElement;
  event: Event;
  /** Whether the user holds a permission; a call that needs a missing one does nothing. */
  permit: (permission: string) => boolean;
}

const EVENT_TYPES = ['click', 'dblclick', 'change', 'input', 'keydown', 'keypress', 'keyup', 'submit', 'dragstart', 'dragenter', 'dragover', 'dragleave', 'drop', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'contextmenu', 'focus', 'blur'] as const;
type ActionEvent = (typeof EVENT_TYPES)[number];

/** Halts the rest of a call list: a guard did not hold. */
const HALT = Symbol('halt');

import { WRITE_PERMISSIONS } from './write-permissions';

const registry = new Map<string, ActionFn>();

/** Registers actions by name. Returns a disposer that removes the names it set. */
export function registerActions(actions: Record<string, ActionFn>): () => void {
  const entries = Object.entries(actions);
  for (const [name, fn] of entries) registry.set(name, fn);
  return () => {
    for (const [name, fn] of entries) {
      if (registry.get(name) === fn) registry.delete(name);
    }
  };
}

export function registeredAction(name: string): ActionFn | undefined {
  return registry.get(name);
}

export type ArgumentAdapter<T> = (value: unknown) => T;

/** Adapts markup's untrusted arguments before calling a typed domain closure. */
export function adaptAction<Args extends unknown[]>(adapters: { [K in keyof Args]: ArgumentAdapter<Args[K]> }, handler: (...args: Args) => unknown): ActionFn {
  return (...values) => {
    if (values.length !== adapters.length) throw new TypeError('Invalid action argument count');
    const args = adapters.map((adapter, index) => adapter(values[index])) as Args;
    return handler(...args);
  };
}

function typedArgument<T>(test: (value: unknown) => value is T, type: string): ArgumentAdapter<T> {
  return value => {
    if (!test(value)) throw new TypeError('Expected action argument: ' + type);
    return value;
  };
}

export const actionArgument = {
  string: typedArgument((value): value is string => typeof value === 'string', 'string'),
  number: typedArgument((value): value is number => typeof value === 'number' && Number.isFinite(value), 'finite number'),
  boolean: typedArgument((value): value is boolean => typeof value === 'boolean', 'boolean'),
  element: typedArgument((value): value is HTMLElement => value instanceof HTMLElement, 'HTMLElement'),
  event: typedArgument((value): value is Event => value instanceof Event, 'Event'),
  file: typedArgument((value): value is File | null => value === null || value instanceof File, 'File or null'),
};

/** Only explicitly registered closures can be called by markup. */
export function actionFor(name: string): ActionFn | undefined {
  return registry.get(name);
}

function tokenValue(token: string, context: ActionContext): unknown {
  const { element, event } = context;
  switch (token) {
    case '$this': return element;
    case '$value': return (element as HTMLInputElement).value;
    case '$checked': return (element as HTMLInputElement).checked;
    case '$event': return event;
    case '$file': return (element as HTMLInputElement).files?.[0] ?? null;
    default: return token;
  }
}

function argument(value: unknown, context: ActionContext): unknown {
  if (typeof value === 'string' && value.startsWith('$')) return tokenValue(value, context);
  return value;
}

/** Runs one call. Returns HALT when a guard stops the rest of the list. */
function runCall(call: unknown[], context: ActionContext): unknown {
  const [name, ...rest] = call as [string, ...unknown[]];
  const { element, event } = context;
  switch (name) {
    case '$stop':
      event.stopPropagation();
      return undefined;
    case '$prevent':
      event.preventDefault();
      return undefined;
    case '$ifTarget':
      return event.target === element ? undefined : HALT;
    case '$ifKey': {
      const key = (event as KeyboardEvent).key;
      return rest.includes(key) ? undefined : HALT;
    }
    case '$ifEmpty':
      return String((element as HTMLInputElement).value ?? '').trim() === '' ? undefined : HALT;
    case '$clickById':
      context.element.ownerDocument.getElementById(String(rest[0]))?.click();
      return undefined;
    default: {
      const permission = WRITE_PERMISSIONS[name];
      if (permission && !context.permit(permission)) return undefined;
      const fn = actionFor(name);
      if (!fn) {
        console.warn('[inline-action] no action named', name);
        return undefined;
      }
      return fn(...rest.map(value => argument(value, context)));
    }
  }
}

/** Runs a call list. A failed call is reported and the next call still runs, as separate statements in an inline handler would. */
export function runActionCalls(calls: readonly unknown[], context: ActionContext): void {
  for (const call of calls) {
    if (!Array.isArray(call) || typeof call[0] !== 'string' || call.length === 0) {
      console.error('[inline-action] invalid call', call);
      continue;
    }
    try {
      const result = runCall(call, context);
      if (result === HALT) return;
      if (result instanceof Promise) {
        result.catch(error => console.error('[inline-action] failed', call[0], error));
      }
    } catch (error) {
      console.error('[inline-action] failed', call[0], error);
    }
  }
}

function parseCalls(raw: string): unknown[][] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(call => Array.isArray(call) && typeof call[0] === 'string')) throw new TypeError('Expected action call list');
  return parsed as unknown[][];
}

/** Installs the delegated listeners. Returns a disposer. */
export function installInlineActions(doc: Document, permit: (permission: string) => boolean): () => void {
  const controller = new AbortController();
  for (const type of EVENT_TYPES) {
    const attr = 'data-act-' + type;
    const capture = type === 'mouseenter' || type === 'mouseleave' || type === 'focus' || type === 'blur';
    doc.addEventListener(type, event => {
      const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
      let element = capture ? (target?.hasAttribute(attr) ? target as HTMLElement : null) : target?.closest<HTMLElement>('[' + attr + ']');
      while (element) {
        if (element.matches(':disabled,[aria-disabled="true"]')) return;
        const raw = element.getAttribute(attr);
        if (raw) {
          try {
            runActionCalls(parseCalls(raw), { element, event, permit });
          } catch (error) {
            console.error('[inline-action] invalid data-act value', raw, error);
          }
        }
        if (capture || event.cancelBubble) return;
        element = element.parentElement?.closest<HTMLElement>('[' + attr + ']');
      }
    }, { signal: controller.signal, capture });
  }
  return () => controller.abort();
}

export type InlineActionEvent = ActionEvent;
