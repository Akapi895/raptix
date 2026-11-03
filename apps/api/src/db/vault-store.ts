import type { PrismaClient } from "../generated/prisma/client.js";
import { decryptSecret, encryptSecret, VaultDecryptionError } from "../security/vault-crypto.js";

/** Never carries cipherText or plaintext -- the type itself keeps list/reference DTOs secret-free. */
export interface VaultSecretRecord {
  id: string;
  projectId: string | null;
  scope: "PROJECT" | "GLOBAL";
  name: string;
  description: string;
  kind: string;
  keyVersion: number;
  sourceProjectId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface VaultAuditActor {
  actor: string;
  actorKind: "operator" | "runtime";
  reason?: string;
}

export interface VaultStore {
  listForProject(projectId: string): Promise<VaultSecretRecord[]>;
  listGlobal(): Promise<VaultSecretRecord[]>;
  findByProjectAndName(projectId: string, name: string): Promise<VaultSecretRecord | null>;
  create(fields: {
    projectId: string;
    name: string;
    description?: string;
    kind?: string;
    plaintext: string;
    createdBy: string;
  }): Promise<VaultSecretRecord>;
  /** Decrypts and audits in one step; returns null if the secret is missing or revoked. Never regenerates a value. */
  reveal(id: string, projectId: string | null, actor: VaultAuditActor): Promise<string | null>;
  revoke(id: string, projectId: string | null, actor: string): Promise<boolean>;
  promoteToGlobal(id: string, actor: string): Promise<VaultSecretRecord | null>;
}

function toRecord(row: {
  id: string;
  projectId: string | null;
  scope: string;
  name: string;
  description: string;
  kind: string;
  keyVersion: number;
  sourceProjectId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}): VaultSecretRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    scope: row.scope as "PROJECT" | "GLOBAL",
    name: row.name,
    description: row.description,
    kind: row.kind,
    keyVersion: row.keyVersion,
    sourceProjectId: row.sourceProjectId,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
  };
}

/** Fastify's default error handler reads `error.statusCode` directly -- no explicit catch needed per route. */
export class VaultUnavailableError extends Error {
  public readonly statusCode = 503;
  constructor(message = "Vault is not configured for this deployment (RAPTIX_VAULT_MASTER_KEY_FILE unset or invalid).") {
    super(message);
    this.name = "VaultUnavailableError";
  }
}

/** Used when the vault master key could not be loaded at startup -- every call fails 503, never a fabricated success. */
export class UnconfiguredVaultStore implements VaultStore {
  private fail(): never {
    throw new VaultUnavailableError();
  }
  public listForProject = (): Promise<VaultSecretRecord[]> => this.fail();
  public listGlobal = (): Promise<VaultSecretRecord[]> => this.fail();
  public findByProjectAndName = (): Promise<VaultSecretRecord | null> => this.fail();
  public create = (): Promise<VaultSecretRecord> => this.fail();
  public reveal = (): Promise<string | null> => this.fail();
  public revoke = (): Promise<boolean> => this.fail();
  public promoteToGlobal = (): Promise<VaultSecretRecord | null> => this.fail();
}

export class PrismaVaultStore implements VaultStore {
  public constructor(
    private readonly db: PrismaClient,
    private readonly masterKey: Buffer,
  ) {}

  public async listForProject(projectId: string): Promise<VaultSecretRecord[]> {
    const rows = await this.db.vaultSecret.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
    return rows.map(toRecord);
  }

  public async listGlobal(): Promise<VaultSecretRecord[]> {
    const rows = await this.db.vaultSecret.findMany({ where: { scope: "GLOBAL" }, orderBy: { createdAt: "desc" } });
    return rows.map(toRecord);
  }

  public async findByProjectAndName(projectId: string, name: string): Promise<VaultSecretRecord | null> {
    const row = await this.db.vaultSecret.findUnique({ where: { projectId_name: { projectId, name } } });
    return row ? toRecord(row) : null;
  }

  public async create(fields: {
    projectId: string;
    name: string;
    description?: string;
    kind?: string;
    plaintext: string;
    createdBy: string;
  }): Promise<VaultSecretRecord> {
    const cipherText = encryptSecret(fields.plaintext, this.masterKey);
    const row = await this.db.vaultSecret.create({
      data: {
        projectId: fields.projectId,
        name: fields.name,
        description: fields.description ?? "",
        kind: fields.kind ?? "credential",
        cipherText,
        createdBy: fields.createdBy,
      },
    });
    await this.db.vaultAudit.create({
      data: { secretId: row.id, action: "store", actor: fields.createdBy, actorKind: "operator", projectId: fields.projectId },
    });
    return toRecord(row);
  }

  public async reveal(id: string, projectId: string | null, actor: VaultAuditActor): Promise<string | null> {
    const row = await this.db.vaultSecret.findUnique({ where: { id } });
    if (!row || row.revokedAt) return null;
    if (projectId !== null && row.projectId !== projectId) return null;
    // Audit before returning plaintext: if this write fails, reveal fails closed rather than racing ahead.
    await this.db.vaultAudit.create({
      data: {
        secretId: row.id,
        action: "reveal",
        actor: actor.actor,
        actorKind: actor.actorKind,
        projectId: row.projectId,
        reason: actor.reason ?? "",
      },
    });
    try {
      return decryptSecret(row.cipherText, this.masterKey);
    } catch (cause) {
      if (cause instanceof VaultDecryptionError) return null;
      throw cause;
    }
  }

  public async revoke(id: string, projectId: string | null, actor: string): Promise<boolean> {
    const row = await this.db.vaultSecret.findUnique({ where: { id } });
    if (!row || row.revokedAt) return false;
    if (projectId !== null && row.projectId !== projectId) return false;
    await this.db.vaultSecret.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.db.vaultAudit.create({
      data: { secretId: id, action: "revoke", actor, actorKind: "operator", projectId: row.projectId },
    });
    return true;
  }

  public async promoteToGlobal(id: string, actor: string): Promise<VaultSecretRecord | null> {
    const row = await this.db.vaultSecret.findUnique({ where: { id } });
    if (!row || row.revokedAt || row.scope === "GLOBAL") return null;
    const updated = await this.db.vaultSecret.update({
      where: { id },
      data: { scope: "GLOBAL", projectId: null, sourceProjectId: row.projectId },
    });
    await this.db.vaultAudit.create({
      data: { secretId: id, action: "promote_to_global", actor, actorKind: "operator", projectId: row.projectId },
    });
    return toRecord(updated);
  }
}
