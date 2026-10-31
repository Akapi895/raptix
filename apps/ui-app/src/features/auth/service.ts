import { z } from 'zod';
import { http, HttpError } from '../../platform/http';
import { createEvents, transportEvents } from '../../platform/events';
import { session, type StoredSession } from '../../platform/session';
import { hasAnyPermission } from './permissions';

// internal/handler/auth.go: Login and Validate return the same session payload.
export const sessionPayloadSchema = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true }),
  user: z.object({
    id: z.string(),
    username: z.string(),
    display_name: z.string().optional(),
  }).nullable().optional(),
  roles: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  scope: z.string().default(''),
});
export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

// internal/handler/auth.go: robot-binding-code and robot-bindings.
export const bindingCodeSchema = z.object({
  code: z.string().min(1),
  expires_in_seconds: z.number().positive().optional(),
});
export const robotBindingsSchema = z.object({
  bindings: z.array(z.object({
    id: z.string(),
    platform: z.string(),
    external_user_hint: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })).default([]),
});
export type RobotBinding = z.infer<typeof robotBindingsSchema>['bindings'][number];

export interface AuthUser { id: string; username: string; display_name?: string }

/** Read-only view of the current session; subscribers receive a fresh copy on every change. */
export interface AuthSnapshot {
  authenticated: boolean;
  user: AuthUser | null;
  roles: readonly string[];
  permissions: ReadonlySet<string>;
  scope: string;
  expiresAt: string | null;
}

export type LoginResult = { ok: true } | { ok: false; message: string | null };

export type AuthEvents = {
  changed: AuthSnapshot;
  /** Emitted when a request needs a session the browser does not have. */
  'login-required': { message: string | null };
};

export interface AuthApi {
  post<T>(path: string, body?: unknown, options?: { auth?: boolean; schema?: { parse(value: unknown): T } }): Promise<T>;
  get<T>(path: string, options?: { auth?: boolean; schema?: { parse(value: unknown): T } }): Promise<T>;
  delete<T>(path: string, options?: { schema?: { parse(value: unknown): T } }): Promise<T>;
}

export interface AuthStore {
  read(): StoredSession | null;
  save(value: StoredSession): boolean;
  clear(): void;
}

export interface AuthServiceDependencies {
  api?: AuthApi;
  store?: AuthStore;
  now?: () => number;
}

const emptySnapshot: AuthSnapshot = {
  authenticated: false, user: null, roles: [], permissions: new Set(), scope: '', expiresAt: null,
};

/** The server's own explanation (`{"error": "..."}`), or null when it sent none. */
function serverMessage(error: unknown): string | null {
  if (!(error instanceof HttpError)) return null;
  const body = error.body;
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error) return body.error;
  return null;
}

function toStored(payload: SessionPayload): StoredSession {
  return {
    token: payload.token,
    expiresAt: payload.expires_at,
    user: payload.user ?? null,
    roles: payload.roles,
    permissions: payload.permissions,
    scope: payload.scope,
  };
}

export function createAuthService(dependencies: AuthServiceDependencies = {}) {
  const api: AuthApi = dependencies.api ?? http;
  const store: AuthStore = dependencies.store ?? session;
  const now = dependencies.now ?? Date.now;
  const events = createEvents<AuthEvents>();
  let stored: StoredSession | null = null;
  let waiters: (() => void)[] = [];
  let snapshotCache: AuthSnapshot = emptySnapshot;

  function isValid(value: StoredSession | null): value is StoredSession {
    return value !== null && Date.parse(value.expiresAt) > now();
  }

  /** The stored session if it has not expired, otherwise null. */
  function active(): StoredSession | null {
    return isValid(stored) ? stored : null;
  }

  function buildSnapshot(): AuthSnapshot {
    const session = active();
    if (!session) return emptySnapshot;
    return {
      authenticated: true,
      user: session.user ?? null,
      roles: [...session.roles],
      permissions: new Set(session.permissions),
      scope: session.scope,
      expiresAt: session.expiresAt,
    };
  }

  function hasPermission(permission: string): boolean {
    if (!permission) return true;
    return active()?.permissions.includes(permission) ?? false;
  }

  function publish(): void {
    snapshotCache = buildSnapshot();
    events.emit('changed', snapshotCache);
    if (snapshotCache.authenticated) {
      const resume = waiters;
      waiters = [];
      resume.forEach(resolve => resolve());
    }
  }

  function commit(value: StoredSession | null): void {
    stored = isValid(value) ? value : null;
    if (stored) store.save(stored);
    else store.clear();
    publish();
  }

  function requireLogin(message: string | null = null): void {
    events.emit('login-required', { message });
  }

  // Public transport signals: a 401 means the session is gone, a 403 is a normal RBAC refusal.
  transportEvents.on('session-expired', () => {
    stored = null;
    publish();
    requireLogin('auth.sessionExpired');
  });

  return {
    /** Restore the persisted session if it is still valid. Returns whether one exists. */
    restore(): boolean {
      stored = store.read();
      if (!isValid(stored)) stored = null;
      publish();
      return stored !== null;
    },

    isAuthenticated: (): boolean => active() !== null,
    snapshot: (): AuthSnapshot => snapshotCache,
    token: (): string => active()?.token ?? '',

    subscribe(listener: (snapshot: AuthSnapshot) => void): () => void {
      return events.on('changed', listener);
    },
    onLoginRequired(listener: (detail: AuthEvents['login-required']) => void): () => void {
      return events.on('login-required', listener);
    },

    hasPermission,
    hasAnyPermission: (permissions: readonly string[]): boolean => hasAnyPermission(hasPermission, permissions),

    /**
     * Resolves once a valid session exists. Without one, asks the view to show the
     * login overlay and waits for a successful login. Mirrors the legacy promise gate.
     */
    ensureAuthenticated(): Promise<void> {
      if (active()) return Promise.resolve();
      requireLogin();
      return new Promise(resolve => { waiters.push(resolve); });
    },

    async login(username: string, password: string): Promise<LoginResult> {
      try {
        const payload = await api.post('/api/auth/login', { username, password }, {
          auth: false, schema: sessionPayloadSchema,
        });
        commit(toStored(payload));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: serverMessage(error) };
      }
    },

    /** Server-side check of the stored token. Clears the session when the server rejects it. */
    async validate(): Promise<boolean> {
      const session = active();
      if (!session) {
        commit(null);
        return false;
      }
      try {
        const payload = await api.get('/api/auth/validate', { schema: sessionPayloadSchema });
        commit(toStored({ ...payload, token: payload.token || session.token }));
        return true;
      } catch {
        commit(null);
        return false;
      }
    },

    async logout(): Promise<void> {
      if (active()) {
        try { await api.post('/api/auth/logout', undefined); } catch { /* Local sign-out still happens. */ }
      }
      commit(null);
    },

    async requestBindingCode(): Promise<{ code: string; expiresInSeconds: number }> {
      const body = await api.post('/api/auth/robot-binding-code', undefined, { schema: bindingCodeSchema });
      return { code: body.code, expiresInSeconds: body.expires_in_seconds ?? 300 };
    },
    async listBindings(): Promise<RobotBinding[]> {
      return (await api.get('/api/auth/robot-bindings', { schema: robotBindingsSchema })).bindings;
    },
    async deleteBinding(id: string): Promise<void> {
      await api.delete(`/api/auth/robot-bindings/${encodeURIComponent(id)}`);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
