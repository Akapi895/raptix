import { describe, expect, it } from 'vitest';
import { VaultValidationError, isRevoked, normalizeSecret, secretsResponseSchema, sortedByCreatedDesc, validateAddFields, type VaultSecret } from './model';

const secret = (overrides: Partial<VaultSecret> = {}): VaultSecret => ({
  id: 's1', projectId: 'p1', scope: 'PROJECT', name: 'db-password', description: '', kind: 'credential',
  sourceProjectId: null, revokedAt: null, createdAt: '2026-11-03T00:00:00.000Z', createdBy: 'admin', ...overrides,
});

describe('vault model', () => {
  it('normalises the server wire shape into the UI shape', () => {
    const parsed = secretsResponseSchema.parse({
      secrets: [{
        id: 's1', project_id: 'p1', scope: 'PROJECT', name: 'db-password', description: 'found in config',
        kind: 'credential', source_project_id: null, revoked_at: null, created_at: '2026-11-03T00:00:00.000Z', created_by: 'admin',
      }],
    });
    expect(normalizeSecret(parsed.secrets[0]!)).toEqual(secret({ description: 'found in config' }));
  });

  it('never includes plaintext or ciphertext fields in the parsed shape', () => {
    const wire = {
      id: 's1', project_id: 'p1', scope: 'PROJECT', name: 'db-password', description: '', kind: 'credential',
      source_project_id: null, revoked_at: null, created_at: '2026-11-03T00:00:00.000Z', created_by: 'admin',
      cipherText: 'leak', plaintext: 'leak',
    };
    const parsed = secretsResponseSchema.safeParse({ secrets: [wire] });
    expect(parsed.success).toBe(true);
    expect(JSON.stringify(parsed.success ? parsed.data : null)).not.toContain('leak');
  });

  it('treats a secret with revokedAt as revoked', () => {
    expect(isRevoked(secret())).toBe(false);
    expect(isRevoked(secret({ revokedAt: '2026-11-03T01:00:00.000Z' }))).toBe(true);
  });

  it('sorts newest first without mutating the input', () => {
    const older = secret({ id: 'a', createdAt: '2026-11-01T00:00:00.000Z' });
    const newer = secret({ id: 'b', createdAt: '2026-11-02T00:00:00.000Z' });
    const input = [older, newer];
    expect(sortedByCreatedDesc(input)).toEqual([newer, older]);
    expect(input).toEqual([older, newer]);
  });

  it('requires a non-empty name within the server column limit', () => {
    expect(() => validateAddFields('db-password', 'secret-value')).not.toThrow();
    expect(() => validateAddFields('', 'x')).toThrow(VaultValidationError);
    expect(() => validateAddFields('a'.repeat(201), 'x')).toThrow(VaultValidationError);
  });

  it('requires a non-empty value', () => {
    expect(() => validateAddFields('name', '')).toThrow(VaultValidationError);
  });

  it('pins the failing field on a validation error', () => {
    try {
      validateAddFields('', 'x');
      throw new Error('expected a validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultValidationError);
      expect((error as VaultValidationError).field).toBe('name');
    }
  });
});
