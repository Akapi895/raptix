import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Ticket 07 multi-user identity: scrypt password verification, opaque
 * session tokens (only their sha256 is stored), per-session CSRF tokens and
 * an origin check enforced at the HTTP boundary. Single-user deployments
 * never call any of this — identity stays the fixed local operator.
 */

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'raptix_web_session';

export interface SessionRequestContext {
  readonly cookieHeader: string | undefined;
  readonly origin: string | undefined;
  readonly host: string | undefined;
  readonly method: string;
  readonly csrfHeader: string | undefined;
}

export interface ResolvedSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly csrfToken: string;
  readonly origin: string;
  readonly expiresAt: Date;
}

/** PHC-style scrypt hash: scrypt$N$r$p$salt$dk. Verification is constant-time. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${dk.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = parts[1]!;
  const r = parts[2]!;
  const p = parts[3]!;
  const salt = parts[4]!;
  const dk = parts[5]!;
  const expected = Buffer.from(dk, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueSessionMaterial(): { token: string; sessionId: string; csrfToken: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, sessionId: hashToken(token), csrfToken: randomBytes(24).toString('base64url') };
}

/**
 * Same-origin check for requests that carry an Origin header. An absent
 * Origin (same-origin GET, non-browser client) is allowed — mutations are
 * still gated by the per-session CSRF header, which cross-site pages cannot
 * read or set.
 */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return host !== undefined && (parsed.host === host || parsed.host === new URL(`http://${host}`).host);
  } catch {
    return false;
  }
}

export type SessionDecision = {
  readonly ok: true;
  readonly session: ResolvedSession;
} | {
  readonly ok: false;
  readonly status: 401 | 403;
  readonly reason: string;
};

/** Validates expiry + origin; mutations additionally require the CSRF header. */
export function checkSession(
  ctx: SessionRequestContext,
  lookup: (sessionId: string) => Promise<ResolvedSession | null>,
): Promise<SessionDecision> {
  return parseCookieToken(ctx.cookieHeader).then(async (token) => {
    if (token === null) return { ok: false, status: 401, reason: 'Sign in to continue.' } as SessionDecision;
    const session = await lookup(hashToken(token));
    if (session === null) return { ok: false, status: 401, reason: 'The session is no longer valid. Sign in again.' } as SessionDecision;
    if (session.expiresAt.getTime() <= Date.now()) return { ok: false, status: 401, reason: 'The session has expired. Sign in again.' } as SessionDecision;
    if (!isSameOrigin(ctx.origin, ctx.host)) return { ok: false, status: 403, reason: 'Cross-origin requests are refused.' } as SessionDecision;
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD' && ctx.csrfHeader !== session.csrfToken) {
      return { ok: false, status: 403, reason: 'Missing or invalid CSRF token.' } as SessionDecision;
    }
    return { ok: true, session } as SessionDecision;
  });
}

function parseCookieToken(cookieHeader: string | undefined): Promise<string | null> {
  if (cookieHeader === undefined) return Promise.resolve(null);
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE && rest.length > 0) return Promise.resolve(rest.join('='));
  }
  return Promise.resolve(null);
}

export function sessionCookieHeader(token: string, expiresAt: Date, secure: boolean): string {
  const flags = `Path=/; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${secure ? '; Secure' : ''}`;
  return `${SESSION_COOKIE}=${token}; ${flags}`;
}

export const CLEAR_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
