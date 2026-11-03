import { randomUUID } from "node:crypto";
import { runConfigurableFor } from "../adapters/sandbox/routing.js";
import type { RuntimeTransport } from "../adapters/runtime/client.js";
import type { BatchQueueStore } from "../db/batch-queue-store.js";
import type { ConversationStore } from "../db/conversation-store.js";
import type { ProjectStore } from "../db/project-store.js";
import { runAgentTurn } from "./agent-turn.js";
import type { SpecialistConfigurationService } from './specialist-configuration.js';

export interface BatchProcessorDeps {
  knowledgeConfiguration?: import('./knowledge-configuration.js').KnowledgeConfigurationService;
  specialistConfiguration?: SpecialistConfigurationService;
  store: BatchQueueStore;
  conversationStore: ConversationStore;
  runtime: RuntimeTransport;
  defaultAssistantId: string;
  taskWaitMs: number;
  projectStore: ProjectStore;
  sandboxKey?: string;
}

/**
 * Runs a queue's pending tasks with up to `concurrency` workers in parallel,
 * each dispatching through the same path POST /api/eino-agent uses
 * (services/agent-turn.ts). Fire-and-forget from the route's point of view
 * (see batch-tasks.routes.ts's start handler) -- progress is visible by
 * polling the queue/task rows this writes to as it goes. No cron auto-
 * trigger and no crash recovery: if the process restarts mid-run, tasks
 * left in "claimed" stay that way (the same class of limitation as Tier 2's
 * fire-and-forget conversation runs, not something this pass solves).
 */
export async function startBatchQueue(queueId: string, deps: BatchProcessorDeps): Promise<void> {
  const queue = await deps.store.findById(queueId);
  if (!queue) return;

  await deps.store.setStatus(queueId, "running", { startedAt: new Date() });

  const concurrency = Math.max(1, Math.min(8, queue.concurrency));
  await Promise.all(Array.from({ length: concurrency }, () => runWorker(queueId, queue, deps)));

  const finished = await deps.store.findById(queueId);
  const failed = finished?.tasks.filter((task) => task.status === "failed").length ?? 0;
  await deps.store.setStatus(queueId, "completed", {
    completedAt: new Date(),
    lastRunError: failed > 0 ? `${failed} task(s) failed` : null,
  });
}

async function runWorker(
  queueId: string,
  queue: { projectId: string | null; role: string },
  deps: BatchProcessorDeps,
): Promise<void> {
  for (;;) {
    const task = await deps.store.claimNextTask(queueId);
    if (task === null) {
      // Either no pending tasks remain, or another worker just claimed the one we saw --
      // re-check once more before giving up this worker's loop.
      const stillPending = await deps.store.findById(queueId);
      if (!stillPending?.tasks.some((t) => t.status === "pending")) return;
      continue;
    }

    try {
      let conversation = task.conversationId ? await deps.conversationStore.findById(task.conversationId) : null;
      if (!conversation) {
        const runtimeThreadId = randomUUID();
        await deps.runtime.createThread(runtimeThreadId);
        conversation = await deps.conversationStore.create({
          title: task.message.length > 80 ? `${task.message.slice(0, 77)}...` : task.message,
          projectId: queue.projectId ?? undefined,
          roleName: queue.role || undefined,
          runtimeThreadId,
        });
      }

      await deps.store.setTaskRunning(task.id, conversation.id);
      // Best-effort: a queue not tied to a project (or no sandbox key configured) runs
      // against the runtime's default sandbox, same as before this was threaded through.
      const project = queue.projectId && deps.sandboxKey ? await deps.projectStore.findById(queue.projectId) : null;
      const config = project && deps.sandboxKey ? {
        configurable: {
          ...runConfigurableFor(project.workspaceSlug, deps.sandboxKey),
          graph_toggles: {
            auto_ingest_enabled: project.autoIngestEnabled,
            tried_edges_enabled: project.triedEdgesEnabled,
          },
        },
        recursion_limit: 1000,
      } : undefined;
      const turn = await runAgentTurn({
        knowledgeConfiguration: deps.knowledgeConfiguration,
        specialistConfiguration: deps.specialistConfiguration,
        conversation,
        message: task.message,
        runtime: deps.runtime,
        conversationStore: deps.conversationStore,
        defaultAssistantId: deps.defaultAssistantId,
        waitMs: deps.taskWaitMs,
        config,
      });

      const succeeded = turn.finalized && turn.status === "success";
      await deps.store.setTaskResult(task.id, {
        status: succeeded ? "completed" : "failed",
        ...(succeeded ? { result: turn.response } : { error: turn.response }),
      });
    } catch (error) {
      await deps.store.setTaskResult(task.id, { status: "failed", error: (error as Error).message });
    }
  }
}
