import type { AssetFields, AssetRecord, AssetStore, ListAssetsQuery } from "../../src/db/asset-store.js";

const DEFAULTS: Omit<AssetRecord, "id" | "projectId" | "firstSeenAt" | "lastSeenAt" | "createdAt" | "updatedAt"> = {
  host: "",
  ip: "",
  port: 0,
  domain: "",
  protocol: "",
  title: "",
  server: "",
  country: "",
  province: "",
  city: "",
  responsiblePerson: "",
  department: "",
  businessSystem: "",
  environment: "",
  criticality: "",
  source: "",
  sourceQuery: "",
  status: "active",
  tags: [],
};

export class FakeAssetStore implements AssetStore {
  private readonly assets = new Map<string, AssetRecord>();
  private nextId = 1;

  public async list(query: ListAssetsQuery): Promise<{ assets: AssetRecord[]; total: number }> {
    let rows = [...this.assets.values()];
    if (query.projectId) rows = rows.filter((a) => a.projectId === query.projectId);
    if (query.status) rows = rows.filter((a) => a.status === query.status);
    if (query.search) {
      const needle = query.search.toLowerCase();
      rows = rows.filter((a) => a.host.includes(needle) || a.ip.includes(needle) || a.domain.includes(needle) || a.title.toLowerCase().includes(needle));
    }
    const total = rows.length;
    return { assets: rows.slice(query.offset, query.offset + query.limit), total };
  }

  public async findById(id: string): Promise<AssetRecord | null> {
    return this.assets.get(id) ?? null;
  }

  public async findByIds(ids: string[]): Promise<AssetRecord[]> {
    return ids.flatMap((id) => (this.assets.has(id) ? [this.assets.get(id)!] : []));
  }

  public async replace(id: string, fields: AssetFields): Promise<AssetRecord | null> {
    if (!this.assets.has(id)) return null;
    const now = new Date();
    const record: AssetRecord = {
      id,
      projectId: fields.projectId ?? null,
      ...DEFAULTS,
      ...fields,
      tags: fields.tags ?? [],
      firstSeenAt: this.assets.get(id)!.firstSeenAt,
      lastSeenAt: now,
      createdAt: this.assets.get(id)!.createdAt,
      updatedAt: now,
    };
    this.assets.set(id, record);
    return record;
  }

  public async bulkPatch(ids: string[], fields: AssetFields): Promise<number> {
    let count = 0;
    for (const id of ids) {
      const existing = this.assets.get(id);
      if (!existing) continue;
      this.assets.set(id, { ...existing, ...fields, updatedAt: new Date() });
      count += 1;
    }
    return count;
  }

  public async delete(id: string): Promise<boolean> {
    return this.assets.delete(id);
  }

  public async batchDelete(ids: string[]): Promise<number> {
    let count = 0;
    for (const id of ids) if (this.assets.delete(id)) count += 1;
    return count;
  }

  public async importUpsert(items: AssetFields[]): Promise<{ created: number; updated: number; skipped: number }> {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const item of items) {
      const key = item.host || item.ip || item.domain;
      if (!key) {
        skipped += 1;
        continue;
      }
      // Mirrors PrismaAssetStore.importUpsert: exactly one discriminator field, picked by
      // priority (host, then ip, then domain) -- not an OR across all three, which would
      // false-match two different hosts that merely share the same ip.
      const existing = [...this.assets.values()].find((a) => {
        if (a.projectId !== (item.projectId ?? null)) return false;
        if (item.host) return a.host === item.host;
        if (item.ip) return a.ip === item.ip;
        return a.domain === item.domain;
      });
      if (existing) {
        this.assets.set(existing.id, { ...existing, ...item, tags: item.tags ?? existing.tags, lastSeenAt: new Date() });
        updated += 1;
      } else {
        const now = new Date();
        const id = `asset-${this.nextId++}`;
        this.assets.set(id, { id, projectId: item.projectId ?? null, ...DEFAULTS, ...item, tags: item.tags ?? [], firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now });
        created += 1;
      }
    }
    return { created, updated, skipped };
  }

  public async merge(primaryId: string, mergeIds: string[]): Promise<AssetRecord | null> {
    const primary = this.assets.get(primaryId);
    if (!primary) return null;
    const tags = new Set(primary.tags);
    for (const id of mergeIds) {
      if (id === primaryId) continue;
      const other = this.assets.get(id);
      if (other) for (const tag of other.tags) tags.add(tag);
      this.assets.delete(id);
    }
    const updated = { ...primary, tags: [...tags] };
    this.assets.set(primaryId, updated);
    return updated;
  }

  public async setProjectBinding(ids: string[], projectId: string | null): Promise<number> {
    let count = 0;
    for (const id of ids) {
      const existing = this.assets.get(id);
      if (!existing) continue;
      this.assets.set(id, { ...existing, projectId });
      count += 1;
    }
    return count;
  }

  public async stats() {
    const rows = [...this.assets.values()];
    return {
      total: rows.length,
      ips: new Set(rows.map((a) => a.ip).filter(Boolean)).size,
      domains: new Set(rows.map((a) => a.domain).filter(Boolean)).size,
      ports: new Set(rows.map((a) => a.port).filter((p) => p !== 0)).size,
      recent: rows.length,
      protocols: [],
    };
  }

  public seed(record: Partial<AssetRecord> & { id: string }): AssetRecord {
    const now = new Date();
    const full: AssetRecord = { projectId: null, ...DEFAULTS, firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now, ...record };
    this.assets.set(full.id, full);
    return full;
  }
}
