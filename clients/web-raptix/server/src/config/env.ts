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
  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }
  return {
    host,
    port,
    nodeEnv,
    logLevel,
    ...(databaseUrl === undefined ? {} : { databaseUrl }),
    ...(workspacePath === undefined ? {} : { workspacePath }),
  };
}

export function readServerEnv(): ServerEnv {
  return loadServerEnv(process.env);
}
