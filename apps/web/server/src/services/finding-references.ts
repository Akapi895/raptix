/** Finding references resolve through managed assets, owned executions and the canonical technique corpus. */
import type { PrismaClient } from '../generated/prisma/client.js';
import type { LibraryService } from './library-service.js';
import { ProjectApiError } from './projects-service.js';
import type { FindingReferences, FindingReferenceOptions } from '@raptix/web-contracts';
export type { FindingReferences } from '@raptix/web-contracts';

export async function resolveFindingReferences(
  db: PrismaClient, engagementId: string, value: unknown, library?: Pick<LibraryService, 'techniqueDetail'>,
): Promise<FindingReferences> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProjectApiError(400, 'references must be an object.');
  const input = value as Record<string, unknown>;
  const refs: FindingReferences = { assetId: null, bindingId: null, threadId: null, runId: null, techniqueId: null };
  for (const key of Object.keys(refs) as (keyof FindingReferences)[]) {
    const field = input[key];
    if (field !== undefined && field !== null && (typeof field !== 'string' || !field.trim() || field.length > 256)) throw new ProjectApiError(400, `${key} must be an identity or null.`);
    refs[key] = typeof field === 'string' ? field.trim() : null;
  }
  if (refs.assetId && !await db.webAsset.findFirst({ where: { id: refs.assetId, engagementId } })) throw new ProjectApiError(404, 'Managed asset not found in this engagement.');
  if (refs.bindingId) {
    const binding = await db.operationBinding.findFirst({ where: { id: refs.bindingId, engagementId } });
    if (!binding || binding.threadId !== refs.threadId) throw new ProjectApiError(404, 'Execution binding not found for this engagement/thread.');
  }
  if ((refs.runId || refs.bindingId) && !refs.threadId) throw new ProjectApiError(400, 'An execution run/binding requires its owned threadId.');
  if (refs.threadId && !await db.engagementThread.findFirst({ where: { threadId: refs.threadId, engagementId, kind: 'execution' } })) throw new ProjectApiError(404, 'Owned execution thread not found.');
  if (refs.runId && !await db.webRequestLedger.findFirst({ where: { engagementId, threadId: refs.threadId, runId: refs.runId } })) throw new ProjectApiError(404, 'Owned execution run not found.');
  if (refs.techniqueId) {
    if (!library) throw new ProjectApiError(503, 'Canonical technique lookup is unavailable.');
    const technique = await library.techniqueDetail(refs.techniqueId);
    refs.techniqueId = technique.id;
  }
  return refs;
}

export async function findingReferenceOptions(db: PrismaClient, engagementId: string, techniqueAvailable: boolean): Promise<FindingReferenceOptions> {
  const [assets, threads, bindings, runs] = await Promise.all([
    db.webAsset.findMany({ where: { engagementId }, orderBy: { id: 'asc' }, take: 201 }),
    db.engagementThread.findMany({ where: { engagementId, kind: 'execution' }, orderBy: { threadId: 'asc' }, take: 201 }),
    db.operationBinding.findMany({ where: { engagementId }, orderBy: { id: 'asc' }, take: 201 }),
    db.webRequestLedger.findMany({ where: { engagementId, runId: { not: null } }, orderBy: { id: 'asc' }, take: 201 }),
  ]);
  const owned = new Set(threads.slice(0, 200).map((thread) => thread.threadId));
  const executions = threads.slice(0, 200).map((thread) => ({ threadId: thread.threadId, runId: null as string | null, bindingId: null as string | null }));
  for (const run of runs.slice(0, 200)) if (run.threadId && owned.has(run.threadId)) executions.push({ threadId: run.threadId, runId: run.runId, bindingId: null });
  for (const binding of bindings.slice(0, 200)) if (binding.threadId && owned.has(binding.threadId)) executions.push({ threadId: binding.threadId, runId: null, bindingId: binding.id });
  return { engagementId, assets: assets.slice(0, 200).map((asset) => ({ id: asset.id, label: asset.identifier })), executions, techniqueAvailable, truncated: [assets, threads, bindings, runs].some((rows) => rows.length > 200) };
}
