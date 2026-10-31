/*
 * Auth and RBAC routes: login/session, users, platform roles, resource assignments.
 */
import type { MockRuntime } from '../runtime';
import type { Role, User } from '../types';
import { bodies } from '../bodies';

export function registerAuth(M: MockRuntime): void {

  // Builds the session payload the UI expects from /api/auth/login and /validate.
  M.sessionPayload = function (user: User) {
    const roleIds = user.roles || [];
    const perms: Record<string, boolean> = {};
    const scopes: Record<string, string> = {};
    M.state.roles.forEach(function (role) {
      if (roleIds.indexOf(role.id) === -1) return;
      role.permissions.forEach(function (p) { perms[p] = true; });
      scopes[role.name] = role.scope;
    });
    const scope = roleIds.some(function (id) {
      const r = M.findById(M.state.roles, id);
      return r && r.item.scope === 'all';
    }) ? 'all' : 'assigned';
    return {
      token: M.state.auth.token,
      expires_at: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
      session_duration_hr: 12,
      user: { id: user.id, username: user.username, display_name: user.display_name },
      roles: roleIds.map(function (id) { const r = M.findById(M.state.roles, id); return r ? r.item.name : id; }),
      permissions: Object.keys(perms),
      permission_scopes: scopes,
      scope: scope,
    };
  };

  // { item, index } of the signed-in user, or { item: null } after logout.
  function currentUser() {
    const id = M.state.sessionUserId;
    return (id ? M.findById(M.state.users, id) : null) || { item: null };
  }

  M.route('POST', '/api/auth/login', bodies.login, function (ctx) {
    const body = ctx.body || {};
    if (!body.password) return M.fail(400, 'Password is required');
    const username = String(body.username || '').trim();
    const found = M.state.users.filter(function (u) { return u.username === username; })[0];
    if (!found) return M.fail(401, 'Incorrect password');
    if (!found.enabled) return M.fail(403, 'Account is disabled');
    M.state.sessionUserId = found.id;
    M.state.auth.token = 'mock-session-' + found.id;
    found.last_login_at = M.nowISO();
    M.save();
    return M.ok(M.sessionPayload(found));
  });

  M.route('GET', '/api/auth/validate', function () {
    const u = currentUser();
    if (!u.item) return M.fail(401, 'Invalid session');
    return M.ok(M.sessionPayload(u.item));
  });

  M.route('POST', '/api/auth/logout', function () {
    M.state.sessionUserId = null;
    M.save();
    return M.ok({ message: 'Signed out' });
  });

  M.route('POST', '/api/auth/change-password', bodies.password, function (ctx) {
    const body = ctx.body || {};
    if (!body.current_password || !body.new_password) return M.fail(400, 'Current and new password are both required');
    if (String(body.new_password).length < 8) return M.fail(400, 'New password must be at least 8 characters');
    return M.ok({ message: 'Password updated. Sign in again with the new password.' });
  });

  M.route('GET', '/api/auth/robot-bindings', function () {
    return M.ok({ bindings: M.state.robotBindings || [] });
  });

  M.route('POST', '/api/auth/robot-binding-code', function () {
    return M.ok({ code: 'DEMO-' + Math.floor(1000 + Math.random() * 8999), expires_at: new Date(Date.now() + 5 * 60000).toISOString() });
  });

  /* ---------- RBAC ---------- */

  M.route('GET', '/api/rbac/me', function () {
    const u = currentUser();
    if (!u.item) return M.fail(401, 'Invalid session');
    return M.ok(M.sessionPayload(u.item));
  });

  M.route('GET', '/api/rbac/metadata', function () {
    const rolePermissions: Record<string, string[]> = {};
    M.state.roles.forEach(function (r) { rolePermissions[r.id] = r.permissions.slice(); });
    return M.ok({
      permissions: M.PERMISSION_CATALOG,
      roles: M.state.roles.map(function (r) { return { id: r.id, name: r.name, description: r.description, scope: r.scope, is_system: r.is_system }; }),
      role_permissions: rolePermissions,
      scopes: ['all', 'assigned', 'own'],
    });
  });

  M.route('GET', '/api/rbac/roles', function () {
    return M.ok({ roles: M.state.roles.map(roleView) });
  });

  M.route('POST', '/api/rbac/roles', bodies.role, function (ctx) {
    const b = ctx.body || {};
    const role = { id: M.id('role'), name: b.name || 'New role', description: b.description || '', scope: b.scope || 'own', is_system: false, permissions: b.permissions || [], created_at: M.nowISO(), updated_at: M.nowISO() };
    M.state.roles.push(role);
    M.save();
    return M.ok(roleView(role));
  });

  M.route('PUT', '/api/rbac/roles/:id', bodies.role, function (ctx) {
    const found = M.findById(M.state.roles, ctx.params.id);
    if (!found) return M.fail(404, 'Role not found');
    M.mergeInto(found.item, ctx.body, ['name', 'description', 'scope', 'permissions']);
    found.item.updated_at = M.nowISO();
    M.save();
    return M.ok(roleView(found.item));
  });

  M.route('DELETE', '/api/rbac/roles/:id', function (ctx) {
    const found = M.findById(M.state.roles, ctx.params.id);
    if (!found) return M.fail(404, 'Role not found');
    if (found.item.is_system) return M.fail(400, 'System roles cannot be deleted');
    M.removeAt(M.state.roles, found.index);
    M.save();
    return M.ok({ success: true });
  });

  M.route('GET', '/api/rbac/users', function (ctx) {
    const list = M.filterList(M.state.users, ctx, { searchFields: ['username', 'display_name'] });
    return M.ok({ users: list.map(userView), total: list.length });
  });

  M.route('POST', '/api/rbac/users', bodies.user, function (ctx) {
    const b = ctx.body || {};
    if (!b.username) return M.fail(400, 'Username is required');
    const user = { id: M.id('user'), username: b.username, display_name: b.display_name || b.username, enabled: b.enabled !== false, roles: b.roles || [], created_at: M.nowISO(), last_login_at: null };
    M.state.users.push(user);
    M.save();
    return M.ok(userView(user));
  });

  M.route('PUT', '/api/rbac/users/:id', bodies.user, function (ctx) {
    const found = M.findById(M.state.users, ctx.params.id);
    if (!found) return M.fail(404, 'User not found');
    M.mergeInto(found.item, ctx.body, ['display_name', 'enabled', 'roles']);
    M.save();
    return M.ok(userView(found.item));
  });

  M.route('DELETE', '/api/rbac/users/:id', function (ctx) {
    const found = M.findById(M.state.users, ctx.params.id);
    if (!found) return M.fail(404, 'User not found');
    if (found.item.id === 'user-admin') return M.fail(400, 'The admin account cannot be deleted');
    M.removeAt(M.state.users, found.index);
    M.save();
    return M.ok({ success: true });
  });

  M.route('GET', '/api/rbac/resources', function () {
    return M.ok({
      resources: [
        { type: 'project', label: 'Projects', items: M.state.projects.map(function (p) { return { id: p.id, name: p.name }; }) },
        { type: 'conversation', label: 'Conversations', items: M.state.conversations.map(function (c) { return { id: c.id, name: c.title }; }) },
      ],
    });
  });

  M.route('GET', '/api/rbac/resource-assignments', function () {
    return M.ok({ assignments: M.state.assignments || [] });
  });

  M.route('POST', '/api/rbac/resource-assignments', bodies.assignment, function (ctx) {
    M.state.assignments = M.state.assignments || [];
    const b = ctx.body || {};
    const a = { id: M.id('asg'), user_id: b.user_id, resource_type: b.resource_type, resource_id: b.resource_id, created_at: M.nowISO() };
    M.state.assignments.push(a);
    M.save();
    return M.ok(a);
  });

  M.route('DELETE', '/api/rbac/resource-assignments/:id', function (ctx) {
    M.state.assignments = (M.state.assignments || []).filter(function (a) { return a.id !== ctx.params.id; });
    M.save();
    return M.ok({ success: true });
  });

  function roleView(r: Role) {
    return {
      id: r.id, name: r.name, description: r.description, scope: r.scope, is_system: r.is_system,
      permissions: r.permissions, created_at: r.created_at, updated_at: r.updated_at,
    };
  }

  function userView(u: User) {
    return {
      id: u.id, username: u.username, display_name: u.display_name, enabled: u.enabled,
      roles: u.roles, created_at: u.created_at, last_login_at: u.last_login_at,
    };
  }
}
