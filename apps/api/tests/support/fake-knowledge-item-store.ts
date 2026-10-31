import type {
  CreateKnowledgeItemInput,
  KnowledgeItemRecord,
  KnowledgeItemStore,
  KnowledgeListResult,
  KnowledgeSearchResult,
} from "../../src/db/knowledge-item-store.js";

export class FakeKnowledgeItemStore implements KnowledgeItemStore {
  private items = new Map<string, KnowledgeItemRecord>();
  private nextId = 1;

  public async listCategories(): Promise<string[]> {
    return [...new Set([...this.items.values()].map((item) => item.category))].sort();
  }

  public async listByCategoryPage(args: { category?: string; limit: number; offset: number }): Promise<KnowledgeListResult> {
    const categories = args.category ? [args.category] : await this.listCategories();
    const page = categories.slice(args.offset, args.offset + args.limit);
    return {
      categories: page.map((category) => {
        const items = [...this.items.values()].filter((item) => item.category === category);
        return { category, itemCount: items.length, items };
      }),
      total: categories.length,
    };
  }

  public async search(query: string): Promise<KnowledgeSearchResult> {
    const needle = query.toLowerCase();
    const items = [...this.items.values()].filter(
      (item) => item.title.toLowerCase().includes(needle) || item.content.toLowerCase().includes(needle) || item.category.toLowerCase().includes(needle),
    );
    return { items, total: items.length };
  }

  public async get(id: string): Promise<KnowledgeItemRecord | null> {
    return this.items.get(id) ?? null;
  }

  public async create(input: CreateKnowledgeItemInput): Promise<KnowledgeItemRecord> {
    const id = `knowledge-${this.nextId++}`;
    const now = new Date();
    const item: KnowledgeItemRecord = { id, category: input.category, title: input.title, content: input.content, filePath: input.filePath ?? null, createdAt: now, updatedAt: now };
    this.items.set(id, item);
    return item;
  }

  public async update(id: string, input: CreateKnowledgeItemInput): Promise<KnowledgeItemRecord | null> {
    const existing = this.items.get(id);
    if (!existing) return null;
    const updated: KnowledgeItemRecord = { ...existing, category: input.category, title: input.title, content: input.content, filePath: input.filePath ?? null, updatedAt: new Date() };
    this.items.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  public async stats(): Promise<{ totalItems: number; totalCategories: number }> {
    return { totalItems: this.items.size, totalCategories: (await this.listCategories()).length };
  }
}
