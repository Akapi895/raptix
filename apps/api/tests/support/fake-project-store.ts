import type {
  CreateProjectInput,
  ListProjectsQuery,
  ProjectRecord,
  ProjectStore,
  UpdateProjectInput,
} from "../../src/db/project-store.js";

export class FakeProjectStore implements ProjectStore {
  private readonly projects = new Map<string, ProjectRecord>();
  private nextId = 1;

  public async list(query: ListProjectsQuery): Promise<{ projects: ProjectRecord[]; total: number }> {
    let rows = [...this.projects.values()];
    if (query.status) rows = rows.filter((p) => p.status === query.status);
    if (query.search) rows = rows.filter((p) => p.name.toLowerCase().includes(query.search!.toLowerCase()));
    rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const total = rows.length;
    return { projects: rows.slice(query.offset, query.offset + query.limit), total };
  }

  public async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const now = new Date();
    const project: ProjectRecord = {
      id: `proj-${this.nextId++}`,
      name: input.name,
      description: input.description ?? null,
      scopeJson: input.scopeJson ?? null,
      status: input.status ?? "active",
      pinned: false,
      createdAt: now,
      updatedAt: now,
      conversationCount: 0,
    };
    this.projects.set(project.id, project);
    return project;
  }

  public async findById(id: string): Promise<ProjectRecord | null> {
    return this.projects.get(id) ?? null;
  }

  public async update(id: string, input: UpdateProjectInput): Promise<ProjectRecord | null> {
    const existing = this.projects.get(id);
    if (!existing) return null;
    const updated: ProjectRecord = {
      ...existing,
      ...(input.name !== undefined ? { name: input.name ?? existing.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.scopeJson !== undefined ? { scopeJson: input.scopeJson } : {}),
      ...(input.status !== undefined ? { status: input.status ?? existing.status } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned ?? existing.pinned } : {}),
      updatedAt: new Date(),
    };
    this.projects.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    return this.projects.delete(id);
  }

  public async stats(id: string): Promise<{ conversations: number; vulnerabilities: number; assets: number } | null> {
    const project = this.projects.get(id);
    if (!project) return null;
    return { conversations: project.conversationCount, vulnerabilities: 0, assets: 0 };
  }

  public setConversationCount(id: string, count: number): void {
    const project = this.projects.get(id);
    if (project) this.projects.set(id, { ...project, conversationCount: count });
  }
}
