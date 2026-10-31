import { describe, expect, it } from 'vitest';
import { elementAllowed, hasAnyPermission, pagePermission } from './permissions';

const granted = new Set(['chat:read', 'c2:read']);
const has = (permission: string) => granted.has(permission);

/** Minimal attribute source; the rules only read attributes, so no DOM is needed. */
function element(attributes: Record<string, string>) {
  return { getAttribute: (name: string) => attributes[name] ?? null };
}

describe('permission rules', () => {
  it('treats an empty requirement as allowed', () => {
    expect(hasAnyPermission(has, [])).toBe(true);
  });

  it('allows when any listed permission is granted', () => {
    expect(hasAnyPermission(has, ['rbac:write', 'chat:read'])).toBe(true);
    expect(hasAnyPermission(has, ['rbac:write'])).toBe(false);
  });

  it('prefers data-require-permission-any over data-require-permission', () => {
    const el = element({ 'data-require-permission': 'rbac:write', 'data-require-permission-any': 'chat:read | c2:read' });
    expect(elementAllowed(has, el)).toBe(true);
  });

  it('uses the single permission attribute and allows unannotated elements', () => {
    expect(elementAllowed(has, element({ 'data-require-permission': 'rbac:write' }))).toBe(false);
    expect(elementAllowed(has, element({}))).toBe(true);
    expect(elementAllowed(has, null)).toBe(true);
  });

  it('maps navigation pages to their read permission', () => {
    expect(pagePermission('chat')).toBe('chat:read');
    expect(pagePermission('unknown-page')).toBeUndefined();
    expect(pagePermission(null)).toBeUndefined();
  });
});
