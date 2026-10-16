import type { GoPhishConfig } from '../integrations/campaigns/gophish-client.js';
import type { EvilginxBridgeConfig } from '../integrations/campaigns/evilginx-client.js';
import type { SliverConfig } from '../integrations/c2/sliver-client.js';

export type ServerLogLevel =
  | 'fatal'
  | 'error'
  | 'warn'
  | 'info'
  | 'debug'
  | 'trace';

export type ServerNodeEnv = 'development' | 'test' | 'production';

export interface ServerEnv {
  readonly host: string;
  readonly port: number;
  readonly nodeEnv: ServerNodeEnv;
  readonly logLevel: ServerLogLevel;
  /**
   * Explicit PostgreSQL connection string (DATABASE_URL). Optional: when
   * unset the server runs in bootstrap-only mode. Never defaulted, never
   * logged, never echoed in validation errors.
   */
  readonly databaseUrl?: string;
  /**
   * Explicit API-visible workspace root (WORKSPACE_PATH). Optional; the
   * directory is only ever validated/created at this passed location.
   */
  readonly workspacePath?: string;
  /**
   * Neo4j HTTP endpoint for the W13 scoped graph projection (NEO4J_HTTP_URI,
   * e.g. http://127.0.0.1:7475). Present only when NEO4J_PASSWORD is set and
   * is not the documented public default: like the legacy API, a missing or
   * well-known password refuses to serve graph data at all.
   */
  readonly graph?: { readonly httpUri: string; readonly user: string; readonly password: string };
  /**
   * Base64-encoded 32-byte AES-256 vault key (VAULT_ENCRYPTION_KEY).
   * Optional: without it the vault capability reports unavailable and every
   * vault write/reveal answers 503. Invalid shapes are rejected at startup;
   * the value is a secret and is never logged or echoed.
   */
  readonly vaultKey?: Buffer;
  readonly gophish?: GoPhishConfig;
  readonly evilginx?: EvilginxBridgeConfig;
  readonly sliver?: SliverConfig;
  /**
   * Identity mode (ticket 07). `local` (default) keeps the fixed single-user
   * operator; `multi` enables session/CSRF/origin-authenticated multi-user
   * access with persisted memberships (RAPTIX_WEB_AUTH_MODE=multi).
   */
  readonly authMode?: 'local' | 'multi';
  /** Bootstrap admin credentials for multi mode; server-side only. */
  readonly adminBootstrap?: { readonly username: string; readonly password: string; readonly displayName: string };
  /** Issue session cookies with the Secure flag (RAPTIX_WEB_SECURE_COOKIES=1). */
  readonly secureCookies?: boolean;
  /** Stable non-secret namespace for browser recovery across image upgrades. */
  readonly deploymentId?: string;
}

export const SERVER_ENV_DEFAULTS: Readonly<
  Pick<ServerEnv, 'host' | 'port' | 'nodeEnv' | 'logLevel'>
> = {
  host: '127.0.0.1',
  port: 5280,
  nodeEnv: 'development',
  logLevel: 'info',
};

const HOST_PATTERN = /^[A-Za-z0-9._:-]{1,253}$/;
const PORT_PATTERN = /^\d{1,5}$/;
const PORT_MIN = 1;
const PORT_MAX = 65535;

export class EnvValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(
      `invalid server environment (${issues.length} issue(s)): ${issues.join('; ')}`,
    );
    this.name = 'EnvValidationError';
    this.issues = [...issues];
  }
}

function readHost(source: NodeJS.ProcessEnv, issues: string[]): string {
  const raw = source.HOST;
  if (raw === undefined) return SERVER_ENV_DEFAULTS.host;
  if (!HOST_PATTERN.test(raw)) {
    issues.push(
      'HOST must be a hostname or IP address (1-253 chars of letters, digits, ".", "_", ":" or "-")',
    );
    return SERVER_ENV_DEFAULTS.host;
  }
  return raw;
}

