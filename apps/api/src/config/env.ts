export class EnvValidationError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(issues.join("; "));
    this.name = "EnvValidationError";
  }
}

export interface ApiEnv {
  port: number;
  host: string;
  databaseUrl: string;
  runtimeApiTokenFile: string | undefined;
  langgraphApiUrl: string;
  sandboxKeyFile: string | undefined;
  operatorUsername: string | undefined;
  operatorPassword: string | undefined;
  sessionDurationHours: number;
}

export function loadEnv(source: NodeJS.ProcessEnv): ApiEnv {
  const issues: string[] = [];

  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) issues.push("DATABASE_URL is required");

  const port = Number(source.API_PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0) {
    issues.push("API_PORT must be a positive integer");
  }

  const sessionDurationHours = Number(source.API_SESSION_DURATION_HOURS ?? 12);
  if (!Number.isFinite(sessionDurationHours) || sessionDurationHours <= 0) {
    issues.push("API_SESSION_DURATION_HOURS must be a positive number");
  }

  if (issues.length > 0) throw new EnvValidationError(issues);

  return {
    port,
    host: source.API_HOST ?? "127.0.0.1",
    databaseUrl: databaseUrl as string,
    runtimeApiTokenFile: source.RAPTIX_RUNTIME_API_TOKEN_FILE,
    langgraphApiUrl: (source.LANGGRAPH_API_URL ?? "http://127.0.0.1:2024").replace(/\/$/, ""),
    sandboxKeyFile: source.RAPTIX_SANDBOX_KEY_FILE,
    operatorUsername: source.RAPTIX_API_OPERATOR_USERNAME,
    operatorPassword: source.RAPTIX_API_OPERATOR_PASSWORD,
    sessionDurationHours,
  };
}
