import type { WorkflowFields, WorkflowRecord, WorkflowStore } from "../../src/db/workflow-store.js";

export class FakeWorkflowStore implements WorkflowStore {
  private workflows = new Map<string, WorkflowRecord>();
  private nextId = 1;

  public async list(includeDisabled: boolean): Promise<WorkflowRecord[]> {
    const all = [...this.workflows.values()];
    return (includeDisabled ? all : all.filter((workflow) => workflow.enabled)).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
  }

  public async get(id: string): Promise<WorkflowRecord | null> {
    return this.workflows.get(id) ?? null;
  }

  public async create(id: string | undefined, fields: WorkflowFields): Promise<WorkflowRecord> {
    const now = new Date();
    const resolvedId = id ?? `workflow-${this.nextId++}`;
    const workflow: WorkflowRecord = {
      id: resolvedId,
      name: fields.name,
      description: fields.description ?? "",
      version: 1,
      enabled: fields.enabled ?? true,
      graphJson: fields.graphJson,
      validationError: "",
      createdAt: now,
      updatedAt: now,
    };
    this.workflows.set(resolvedId, workflow);
    return workflow;
  }

  public async update(id: string, fields: WorkflowFields): Promise<WorkflowRecord | null> {
    const existing = this.workflows.get(id);
    if (!existing) return null;
    const updated: WorkflowRecord = {
      ...existing,
      name: fields.name,
      description: fields.description ?? "",
      enabled: fields.enabled ?? true,
      graphJson: fields.graphJson,
      version: existing.version + 1,
      updatedAt: new Date(),
    };
    this.workflows.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    return this.workflows.delete(id);
  }
}