function readPort(source: NodeJS.ProcessEnv, issues: string[]): number {
  const raw = source.PORT;
  if (raw === undefined) return SERVER_ENV_DEFAULTS.port;
  if (!PORT_PATTERN.test(raw)) {
    issues.push(`PORT must be an integer between ${PORT_MIN} and ${PORT_MAX}`);
    return SERVER_ENV_DEFAULTS.port;
  }
  const value = Number.parseInt(raw, 10);
  if (
    !Number.isSafeInteger(value) ||
    value < PORT_MIN ||
    value > PORT_MAX
  ) {
    issues.push(`PORT must be an integer between ${PORT_MIN} and ${PORT_MAX}`);
    return SERVER_ENV_DEFAULTS.port;
  }
  return value;
}

function readNodeEnv(source: NodeJS.ProcessEnv, issues: string[]): ServerNodeEnv {
  const raw = source.NODE_ENV;
  if (raw === undefined) return SERVER_ENV_DEFAULTS.nodeEnv;
  if (raw !== 'development' && raw !== 'test' && raw !== 'production') {
    issues.push('NODE_ENV must be one of: development, test, production');
    return SERVER_ENV_DEFAULTS.nodeEnv;
  }
  return raw;
}

function readLogLevel(
  source: NodeJS.ProcessEnv,
  issues: string[],
): ServerLogLevel {
  const raw = source.LOG_LEVEL;
  if (raw === undefined) return SERVER_ENV_DEFAULTS.logLevel;
  const allowed: readonly ServerLogLevel[] = [
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
  ];
  const match = allowed.find((level) => level === raw);
  if (match === undefined) {
    issues.push(
      `LOG_LEVEL must be one of: ${allowed.join(', ')}`,
    );
    return SERVER_ENV_DEFAULTS.logLevel;
  }
  return match;
}

/**
 * Optional DATABASE_URL. The raw value is treated as a secret: validation
 * issues never include it and it is only returned to the composition root.
 */
function readDatabaseUrl(
  source: NodeJS.ProcessEnv,
  issues: string[],
): string | undefined {
  const raw = source.DATABASE_URL;
  if (raw === undefined) return undefined;
  if (raw.trim().length === 0) {
    issues.push('DATABASE_URL must be a non-empty connection string or unset');
    return undefined;
  }
  return raw;
}

/** Optional WORKSPACE_PATH: non-empty when present; never echoed on error. */
function readWorkspacePath(
  source: NodeJS.ProcessEnv,
  issues: string[],
): string | undefined {
  const raw = source.WORKSPACE_PATH;
  if (raw === undefined) return undefined;
  if (raw.trim().length === 0) {
    issues.push('WORKSPACE_PATH must be a non-empty path or unset');
    return undefined;
  }
  return raw;
}

/**
 * Optional Neo4j HTTP config for the scoped graph projection. The password is
 * a secret: never logged, never echoed. The documented public default is
 * rejected outright so a misconfigured deployment fails to serve graph data
 * rather than serving it with a well-known credential.
 */
function readGraphConfig(
  source: NodeJS.ProcessEnv,
  issues: string[],
): ServerEnv['graph'] {
  const password = source.NEO4J_PASSWORD;
  if (password === undefined) return undefined;
  if (password.trim().length === 0) {
    issues.push('NEO4J_PASSWORD must be a non-empty secret or unset');
    return undefined;
  }
  if (password === 'raptix-graph') {
    issues.push('NEO4J_PASSWORD is set to the documented public default; refusing to serve graph data');
    return undefined;
  }
  const httpPort = source.NEO4J_HTTP_PORT ?? '7475';
  if (!/^\d{1,5}$/.test(httpPort) || Number(httpPort) < 1 || Number(httpPort) > 65535) {
    issues.push('NEO4J_HTTP_PORT must be an integer between 1 and 65535');
    return undefined;
  }
  const httpUri = source.NEO4J_HTTP_URI ?? `http://127.0.0.1:${httpPort}`;
  return { httpUri, user: source.NEO4J_USER ?? 'neo4j', password };
}

