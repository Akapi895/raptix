import { z } from 'zod';
import type { Translate } from '../workflows';

// internal/handler/batch_task_manager.go (camelCase, unlike workflow definitions).
export const taskSchema = z.object({
  id: z.string(), message: z.string().default(''), conversationId: z.string().optional(), status: z.string(),
  startedAt: z.string().nullish(), completedAt: z.string().nullish(), error: z.string().optional(), result: z.string().optional(),
});
export const queueSchema = z.object({
  workflowId: z.string().default(''),
  id: z.string(), title: z.string().default(''), role: z.string().default(''), hitlPolicy: z.string().default(''),
  scheduleMode: z.string().default('manual'), cronExpr: z.string().default(''),
  nextRunAt: z.string().nullish(), scheduleEnabled: z.boolean().default(true), lastScheduleTriggerAt: z.string().nullish(),
  lastScheduleError: z.string().optional(), lastRunError: z.string().optional(), projectId: z.string().optional(), concurrency: z.number().default(1),
  tasks: z.array(taskSchema).nullish().transform(tasks => tasks ?? []), status: z.string(), createdAt: z.string(),
  startedAt: z.string().nullish(), completedAt: z.string().nullish(), currentIndex: z.number().default(0),
});
export type BatchTask = z.infer<typeof taskSchema>;
export const batchRunSchema = taskSchema.omit({ id: true }).extend({ conversationId: z.string(), queueId: z.string(), taskId: z.string(), title: z.string(), workflowId: z.string() });
export type BatchQueue = z.infer<typeof queueSchema>;
export const activeTaskSchema = z.object({
  conversationId: z.string(), title: z.string().optional(), message: z.string().default(''), status: z.string().default('completed'),
  startedAt: z.string().nullish(), completedAt: z.string().nullish(), cleanupError: z.string().optional(), isHistory: z.boolean().optional(),
});
export type ActiveTask = z.infer<typeof activeTaskSchema>;
export interface QueueInput { workflowId?: string; title: string; role: string; hitlPolicy: string; scheduleMode: string; cronExpr: string; executeNow: boolean; projectId: string; concurrency: number; tasks: string[] }
export type QueueMetadata = Pick<BatchQueue, 'title' | 'role'> & Partial<Pick<BatchQueue, 'concurrency' | 'hitlPolicy'>>;
export const hitlPolicies: Record<string, string> = { '': 'hitlInherit', off: 'hitlOff', human: 'hitlHuman', audit_agent: 'hitlAgent', review_edit: 'hitlReviewEdit' };
export const canMutate = (queue: BatchQueue): boolean => ['pending', 'paused', 'completed', 'cancelled'].includes(queue.status) && !queue.tasks.some(task => task.status === 'running');
export const canRunSingle = (queue: BatchQueue, task: BatchTask): boolean => task.status !== 'running' && ['pending', 'paused', 'completed', 'cancelled'].includes(queue.status);
export const clampConcurrency = (value: string | number): number => Math.min(8, Math.max(1, Number.parseInt(String(value), 10) || 1));
export function validateSchedule(mode: string, cron: string): string | null {
  if (mode !== 'cron') return null;
  if (!cron.trim()) return 'batchImportModal.cronExprRequired';
  return /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(cron.trim()) ? null : 'batchImportModal.cronExprInvalid';
}
export function queuePresentation(queue: BatchQueue, t: Translate): { text: string; class: string; sublabel: string; progressNote: string; callout: string } {
  const keys: Record<string, string> = { pending: 'Pending', running: 'Running', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled' };
  const base = { text: keys[queue.status] ? t('tasks.status' + keys[queue.status]) : queue.status, class: 'batch-queue-status-' + (keys[queue.status] ? queue.status : 'unknown'), sublabel: '', progressNote: '', callout: '' };
  const cron = queue.scheduleMode === 'cron' && queue.scheduleEnabled;
  const time = queue.nextRunAt ? new Date(queue.nextRunAt).toLocaleString() : '';
  const failed = queue.tasks.filter(task => task.status === 'failed').length;
  if (queue.status === 'completed' && failed) return { ...base, text: t(failed === queue.tasks.length ? 'tasks.statusFailed' : 'tasks.statusEndedWithFailures', { count: failed }), class: 'batch-queue-status-failed', sublabel: cron && time ? t('tasks.cronNextRunLine', { time }) : '', progressNote: t('tasks.finishedProgressHint'), callout: cron ? t('tasks.cronRecurringCallout') : '' };
  if (cron && queue.status === 'completed') return { ...base, text: t('tasks.statusCronCycleIdle'), class: 'batch-queue-status-cron-cycle', sublabel: time ? t('tasks.cronNextRunLine', { time }) : '', progressNote: t('tasks.cronRoundDoneProgressHint'), callout: t('tasks.cronRecurringCallout') };
  if (cron && queue.status === 'running') return { ...base, text: t('tasks.statusCronRunning'), class: 'batch-queue-status-running batch-queue-cron-active', sublabel: time ? t('tasks.cronNextRunLine', { time }) : '', progressNote: t('tasks.cronRunningProgressHint') };
  if (cron && queue.status === 'pending' && time) return { ...base, sublabel: t('tasks.cronPendingScheduled', { time }), progressNote: t('tasks.cronPendingProgressNote') };
  return base;
}
