/** Actor-local producer suggestion dispositions survive source rereads and revisions. */
import type { FindingSuggestionDisposition, PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';

export async function writeSuggestionDisposition(db: PrismaClient, actorId: string, engagementId: string, input: unknown): Promise<FindingSuggestionDisposition> {
  const body = (input ?? {}) as Record<string, unknown>;
  const producerRef = typeof body.producerRef === 'string' ? body.producerRef : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!/^findings\/[A-Za-z0-9._-]+\.md$/.test(producerRef) || producerRef.length > 256) throw new ProjectApiError(400, 'A canonical producer findings path is required.');
  if (typeof body.dismissed !== 'boolean' || body.dismissed && (!reason || reason.length > 4000)) throw new ProjectApiError(400, 'Dismissal requires a boolean decision and a reason (1-4000 characters).');
  if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) throw new ProjectApiError(400, 'expectedVersion is required (0 for an unseen suggestion).');
  const expectedVersion = Number(body.expectedVersion);
  const dismissed = body.dismissed;
  const where = { engagementId, actorId, producerRef };
  const existing = await db.findingSuggestionDisposition.findFirst({ where });
  if (existing && existing.dismissed === dismissed && existing.reason === (reason || null)) return existing;
  if ((existing?.version ?? 0) !== expectedVersion) throw new ProjectApiError(409, 'The suggestion disposition changed. Reload and retry.');
  try {
    return await db.$transaction(async (tx) => {
      let saved;
      if (existing) {
        const updated = await tx.findingSuggestionDisposition.updateMany({ where: { ...where, version: expectedVersion }, data: { dismissed, reason: reason || null, version: { increment: 1 } } });
        if (updated.count !== 1) throw new ProjectApiError(409, 'The suggestion disposition changed. Reload and retry.');
        saved = await tx.findingSuggestionDisposition.findFirst({ where });
      } else {
        saved = await tx.findingSuggestionDisposition.create({ data: { ...where, dismissed, reason: reason || null } });
      }
      await tx.webAuditEntry.create({ data: { engagementId, actorId, action: dismissed ? 'suggestion.dismissed' : 'suggestion.restored', targetType: 'producer-finding', targetId: producerRef, reason: reason || null } });
      return saved!;
    });
  } catch (error) {
    const replay = await db.findingSuggestionDisposition.findFirst({ where });
    if (replay?.dismissed === dismissed && replay.reason === (reason || null)) return replay;
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw new ProjectApiError(409, 'The suggestion disposition changed. Reload and retry.');
    throw error;
  }
}
