/** Bounded, version-pinned pages over append-only finding workflow records. */
import type { PrismaClient } from '../generated/prisma/client.js';
import { ProjectApiError } from './projects-service.js';
import type { FindingActivityKind, FindingActivityPage } from '@raptix/web-contracts';
export type { FindingActivityKind, FindingActivityPage } from '@raptix/web-contracts';

export async function readFindingActivity(
  db: PrismaClient, engagementId: string, findingId: string, kind: FindingActivityKind,
  version: number, cursor: string | null = null, limit = 20,
): Promise<FindingActivityPage> {
  if (cursor !== null) {
    const args = { where: { id: cursor, engagementId, findingId, findingVersion: { lte: version } } };
    const cursorRow = kind === 'comments' ? await db.findingComment.findFirst(args) : kind === 'history' ? await db.findingHistory.findFirst(args) : await db.findingRetest.findFirst(args);
    if (cursorRow === null) throw new ProjectApiError(400, 'The activity cursor does not belong to this finding and version.');
  }
  const args = {
    where: { engagementId, findingId, findingVersion: { lte: version } },
    orderBy: [{ findingVersion: 'desc' as const }, { id: 'desc' as const }], take: limit + 1,
    ...(cursor === null ? {} : { cursor: { id: cursor }, skip: 1 }),
  };
  const rows = kind === 'comments' ? await db.findingComment.findMany(args) : kind === 'history' ? await db.findingHistory.findMany(args) : await db.findingRetest.findMany(args);
  const page = rows.slice(0, limit);
  return {
    engagementId, findingId, kind, version,
    nextCursor: rows.length > limit ? page.at(-1)!.id : null,
    items: page.map((row) => {
      const action = 'action' in row ? row.action : 'result' in row ? 'retested' : 'commented';
      const reason = 'reason' in row ? row.reason : null;
      const note = 'note' in row ? row.note : null;
      const text = 'text' in row ? row.text : 'result' in row ? `Retest: ${row.result}${note ? `: ${note}` : ''}` : `${action}${reason ? `: ${reason}` : ''}`;
      return {
        id: row.id, actorId: row.actorId, createdAt: row.createdAt.toISOString(), findingVersion: row.findingVersion,
        text, action, reason, fromStatus: 'fromStatus' in row ? row.fromStatus : null,
        toStatus: 'toStatus' in row ? row.toStatus : null, result: 'result' in row ? row.result : null,
        note, evidenceRefs: 'evidenceRefs' in row && Array.isArray(row.evidenceRefs) ? row.evidenceRefs.filter((ref): ref is string => typeof ref === 'string') : [],
      };
    }),
  };
}
