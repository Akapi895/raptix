import type { VaultAuditActor, VaultSecretRecord, VaultStore } from "../../src/db/vault-store.js";

export class FakeVaultStore implements VaultStore {
  private readonly secrets = new Map<string, VaultSecretRecord & { plaintext: string }>();
  public readonly audits: Array<{ secretId: string; action: string; actor: VaultAuditActor }> = [];
  private nextId = 1;

  public async listForProject(projectId: string): Promise<VaultSecretRecord[]> {
    return [...this.secrets.values()]
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public async listGlobal(): Promise<VaultSecretRecord[]> {
    return [...this.secrets.values()].filter((s) => s.scope === "GLOBAL");
  }

  public async findByProjectAndName(projectId: string, name: string): Promise<VaultSecretRecord | null> {
    return [...this.secrets.values()].find((s) => s.projectId === projectId && s.name === name) ?? null;
  }

  public async create(fields: {
    projectId: string;
    name: string;
    description?: string;
    kind?: string;
    plaintext: string;
    createdBy: string;
  }): Promise<VaultSecretRecord> {
    const now = new Date();
    const id = `vault-${this.nextId++}`;
    const record = {
      id,
      projectId: fields.projectId,
      scope: "PROJECT" as const,
      name: fields.name,
      description: fields.description ?? "",
      kind: fields.kind ?? "credential",
      keyVersion: 1,
      sourceProjectId: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: fields.createdBy,
      plaintext: fields.plaintext,
    };
    this.secrets.set(id, record);
    this.audits.push({ secretId: id, action: "store", actor: { actor: fields.createdBy, actorKind: "operator" } });
    return record;
  }

  public async reveal(id: string, projectId: string | null, actor: VaultAuditActor): Promise<string | null> {
    const row = this.secrets.get(id);
    if (!row || row.revokedAt) return null;
    if (projectId !== null && row.projectId !== projectId) return null;
    this.audits.push({ secretId: id, action: "reveal", actor });
    return row.plaintext;
  }

  public async revoke(id: string, projectId: string | null, actor: string): Promise<boolean> {
    const row = this.secrets.get(id);
    if (!row || row.revokedAt) return false;
    if (projectId !== null && row.projectId !== projectId) return false;
    row.revokedAt = new Date();
    this.audits.push({ secretId: id, action: "revoke", actor: { actor, actorKind: "operator" } });
    return true;
  }

  public async promoteToGlobal(id: string, actor: string): Promise<VaultSecretRecord | null> {
    const row = this.secrets.get(id);
    if (!row || row.revokedAt || row.scope === "GLOBAL") return null;
    row.sourceProjectId = row.projectId;
    row.projectId = null;
    row.scope = "GLOBAL";
    this.audits.push({ secretId: id, action: "promote_to_global", actor: { actor, actorKind: "operator" } });
    return row;
  }
}
