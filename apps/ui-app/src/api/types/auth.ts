import { z } from 'zod';
import type { StoredSession } from '../../platform/session';
import { timestampSchema } from './common';

// internal/handler/auth.go:Login / Validate (gin.H responses, not a shared Go DTO).
export const authSessionSchema = z.looseObject({
  token: z.string().min(1),
  expires_at: timestampSchema,
  user: z.looseObject({ id: z.string(), username: z.string(), display_name: z.string() }),
  roles: z.array(z.string()).nullable(),
  permissions: z.array(z.string()),
  permission_scopes: z.record(z.string(), z.string()).nullable(),
  scope: z.string(),
});
export const loginResponseSchema = authSessionSchema.extend({ session_duration_hr: z.number() });
export type AuthSession = z.infer<typeof authSessionSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export interface LoginRequest { username: string; password: string }
export interface ChangePasswordRequest { oldPassword: string; newPassword: string }

// The persisted browser contract intentionally differs from the API contract:
// saveAuth does not persist permission_scopes.
export function toStoredSession(value: AuthSession): StoredSession {
  return {
    token: value.token, expiresAt: value.expires_at, user: value.user,
    roles: value.roles ?? [], permissions: value.permissions, scope: value.scope,
  };
}
