import { randomBytes } from "node:crypto";

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** Matches apps/ui-app's T1_SessionPayload (docs/openapi.yaml) exactly. */
export interface SessionPayload {
  token: string;
  expires_at: string;
  session_duration_hr: number;
  user: { id: string; username: string; display_name: string };
  roles: string[];
  permissions: string[];
  permission_scopes: Record<string, string>;
  scope: string;
}

export function buildSessionPayload(args: {
  token: string;
  expiresAt: Date;
  sessionDurationHours: number;
  operator: { id: string; username: string; displayName: string };
}): SessionPayload {
  return {
    token: args.token,
    expires_at: args.expiresAt.toISOString(),
    session_duration_hr: args.sessionDurationHours,
    user: {
      id: args.operator.id,
      username: args.operator.username,
      display_name: args.operator.displayName,
    },
    // Single-operator deployment (ADR-0100-style): one operator, full scope.
    // Real RBAC/AI-roles is a Tier 6 design spike, not this.
    roles: ["Administrator"],
    permissions: ["*"],
    permission_scopes: { Administrator: "all" },
    scope: "all",
  };
}
