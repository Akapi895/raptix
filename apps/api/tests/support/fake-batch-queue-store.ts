import type {
  BatchQueueRecord,
  BatchQueueStore,
  BatchTaskRecord,
  CreateQueueInput,
  ListQueuesQuery,
} from "../../src/db/batch-queue-store.js";

export class FakeBatchQueueStore implements BatchQueueStore {
  private readonly queues = new Map<string, BatchQueueRecord>();
  private readonly tasks = new Map<string, BatchTaskRecord>();
  private nextQueueId = 1;
  private nextTaskId = 1;

  private tasksFor(queueId: string): BatchTaskRecord[] {
    return [...this.tasks.values()].filter((t) => t.queueId === queueId).sort((a, b) => a.position - b.position);
  }

  private withTasks(queue: Omit<BatchQueueRecord, "tasks">): BatchQueueRecord {
    return { ...queue, tasks: this.tasksFor(queue.id) };
  }

  public async list(query: ListQueuesQuery): Promise<{ queues: BatchQueueRecord[]; total: number }> {
    let rows = [...this.queues.values()];
    if (query.status) rows = rows.filter((q) => q.status === query.status);
    if (query.search) rows = rows.filter((q) => q.title.toLowerCase().includes(query.search!.toLowerCase()));
    const total = rows.length;
    return { queues: rows.slice(query.offset, query.offset + query.limit).map((q) => this.withTasks(q)), total };
  }

  public async create(input: CreateQueueInput): Promise<BatchQueueRecord> {
    const id = `queue-${this.nextQueueId++}`;
    const queue: Omit<BatchQueueRecord, "tasks"> = {
      id,
      title: input.title,
      role: input.role ?? "",
      hitlPolicy: input.hitlPolicy ?? "",
      scheduleMode: input.scheduleMode ?? "manual",
      cronExpr: input.cronExpr ?? "",
      scheduleEnabled: true,
      nextRunAt: null,
      lastScheduleTriggerAt: null,
      lastScheduleError: null,
      lastRunError: null,
      projectId: input.projectId ?? null,
      concurrency: input.concurrency ?? 1,
      status: "pending",
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      currentIndex: 0,
    };
    this.queues.set(id, { ...queue, tasks: [] });
    input.messages.forEach((message, index) => {
      const taskId = `task-${this.nextTaskId++}`;
      this.tasks.set(taskId, { id: taskId, queueId: id, position: index, message, conversationId: null, status: "pending", startedAt: null, completedAt: null, error: null, result: null });
    });
    return this.withTasks(queue);
  }

  public async findById(id: string): Promise<BatchQueueRecord | null> {
    const queue = this.queues.get(id);
    return queue ? this.withTasks(queue) : null;
  }

  public async updateMetadata(id: string, fields: { title?: string; role?: string; concurrency?: number; hitlPolicy?: string }): Promise<BatchQueueRecord | null> {
    const existing = this.queues.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
    this.queues.set(id, updated);
    return this.withTasks(updated);
  }

  public async updateSchedule(id: string, fields: { scheduleMode?: string; cronExpr?: string }): Promise<BatchQueueRecord | null> {
    const existing = this.queues.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
    this.queues.set(id, updated);
    return this.withTasks(updated);
  }

  public async setScheduleEnabled(id: string, enabled: boolean): Promise<BatchQueueRecord | null> {
    const existing = this.queues.get(id);
    if (!existing) return null;
    const updated = { ...existing, scheduleEnabled: enabled };
    this.queues.set(id, updated);
    return this.withTasks(updated);
  }

  public async setStatus(id: string, status: string, extra: { startedAt?: Date; completedAt?: Date; lastRunError?: string | null; currentIndex?: number } = {}): Promise<void> {
    const existing = this.queues.get(id);
    if (!existing) return;
    this.queues.set(id, { ...existing, status, ...extra });
  }

  public async delete(id: string): Promise<boolean> {
    for (const taskId of [...this.tasks.values()].filter((t) => t.queueId === id).map((t) => t.id)) this.tasks.delete(taskId);
    return this.queues.delete(id);
  }

  public async addTask(queueId: string, message: string): Promise<BatchTaskRecord | null> {
    if (!this.queues.has(queueId)) return null;
    const taskId = `task-${this.nextTaskId++}`;
    const task: BatchTaskRecord = { id: taskId, queueId, position: this.tasksFor(queueId).length, message, conversationId: null, status: "pending", startedAt: null, completedAt: null, error: null, result: null };
    this.tasks.set(taskId, task);
    return task;
  }

  public async deleteTask(queueId: string, taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.queueId !== queueId) return false;
    return this.tasks.delete(taskId);
  }

  public async updateTask(queueId: string, taskId: string, fields: { message?: string }): Promise<BatchTaskRecord | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.queueId !== queueId) return null;
    const updated = { ...task, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
    this.tasks.set(taskId, updated);
    return updated;
  }

  public async resetTasks(queueId: string, taskIds?: string[]): Promise<number> {
    let count = 0;
    for (const task of this.tasksFor(queueId)) {
      if (!["failed", "cancelled"].includes(task.status)) continue;
      if (taskIds && !taskIds.includes(task.id)) continue;
      this.tasks.set(task.id, { ...task, status: "pending", error: null, completedAt: null, startedAt: null });
      count += 1;
    }
    return count;
  }

  public async setTaskRunning(taskId: string, conversationId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) this.tasks.set(taskId, { ...task, status: "running", startedAt: new Date(), conversationId });
  }

  public async setTaskResult(taskId: string, fields: { status: string; result?: string; error?: string }): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) this.tasks.set(taskId, { ...task, ...fields, result: fields.result ?? null, error: fields.error ?? null, completedAt: new Date() });
  }

  public async claimNextTask(queueId: string): Promise<BatchTaskRecord | null> {
    const next = this.tasksFor(queueId).find((t) => t.status === "pending");
    if (!next) return null;
    const claimed = { ...next, status: "claimed" };
    this.tasks.set(next.id, claimed);
    return claimed;
  }

  public async listRuns(offset: number, limit: number): Promise<{ runs: (BatchTaskRecord & { queueTitle: string })[]; hasMore: boolean }> {
    const rows = [...this.tasks.values()]
      .filter((t) => ["completed", "failed", "cancelled"].includes(t.status))
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
      .map((t) => ({ ...t, queueTitle: this.queues.get(t.queueId)?.title ?? "" }));
    const page = rows.slice(offset, offset + limit);
    return { runs: page, hasMore: rows.length > offset + limit };
  }
}
