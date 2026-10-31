import type { PrismaClient } from "../generated/prisma/client.js";

export interface AssetRecord {
  id: string;
  projectId: string | null;
  host: string;
  ip: string;
  port: number;
  domain: string;
  protocol: string;
  title: string;
  server: string;
  country: string;
  province: string;
  city: string;
  responsiblePerson: string;
  department: string;
  businessSystem: string;
  environment: string;
  criticality: string;
  source: string;
  sourceQuery: string;
  status: string;
  tags: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Mirrors apps/ui-app's AssetInput (src/api/types/asset.ts) field-for-field. */
export interface AssetFields {
  projectId?: string | null;
  host?: string;
  ip?: string;
  port?: number;
  domain?: string;
  protocol?: string;
  title?: string;
  server?: string;
  country?: string;
  province?: string;
  city?: string;
  responsiblePerson?: string;
  department?: string;
  businessSystem?: string;
  environment?: string;
  criticality?: string;
  source?: string;
  sourceQuery?: string;
  status?: string;
  tags?: string[];
}

export interface ListAssetsQuery {
  projectId?: string;
  status?: string;
  protocol?: string;
  host?: string;
  ip?: string;
  domain?: string;
  port?: number;
  search?: string;
  limit: number;
  offset: number;
}

export interface AssetStore {
  list(query: ListAssetsQuery): Promise<{ assets: AssetRecord[]; total: number }>;
  findById(id: string): Promise<AssetRecord | null>;
  findByIds(ids: string[]): Promise<AssetRecord[]>;
  /** Full replace, not a patch -- apps/ui-app's AssetInput comment: omitted editable fields are cleared. */
  replace(id: string, fields: AssetFields): Promise<AssetRecord | null>;
  /** Partial patch applied to every id (PUT /api/assets/bulk) -- unlike replace(), omitted fields are left alone. */
  bulkPatch(ids: string[], fields: AssetFields): Promise<number>;
  delete(id: string): Promise<boolean>;
  batchDelete(ids: string[]): Promise<number>;
  /** Upsert by (projectId, host|ip|domain) -- see asset-store.ts's dedup key comment. */
  importUpsert(items: AssetFields[]): Promise<{ created: number; updated: number; skipped: number }>;
  /** Merges `mergeIds` into `primaryId` (unions tags, keeps the primary row's other fields), deletes the rest. */
  merge(primaryId: string, mergeIds: string[]): Promise<AssetRecord | null>;
  setProjectBinding(ids: string[], projectId: string | null): Promise<number>;
  stats(): Promise<{
    total: number;
    ips: number;
    domains: number;
    ports: number;
    recent: number;
    protocols: { name: string; count: number }[];
  }>;
}

function toRecord(row: {
  id: string;
  projectId: string | null;
  host: string;
  ip: string;
  port: number;
  domain: string;
  protocol: string;
  title: string;
  server: string;
  country: string;
  province: string;
  city: string;
  responsiblePerson: string;
  department: string;
  businessSystem: string;
  environment: string;
  criticality: string;
  source: string;
  sourceQuery: string;
  status: string;
  tags: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): AssetRecord {
  return { ...row };
}

const DEFAULT_FIELDS: Required<Omit<AssetFields, "projectId" | "tags">> = {
  host: "",
  ip: "",
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
  port: 0,
};

export class PrismaAssetStore implements AssetStore {
  public constructor(private readonly db: PrismaClient) {}

  public async list(query: ListAssetsQuery): Promise<{ assets: AssetRecord[]; total: number }> {
    const where = {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.protocol ? { protocol: query.protocol } : {}),
      ...(query.host ? { host: query.host } : {}),
      ...(query.ip ? { ip: query.ip } : {}),
      ...(query.domain ? { domain: query.domain } : {}),
      ...(query.port !== undefined ? { port: query.port } : {}),
      ...(query.search
        ? {
            OR: [
              { host: { contains: query.search, mode: "insensitive" as const } },
              { ip: { contains: query.search, mode: "insensitive" as const } },
              { domain: { contains: query.search, mode: "insensitive" as const } },
              { title: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.asset.findMany({ where, orderBy: { updatedAt: "desc" }, take: query.limit, skip: query.offset }),
      this.db.asset.count({ where }),
    ]);
    return { assets: rows.map(toRecord), total };
  }

  public async findById(id: string): Promise<AssetRecord | null> {
    const row = await this.db.asset.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  public async findByIds(ids: string[]): Promise<AssetRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.asset.findMany({ where: { id: { in: ids } } });
    return rows.map(toRecord);
  }

  public async replace(id: string, fields: AssetFields): Promise<AssetRecord | null> {
    const exists = await this.db.asset.findUnique({ where: { id } });
    if (!exists) return null;
    const row = await this.db.asset.update({
      where: { id },
      data: {
        projectId: fields.projectId ?? null,
        ...DEFAULT_FIELDS,
        ...Object.fromEntries(Object.entries(fields).filter(([key, value]) => key !== "projectId" && value !== undefined)),
        tags: fields.tags ?? [],
        lastSeenAt: new Date(),
      },
    });
    return toRecord(row);
  }

  public async bulkPatch(ids: string[], fields: AssetFields): Promise<number> {
    if (ids.length === 0) return 0;
    const data = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    if (Object.keys(data).length === 0) return 0;
    const result = await this.db.asset.updateMany({ where: { id: { in: ids } }, data });
    return result.count;
  }

  public async delete(id: string): Promise<boolean> {
    try {
      await this.db.asset.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  public async batchDelete(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.db.asset.deleteMany({ where: { id: { in: ids } } });
    return result.count;
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
      const where = {
        projectId: item.projectId ?? null,
        ...(item.host ? { host: item.host } : item.ip ? { ip: item.ip } : { domain: item.domain }),
      };
      const existing = await this.db.asset.findFirst({ where });
      if (existing) {
        await this.db.asset.update({
          where: { id: existing.id },
          data: { ...Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)), lastSeenAt: new Date() },
        });
        updated += 1;
      } else {
        await this.db.asset.create({
          data: { ...DEFAULT_FIELDS, ...item, tags: item.tags ?? [] },
        });
        created += 1;
      }
    }
    return { created, updated, skipped };
  }

  public async merge(primaryId: string, mergeIds: string[]): Promise<AssetRecord | null> {
    const primary = await this.db.asset.findUnique({ where: { id: primaryId } });
    if (!primary) return null;
    const others = mergeIds.filter((id) => id !== primaryId);
    const mergedRows = others.length > 0 ? await this.db.asset.findMany({ where: { id: { in: others } } }) : [];
    const tags = new Set(primary.tags);
    for (const row of mergedRows) for (const tag of row.tags) tags.add(tag);
    if (others.length > 0) await this.db.asset.deleteMany({ where: { id: { in: others } } });
    const row = await this.db.asset.update({ where: { id: primaryId }, data: { tags: [...tags] } });
    return toRecord(row);
  }

  public async setProjectBinding(ids: string[], projectId: string | null): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.db.asset.updateMany({ where: { id: { in: ids } }, data: { projectId } });
    return result.count;
  }

  public async stats(): Promise<{
    total: number;
    ips: number;
    domains: number;
    ports: number;
    recent: number;
    protocols: { name: string; count: number }[];
  }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, ipRows, domainRows, portRows, recent, protocolRows] = await Promise.all([
      this.db.asset.count(),
      this.db.asset.findMany({ where: { ip: { not: "" } }, select: { ip: true }, distinct: ["ip"] }),
      this.db.asset.findMany({ where: { domain: { not: "" } }, select: { domain: true }, distinct: ["domain"] }),
      this.db.asset.findMany({ where: { port: { not: 0 } }, select: { port: true }, distinct: ["port"] }),
      this.db.asset.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.db.asset.groupBy({ by: ["protocol"], where: { protocol: { not: "" } }, _count: { _all: true } }),
    ]);
    return {
      total,
      ips: ipRows.length,
      domains: domainRows.length,
      ports: portRows.length,
      recent,
      protocols: protocolRows.map((row) => ({ name: row.protocol, count: row._count._all })),
    };
  }
}
