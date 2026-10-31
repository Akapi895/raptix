import type { PrismaClient } from "../generated/prisma/client.js";

export interface BatchTaskRecord {
  id: string;
  queueId: string;
  position: number;
  message: string;
  conversationId: string | null;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  result: string | null;
}

export interface BatchQueueRecord {
  id: string;
  title: string;
  role: string;
  hitlPolicy: string;
  scheduleMode: string;
  cronExpr: string;
  scheduleEnabled: boolean;
  nextRunAt: Date | null;
  lastScheduleTriggerAt: Date | null;
  lastScheduleError: string | null;
  lastRunError: string | null;
  projectId: string | null;
  concurrency: number;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  currentIndex: number;
  tasks: BatchTaskRecord[];
}

export interface ListQueuesQuery {
  status?: string;
  search?: string;
  limit: number;
  offset: number;
}

export interface CreateQueueInput {
  title: string;
  role?: string;
  hitlPolicy?: string;
  scheduleMode?: string;
  cronExpr?: string;
  projectId?: string;
  concurrency?: number;
  messages: string[];
}

export interface BatchQueueStore {
  list(query: ListQueuesQuery): Promise<{ queues: BatchQueueRecord[]; total: number }>;
  create(input: CreateQueueInput): Promise<BatchQueueRecord>;
  findById(id: string): Promise<BatchQueueRecord | null>;
  updateMetadata(id: string, fields: { title?: string; role?: string; concurrency?: number; hitlPolicy?: string }): Promise<BatchQueueRecord | null>;
  updateSchedule(id: string, fields: { scheduleMode?: string; cronExpr?: string }): Promise<BatchQueueRecord | null>;
  setScheduleEnabled(id: string, enabled: boolean): Promise<BatchQueueRecord | null>;
  setStatus(id: string, status: string, extra?: { startedAt?: Date; completedAt?: Date; lastRunError?: string | null; currentIndex?: number }): Promise<void>;
  delete(id: string): Promise<boolean>;
  addTask(queueId: string, message: string): Promise<BatchTaskRecord | null>;
  deleteTask(queueId: string, taskId: string): Promise<boolean>;
  updateTask(queueId: string, taskId: string, fields: { message?: string }): Promise<BatchTaskRecord | null>;
  resetTasks(queueId: string, taskIds?: string[]): Promise<number>;
  setTaskRunning(taskId: string, conversationId: string): Promise<void>;
  setTaskResult(taskId: string, fields: { status: string; result?: string; error?: string }): Promise<void>;
  /** Optimistic claim: returns null if another worker claimed the same row first (caller should try again). */
  claimNextTask(queueId: string): Promise<BatchTaskRecord | null>;
  listRuns(offset: number, limit: number): Promise<{ runs: (BatchTaskRecord & { queueTitle: string })[]; hasMore: boolean }>;
}

export class PrismaBatchQueueStore implements BatchQueueStore {
  public constructor(private readonly db: PrismaClient) {}

