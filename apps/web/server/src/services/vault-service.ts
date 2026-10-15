import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { VaultRevealView, VaultSecretView, VaultView } from '@raptix/web-contracts';
import { ProjectApiError } from './projects-service.js';
import { assertEngagementOpen } from './closure-service.js';

/**
 * W18 credentials vault: server-side encrypted secret storage. Secrets are
 * sealed with AES-256-GCM under an operator-provided key; the metadata view
 * is redacted by construction (no ciphertext column ever leaves the
 * service), plaintext exists only in the dedicated reveal response, and
 * every reveal/creation/revocation is appended to the engagement-scoped
 * audit log. Without a key the vault answers 503 — it never degrades to
 * plaintext storage.
 */

const KIND_MAX = 64;
const LABEL_MAX = 120;
const PLAINTEXT_MAX = 10_000;
const SECRETS_PAGE = 200;

const KEY_UNCONFIGURED = 'Vault encryption key not configured; no secrets can be stored or revealed';

export class VaultService {
  /** @param key 32-byte AES-256 key, or null when unconfigured (fail loud). */
  public constructor(private readonly db: PrismaClient, private readonly key: Buffer | null) {}

  public async list(userId: string, engagementId: string): Promise<VaultView> {
    const engagement = await this.findEngagement(userId, engagementId);
    const rows = await this.db.vaultSecret.findMany({
      where: { engagementId: engagement.id },
      orderBy: { createdAt: 'desc' },
      take: SECRETS_PAGE + 1,
    });
    const truncated = rows.length > SECRETS_PAGE;
    const views: VaultSecretView[] = [];
    for (const row of rows.slice(0, SECRETS_PAGE)) {
      views.push(await this.toSecretView(engagement.id, row as unknown as VaultSecretRow));
    }
    return { engagementId: engagement.id, secrets: views, truncated, source: 'db' };
  }

  public async create(userId: string, engagementId: string, body: unknown): Promise<VaultSecretView> {
    const engagement = await this.findEngagement(userId, engagementId);
    await assertEngagementOpen(this.db, engagementId);
    this.requireKey();
    const input = parseSecretInput(body);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key as Buffer, iv);
    const ciphertext = Buffer.concat([cipher.update(input.plaintext, 'utf8'), cipher.final()]);
    const row = await this.db.vaultSecret.create({
      data: {
        engagementId: engagement.id,
        kind: input.kind,
        label: input.label,
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        createdBy: userId,
      },
    });
    await this.db.vaultAudit.create({
      data: { engagementId: engagement.id, secretId: row.id, action: 'created', actorId: userId },
    });
    return this.toSecretView(engagement.id, row as unknown as VaultSecretRow);
  }

  public async reveal(userId: string, engagementId: string, secretId: string): Promise<VaultRevealView> {
    const engagement = await this.findEngagement(userId, engagementId);
    await assertEngagementOpen(this.db, engagementId);
    this.requireKey();
    const row = await this.db.vaultSecret.findFirst({ where: { id: secretId, engagementId: engagement.id } });
    if (!row) throw new ProjectApiError(404, 'Secret not found');
    let plaintext: string;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key as Buffer, Buffer.from(row.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));
      plaintext = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      // Decryption failures must never echo ciphertext-derived material.
      throw new ProjectApiError(503, 'Stored secret could not be decrypted with the configured key');
    }
    const revealedAt = new Date();
    await this.db.vaultAudit.create({
      data: { engagementId: engagement.id, secretId: row.id, action: 'revealed', actorId: userId },
    });
    return { secretId: row.id, engagementId: engagement.id, plaintext, revealedAt: revealedAt.toISOString() };
  }

  public async revoke(userId: string, engagementId: string, secretId: string): Promise<{ ok: true }> {
    const engagement = await this.findEngagement(userId, engagementId);
    const row = await this.db.vaultSecret.findFirst({ where: { id: secretId, engagementId: engagement.id } });
    if (!row) throw new ProjectApiError(404, 'Secret not found');
    await this.db.vaultAudit.create({
      data: { engagementId: engagement.id, secretId: row.id, action: 'revoked', actorId: userId },
    });
    await this.db.vaultSecret.delete({ where: { id: row.id } });
    return { ok: true };
  }

  private requireKey(): void {
    if (!this.key || this.key.length !== 32) throw new ProjectApiError(503, KEY_UNCONFIGURED);
  }

  private async findEngagement(userId: string, engagementId: string) {
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId, userId } });
    if (!engagement) throw new ProjectApiError(404, 'Project not found');
    return engagement;
  }

  private async toSecretView(engagementId: string, row: VaultSecretRow): Promise<VaultSecretView> {
    const revealed = await this.db.vaultAudit.aggregate({
      where: { secretId: row.id, action: 'revealed' },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    return {
      id: row.id,
      engagementId,
      kind: row.kind,
      label: row.label,
      createdBy: row.createdBy,
      revealCount: revealed._count._all,
      lastRevealedAt: revealed._max.createdAt ? revealed._max.createdAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

interface VaultSecretRow {
  id: string;
  engagementId: string;
  kind: string;
  label: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

function parseSecretInput(body: unknown): { kind: string; label: string; plaintext: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ProjectApiError(400, 'Vault secret requires a JSON object body');
  }
  const raw = body as Record<string, unknown>;
  const kind = typeof raw.kind === 'string' ? raw.kind.trim() : '';
  if (kind.length < 1 || kind.length > KIND_MAX) {
    throw new ProjectApiError(400, `kind must be a non-empty string of at most ${KIND_MAX} characters`);
  }
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (label.length < 1 || label.length > LABEL_MAX) {
    throw new ProjectApiError(400, `label must be a non-empty string of at most ${LABEL_MAX} characters`);
  }
  const plaintext = typeof raw.plaintext === 'string' ? raw.plaintext : '';
  if (plaintext.length < 1 || plaintext.length > PLAINTEXT_MAX) {
    throw new ProjectApiError(400, `plaintext must be a non-empty string of at most ${PLAINTEXT_MAX} characters`);
  }
  return { kind, label, plaintext };
}
