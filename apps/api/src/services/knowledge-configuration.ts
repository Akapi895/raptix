import type { AppConfigStore } from "../db/app-config-store.js";

export interface KnowledgeConfiguration { enabled: boolean; revision: number }
export class KnowledgeConfigurationConflict extends Error {
  public readonly statusCode = 409;
  constructor() { super("Knowledge Graph settings changed. Refresh before saving again."); }
}

/** Web execution preference; defaults preserve the existing graph-assistance behavior. */
export class KnowledgeConfigurationService {
  public constructor(private readonly store: AppConfigStore) {}
  public async snapshot(): Promise<KnowledgeConfiguration> {
    const saved = await this.store.get("knowledge-graph-assistance-v1");
    return { enabled: typeof saved?.enabled === "boolean" ? saved.enabled : true, revision: Number(saved?.revision ?? 0) };
  }
  public async update(enabled: boolean, revision: number): Promise<KnowledgeConfiguration> {
    const previous = await this.store.get("knowledge-graph-assistance-v1");
    if (Number(previous?.revision ?? 0) !== revision) throw new KnowledgeConfigurationConflict();
    const value = { enabled, revision: revision + 1 };
    if (!await this.store.compareAndSet("knowledge-graph-assistance-v1", previous, value)) throw new KnowledgeConfigurationConflict();
    return value;
  }
}