  public async list(query: ListQueuesQuery): Promise<{ queues: BatchQueueRecord[]; total: number }> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { title: { contains: query.search, mode: "insensitive" as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.batchQueue.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
        include: { tasks: { orderBy: { position: "asc" } } },
      }),
      this.db.batchQueue.count({ where }),
    ]);
    return { queues: rows, total };
  }

  public async create(input: CreateQueueInput): Promise<BatchQueueRecord> {
    return this.db.batchQueue.create({
      data: {
        title: input.title,
        role: input.role ?? "",
        hitlPolicy: input.hitlPolicy ?? "",
        scheduleMode: input.scheduleMode ?? "manual",
        cronExpr: input.cronExpr ?? "",
        projectId: input.projectId,
        concurrency: input.concurrency ?? 1,
        tasks: { create: input.messages.map((message, index) => ({ message, position: index })) },
      },
      include: { tasks: { orderBy: { position: "asc" } } },
    });
  }

  public async findById(id: string): Promise<BatchQueueRecord | null> {
    return this.db.batchQueue.findUnique({ where: { id }, include: { tasks: { orderBy: { position: "asc" } } } });
  }

  public async updateMetadata(
    id: string,
    fields: { title?: string; role?: string; concurrency?: number; hitlPolicy?: string },
  ): Promise<BatchQueueRecord | null> {
    const exists = await this.db.batchQueue.findUnique({ where: { id } });
    if (!exists) return null;
    return this.db.batchQueue.update({
      where: { id },
      data: Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
      include: { tasks: { orderBy: { position: "asc" } } },
    });
  }

  public async updateSchedule(id: string, fields: { scheduleMode?: string; cronExpr?: string }): Promise<BatchQueueRecord | null> {
    const exists = await this.db.batchQueue.findUnique({ where: { id } });
    if (!exists) return null;
    return this.db.batchQueue.update({
      where: { id },
      data: Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
      include: { tasks: { orderBy: { position: "asc" } } },
    });
  }

  public async setScheduleEnabled(id: string, enabled: boolean): Promise<BatchQueueRecord | null> {
    const exists = await this.db.batchQueue.findUnique({ where: { id } });
    if (!exists) return null;
    return this.db.batchQueue.update({
      where: { id },
      data: { scheduleEnabled: enabled },
      include: { tasks: { orderBy: { position: "asc" } } },
    });
  }

  public async setStatus(
    id: string,
    status: string,
    extra: { startedAt?: Date; completedAt?: Date; lastRunError?: string | null; currentIndex?: number } = {},
  ): Promise<void> {
    await this.db.batchQueue.update({ where: { id }, data: { status, ...extra } }).catch(() => undefined);
  }

  public async delete(id: string): Promise<boolean> {
    try {
      await this.db.batchQueue.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  public async addTask(queueId: string, message: string): Promise<BatchTaskRecord | null> {
    const queue = await this.db.batchQueue.findUnique({ where: { id: queueId }, include: { _count: { select: { tasks: true } } } });
    if (!queue) return null;
    return this.db.batchTask.create({ data: { queueId, message, position: queue._count.tasks } });
  }

  public async deleteTask(queueId: string, taskId: string): Promise<boolean> {
    const result = await this.db.batchTask.deleteMany({ where: { id: taskId, queueId } });
    return result.count > 0;
  }

  public async updateTask(queueId: string, taskId: string, fields: { message?: string }): Promise<BatchTaskRecord | null> {
    const existing = await this.db.batchTask.findFirst({ where: { id: taskId, queueId } });
    if (!existing) return null;
    return this.db.batchTask.update({ where: { id: taskId }, data: fields });
  }

  public async resetTasks(queueId: string, taskIds?: string[]): Promise<number> {
    const result = await this.db.batchTask.updateMany({
      where: { queueId, status: { in: ["failed", "cancelled"] }, ...(taskIds ? { id: { in: taskIds } } : {}) },
      data: { status: "pending", error: null, completedAt: null, startedAt: null },
    });
    return result.count;
  }

  public async setTaskRunning(taskId: string, conversationId: string): Promise<void> {
    await this.db.batchTask.update({ where: { id: taskId }, data: { status: "running", startedAt: new Date(), conversationId } });
  }

  public async setTaskResult(taskId: string, fields: { status: string; result?: string; error?: string }): Promise<void> {
    await this.db.batchTask.update({ where: { id: taskId }, data: { ...fields, completedAt: new Date() } });
  }

  public async claimNextTask(queueId: string): Promise<BatchTaskRecord | null> {
    const candidate = await this.db.batchTask.findFirst({ where: { queueId, status: "pending" }, orderBy: { position: "asc" } });
    if (!candidate) return null;
    // Optimistic claim: the conditional where on status guards against a concurrent worker
    // claiming the same row (Postgres resolves the race; exactly one updateMany wins).
    const claimed = await this.db.batchTask.updateMany({ where: { id: candidate.id, status: "pending" }, data: { status: "claimed" } });
    if (claimed.count === 0) return null;
    return { ...candidate, status: "claimed" };
  }

  public async listRuns(offset: number, limit: number): Promise<{ runs: (BatchTaskRecord & { queueTitle: string })[]; hasMore: boolean }> {
    const rows = await this.db.batchTask.findMany({
      where: { status: { in: ["completed", "failed", "cancelled"] } },
      orderBy: { completedAt: "desc" },
      skip: offset,
      take: limit + 1,
      include: { queue: { select: { title: true } } },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { runs: page.map(({ queue, ...task }) => ({ ...task, queueTitle: queue.title })), hasMore };
  }
}
