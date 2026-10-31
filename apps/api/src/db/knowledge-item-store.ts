import type { PrismaClient } from "../generated/prisma/client.js";

export interface KnowledgeItemRecord {
  id: string;
  category: string;
  title: string;
  content: string;
  filePath: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeCategoryGroup {
  category: string;
  itemCount: number;
  items: KnowledgeItemRecord[];
}

export interface KnowledgeListResult {
  categories: KnowledgeCategoryGroup[];
  total: number;
}

export interface KnowledgeSearchResult {
  items: KnowledgeItemRecord[];
  total: number;
}

export interface CreateKnowledgeItemInput {
  category: string;
  title: string;
  content: string;
  filePath?: string | null;
}

export interface KnowledgeItemStore {
  listCategories(): Promise<string[]>;
  listByCategoryPage(args: { category?: string; limit: number; offset: number }): Promise<KnowledgeListResult>;
  search(query: string): Promise<KnowledgeSearchResult>;
  get(id: string): Promise<KnowledgeItemRecord | null>;
  create(input: CreateKnowledgeItemInput): Promise<KnowledgeItemRecord>;
  update(id: string, input: CreateKnowledgeItemInput): Promise<KnowledgeItemRecord | null>;
  delete(id: string): Promise<boolean>;
  stats(): Promise<{ totalItems: number; totalCategories: number }>;
}

export class PrismaKnowledgeItemStore implements KnowledgeItemStore {
  public constructor(private readonly db: PrismaClient) {}

  public async listCategories(): Promise<string[]> {
    const rows = await this.db.knowledgeItem.findMany({ select: { category: true }, distinct: ["category"], orderBy: { category: "asc" } });
    return rows.map((row) => row.category);
  }

  public async listByCategoryPage(args: { category?: string; limit: number; offset: number }): Promise<KnowledgeListResult> {
    const categories = args.category ? [args.category] : await this.listCategories();
    const page = categories.slice(args.offset, args.offset + args.limit);
    const groups = await Promise.all(
      page.map(async (category): Promise<KnowledgeCategoryGroup> => {
        const items = await this.db.knowledgeItem.findMany({ where: { category }, orderBy: { updatedAt: "desc" } });
        return { category, itemCount: items.length, items };
      }),
    );
    return { categories: groups, total: categories.length };
  }

  public async search(query: string): Promise<KnowledgeSearchResult> {
    const items = await this.db.knowledgeItem.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
          { category: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    return { items, total: items.length };
  }

  public async get(id: string): Promise<KnowledgeItemRecord | null> {
    return this.db.knowledgeItem.findUnique({ where: { id } });
  }

  public async create(input: CreateKnowledgeItemInput): Promise<KnowledgeItemRecord> {
    return this.db.knowledgeItem.create({
      data: { category: input.category, title: input.title, content: input.content, filePath: input.filePath ?? null },
    });
  }

  public async update(id: string, input: CreateKnowledgeItemInput): Promise<KnowledgeItemRecord | null> {
    const exists = await this.db.knowledgeItem.findUnique({ where: { id } });
    if (!exists) return null;
    return this.db.knowledgeItem.update({
      where: { id },
      data: { category: input.category, title: input.title, content: input.content, filePath: input.filePath ?? null },
    });
  }

  public async delete(id: string): Promise<boolean> {
    try {
      await this.db.knowledgeItem.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  public async stats(): Promise<{ totalItems: number; totalCategories: number }> {
    const [totalItems, categories] = await Promise.all([
      this.db.knowledgeItem.count(),
      this.db.knowledgeItem.findMany({ select: { category: true }, distinct: ["category"] }),
    ]);
    return { totalItems, totalCategories: categories.length };
  }
}