/**
 * Optional base64 32-byte vault key. Invalid lengths fail loudly instead of
 * silently weakening the vault; the raw value is treated as a secret.
 */
function readVaultKey(
  source: NodeJS.ProcessEnv,
  issues: string[],
): Buffer | undefined {
  const raw = source.VAULT_ENCRYPTION_KEY;
  if (raw === undefined) return undefined;
  if (raw.trim().length === 0) {
    issues.push('VAULT_ENCRYPTION_KEY must be a non-empty base64 key or unset');
    return undefined;
  }
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) {
    issues.push('VAULT_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded AES-256 key)');
    return undefined;
  }
  return decoded;
}

function readGoPhish(source: NodeJS.ProcessEnv, issues: string[]): GoPhishConfig | undefined {
  if (source.GOPHISH_API_URL === undefined && source.GOPHISH_API_KEY === undefined) return undefined;
  const apiKey = source.GOPHISH_API_KEY;
  if (!apiKey || apiKey.trim() !== apiKey || apiKey.length > 512 || /[\r\n]/.test(apiKey)) {
    issues.push('GOPHISH_API_KEY must be a non-empty API key when GOPHISH_API_URL is configured');
  }
  let url: URL;
  try { url = new URL(source.GOPHISH_API_URL ?? ''); }
  catch { issues.push('GOPHISH_API_URL must be a valid absolute URL when GOPHISH_API_KEY is configured'); return undefined; }
  const labHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', 'gophish'].includes(url.hostname);
  if (source.GOPHISH_LAB_DEPLOYMENT !== undefined && source.GOPHISH_LAB_DEPLOYMENT !== '0' && source.GOPHISH_LAB_DEPLOYMENT !== '1') {
    issues.push('GOPHISH_LAB_DEPLOYMENT must be 0 or 1');
  }
  if ((url.protocol !== 'https:' && !labHttp) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    issues.push('GOPHISH_API_URL requires HTTPS (or loopback/gophish lab HTTP), without credentials, query, fragment or path');
    return undefined;
  }
  return apiKey ? { apiUrl: url.origin, apiKey, labDeployment: source.GOPHISH_LAB_DEPLOYMENT === '1' } : undefined;
}

export function loadServerEnv(
  source: NodeJS.ProcessEnv = process.env,
): ServerEnv {
  const issues: string[] = [];
  const host = readHost(source, issues);
  const port = readPort(source, issues);
  const nodeEnv = readNodeEnv(source, issues);
  const logLevel = readLogLevel(source, issues);
  const databaseUrl = readDatabaseUrl(source, issues);
  const workspacePath = readWorkspacePath(source, issues);
  const graph = readGraphConfig(source, issues);
  const vaultKey = readVaultKey(source, issues);
  const gophish = readGoPhish(source, issues);
  const sliver = readSliver(source, issues);
  let evilginx: EvilginxBridgeConfig | undefined;
  if (source.EVILGINX_BRIDGE_URL !== undefined || source.EVILGINX_BRIDGE_TOKEN !== undefined) {
    const apiKey = source.EVILGINX_BRIDGE_TOKEN;
    if (!apiKey || apiKey.length < 32 || apiKey.length > 512 || apiKey.trim() !== apiKey || /[\r\n]/.test(apiKey)) issues.push('EVILGINX_BRIDGE_TOKEN requires a private token of 32-512 characters');
    try {
      const url = new URL(source.EVILGINX_BRIDGE_URL ?? '');
      const lab = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]', 'evilginx-bridge'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !lab) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new TypeError('invalid bridge URL');
      if (apiKey) evilginx = { apiUrl: url.origin, apiKey };
    } catch { issues.push('EVILGINX_BRIDGE_URL requires HTTPS or loopback/evilginx-bridge lab HTTP, without credentials, path, query or fragment'); }
  }
  const authMode = readAuthMode(source, issues);
  const adminBootstrap = readAdminBootstrap(source, issues, authMode);
  const secureCookies = source.RAPTIX_WEB_SECURE_COOKIES === '1';
  const deploymentId = source.RAPTIX_WEB_DEPLOYMENT_ID;
  if (deploymentId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deploymentId)) issues.push('RAPTIX_WEB_DEPLOYMENT_ID must be a non-secret installation identifier (1-128 characters).');
  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }
  return {
    host,
    port,
    nodeEnv,
    logLevel,
    ...(secureCookies ? { secureCookies: true } : {}),
    ...(deploymentId === undefined ? {} : { deploymentId }),
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(workspacePath === undefined ? {} : { workspacePath }),
    ...(graph === undefined ? {} : { graph }),
    ...(vaultKey === undefined ? {} : { vaultKey }),
    ...(gophish === undefined ? {} : { gophish }),
    ...(evilginx === undefined ? {} : { evilginx }),
    ...(sliver === undefined ? {} : { sliver }),
    ...(authMode === undefined ? {} : { authMode }),
    ...(adminBootstrap === undefined ? {} : { adminBootstrap }),
  } satisfies ServerEnv;
}

