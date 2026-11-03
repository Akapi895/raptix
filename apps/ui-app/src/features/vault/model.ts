/**
 * Pure vault shapes and helpers: no DOM, no network. Reveal is handled entirely
 * server-side (apps/api/src/http/routes/vault.routes.ts) -- this module never
 * holds or derives plaintext itself; it only shapes the redacted list DTO.
 */
import { z } from 'zod';

export interface VaultSecret {
  id: string;
  projectId: string | null;
  scope: 'PROJECT' | 'GLOBAL';
  name: string;
  description: string;
  kind: string;
  sourceProjectId: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: string;
}

// apps/api/src/http/routes/vault.routes.ts's toWire().
const wireSecretSchema = z.object({
  id: z.string(),
  project_id: z.string().nullable(),
  scope: z.enum(['PROJECT', 'GLOBAL']),
  name: z.string(),
  description: z.string(),
  kind: z.string(),
  source_project_id: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
  created_by: z.string(),
});

export const secretsResponseSchema = z.object({ secrets: z.array(wireSecretSchema) });

export function normalizeSecret(raw: z.infer<typeof wireSecretSchema>): VaultSecret {
  return {
    id: raw.id,
    projectId: raw.project_id,
    scope: raw.scope,
    name: raw.name,
    description: raw.description,
    kind: raw.kind,
    sourceProjectId: raw.source_project_id,
    revokedAt: raw.revoked_at,
    createdAt: raw.created_at,
    createdBy: raw.created_by,
  };
}

export function isRevoked(secret: VaultSecret): boolean {
  return secret.revokedAt !== null;
}

export function sortedByCreatedDesc(secrets: readonly VaultSecret[]): VaultSecret[] {
  return [...secrets].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export class VaultValidationError extends Error {
  constructor(message: string, readonly field?: 'name' | 'value') {
    super(message);
    this.name = 'VaultValidationError';
  }
}

/** name/value are required; name is capped to match the server's column + UI input maxlength. */
export function validateAddFields(name: string, value: string): void {
  if (!name.trim()) throw new VaultValidationError('name-required', 'name');
  if (name.length > 200) throw new VaultValidationError('name-too-long', 'name');
  if (!value) throw new VaultValidationError('value-required', 'value');
}

/** How long a revealed value stays visible before auto-hiding, in milliseconds. */
export const REVEAL_TIMEOUT_MS = 30_000;