function readAuthMode(source: NodeJS.ProcessEnv, issues: string[]): 'local' | 'multi' | undefined {
  const raw = source.RAPTIX_WEB_AUTH_MODE;
  if (raw === undefined) return undefined;
  if (raw !== 'local' && raw !== 'multi') {
    issues.push('RAPTIX_WEB_AUTH_MODE must be "local" or "multi"');
    return undefined;
  }
  return raw;
}

function readAdminBootstrap(
  source: NodeJS.ProcessEnv,
  issues: string[],
  authMode: 'local' | 'multi' | undefined,
): ServerEnv['adminBootstrap'] {
  const username = source.RAPTIX_WEB_ADMIN_USERNAME;
  const password = source.RAPTIX_WEB_ADMIN_PASSWORD;
  if (username === undefined && password === undefined) return undefined;
  if (authMode !== 'multi') {
    issues.push('RAPTIX_WEB_ADMIN_* requires RAPTIX_WEB_AUTH_MODE=multi');
    return undefined;
  }
  if (username === undefined || username.trim().length === 0 || username.length > 200) {
    issues.push('RAPTIX_WEB_ADMIN_USERNAME must be 1-200 characters when set');
    return undefined;
  }
  if (password === undefined || password.length < 8 || password.length > 200) {
    issues.push('RAPTIX_WEB_ADMIN_PASSWORD must be 8-200 characters when set');
    return undefined;
  }
  const displayName = source.RAPTIX_WEB_ADMIN_DISPLAY_NAME ?? username;
  return { username, password, displayName };
}

export function readServerEnv(): ServerEnv {
  return loadServerEnv(process.env);
}

function readSliver(source: NodeJS.ProcessEnv, issues: string[]): SliverConfig | undefined {
  if (source.SLIVER_BRIDGE_URL === undefined && source.SLIVER_BRIDGE_TOKEN === undefined) return undefined;
  const key = source.SLIVER_BRIDGE_TOKEN;
  if (!key || key.length < 32 || key.length > 512 || key.trim() !== key || /[\r\n]/.test(key)) issues.push('SLIVER_BRIDGE_TOKEN requires a private token of 32-512 characters');
  try { const url = new URL(source.SLIVER_BRIDGE_URL ?? '');
    if (!(url.protocol === 'https:' || url.protocol === 'http:' && ['sliver-bridge','localhost','127.0.0.1','[::1]'].includes(url.hostname)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new EnvValidationError([]);
    return key ? { apiUrl: url.origin, apiKey: key } : undefined;
  } catch { issues.push('SLIVER_BRIDGE_URL requires HTTPS or loopback/sliver-bridge lab HTTP without credentials, path, query or fragment'); return undefined; }
}
