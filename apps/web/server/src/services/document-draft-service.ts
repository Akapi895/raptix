import { createHash, randomBytes } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PLANNING_DOCUMENTS, type PlanningDocumentName, type DocumentSourceView } from '@raptix/web-contracts';
import { requireEngagementAccess, type ActorContext } from '../auth/membership-policy.js';
import { assertEngagementOpen } from './closure-service.js';
import { validateDocument, readDocumentSource, projectContentFor } from './planning-service.js';
import { prepareEngagementPlanDir } from '../security/workspace-policy.js';
import { ProjectApiError } from './projects-service.js';

/**
 * O06 (ADR-0083): persistent drafts for the allowlisted planning documents.
 * Drafts live in Postgres; the published file stays the single authority the
 * runtime reads. Every mutation carries the digest the editor loaded, so a
 * concurrent browser edit or a model rewrite answers 409 instead of clobbering
 * work. ROE is never publishable here — ScopeService is the governance
 * authority for ROE and the runtime file is its machine authority.
 */

const MIN_WRITE = 'operator' as const;
const MAX_BODY_BYTES = 1024 * 1024;

export class DocumentDraftService {
  public constructor(private readonly db: PrismaClient, private readonly workspaceRoot: string) {}

  private ctx(actorId: string): ActorContext {
    return { db: this.db, actorId, multiUser: true };
  }

  private static name(value: unknown): PlanningDocumentName {
    if (typeof value !== 'string' || !PLANNING_DOCUMENTS.includes(value as PlanningDocumentName)) {
      throw new ProjectApiError(404, 'Document not found');
    }
    return value as PlanningDocumentName;
  }

  private async slug(engagementId: string): Promise<string> {
    const engagement = await this.db.engagement.findFirst({ where: { id: engagementId }, select: { workspaceSlug: true } });
    if (engagement === null) throw new ProjectApiError(404, 'Project not found');
    return engagement.workspaceSlug;
  }

  private static digest(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }

  private static parseInput(input: unknown): { body: string; baseDigest: string | null } {
    const value = (input ?? {}) as { body?: unknown; baseDigest?: unknown };
    if (typeof value.body !== 'string' || Buffer.byteLength(value.body, 'utf8') > MAX_BODY_BYTES) {
      throw new ProjectApiError(400, 'body must be a string of at most 1 MiB of UTF-8 JSON.');
    }
    if (value.baseDigest !== null && typeof value.baseDigest !== 'string') {
      throw new ProjectApiError(400, 'baseDigest must be the digest string the editor loaded, or null for a missing document.');
    }
    return { body: value.body, baseDigest: value.baseDigest };
  }

  /** Validation of one candidate document body: JSON parse + schema. */
  private static validation(name: PlanningDocumentName, body: string): { valid: boolean; errors: string[]; payload: unknown } {
    let payload: unknown;
    try { payload = JSON.parse(body); } catch (error) {
      return { valid: false, errors: [`Body is not valid JSON: ${(error as Error).message}`], payload: undefined };
    }
    const errors = validateDocument(name, payload);
    return { valid: errors.length === 0, errors, payload };
  }

  private static assertPrecondition(currentDigest: string | null, baseDigest: string | null): void {
    if (currentDigest === baseDigest) return;
    throw new ProjectApiError(409, currentDigest === null
      ? 'The document was deleted after this draft was loaded; reload the document and reapply your edit.'
      : `The document changed after this draft was loaded (current digest ${currentDigest.slice(0, 12)}); reload the document and reapply your edit.`);
  }

  private async audit(engagementId: string, actorId: string, action: string, name: string, reason: string): Promise<void> {
    await this.db.webAuditEntry.create({ data: { engagementId, actorId, action, targetType: 'plan_document', targetId: name, reason } });
  }

  public async source(actorId: string, engagementId: string, rawName: unknown): Promise<DocumentSourceView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, 'viewer');
    const name = DocumentDraftService.name(rawName);
    const slug = await this.slug(engagementId);
    const raw = await readDocumentSource(this.workspaceRoot, slug, name);
    const draft = await this.db.planDocumentDraft.findUnique({ where: { engagementId_name: { engagementId, name } } });
    if (raw.state !== 'present') {
      return {
        version: 1, engagementId, name, state: raw.state === 'oversized' ? 'invalid' : raw.state,
        digest: null, updatedAt: null, sizeBytes: 0, source: null,
        validation: { valid: false, errors: raw.state === 'oversized' ? ['The stored document exceeds the 1 MiB bound and cannot be edited here.'] : [] },
        readable: null,
        draft: draft === null ? null : { body: draft.body, baseDigest: draft.baseDigest, updatedBy: draft.updatedBy, updatedAt: draft.updatedAt.toISOString() },
      };
    }
    const parsed = DocumentDraftService.validation(name, raw.text);
    return {
      version: 1, engagementId, name,
      state: parsed.valid ? 'ready' : 'invalid',
      digest: DocumentDraftService.digest(raw.text), updatedAt: raw.updatedAt,
      sizeBytes: Buffer.byteLength(raw.text, 'utf8'),
      source: raw.text,
      validation: { valid: parsed.valid, errors: parsed.errors },
      readable: parsed.valid ? projectContentFor(name, parsed.payload as Record<string, unknown>) : null,
      draft: draft === null ? null : { body: draft.body, baseDigest: draft.baseDigest, updatedBy: draft.updatedBy, updatedAt: draft.updatedAt.toISOString() },
    };
  }

  public async saveDraft(actorId: string, engagementId: string, rawName: unknown, input: unknown): Promise<DocumentSourceView> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_WRITE);
    await assertEngagementOpen(this.db, engagementId);
    const name = DocumentDraftService.name(rawName);
    const { body, baseDigest } = DocumentDraftService.parseInput(input);
    const slug = await this.slug(engagementId);
    const raw = await readDocumentSource(this.workspaceRoot, slug, name);
    if (raw.state === 'unavailable') throw new ProjectApiError(409, 'The document source is unavailable; the edit precondition cannot be proven.');
    const currentDigest = raw.state === 'present' ? DocumentDraftService.digest(raw.text) : null;
    DocumentDraftService.assertPrecondition(currentDigest, baseDigest);
    const parsed = DocumentDraftService.validation(name, body);
    if (!parsed.valid) throw new ProjectApiError(400, `The document does not satisfy the ${name} schema: ${parsed.errors.join('; ')}`);
    await this.db.planDocumentDraft.upsert({
      where: { engagementId_name: { engagementId, name } },
      create: { engagementId, name, baseDigest, body, updatedBy: actorId },
      update: { baseDigest, body, updatedBy: actorId },
    });
    await this.audit(engagementId, actorId, 'document.draft_saved', name, `base ${baseDigest === null ? 'missing' : baseDigest.slice(0, 12)}`);
    return this.source(actorId, engagementId, name);
  }

  public async discardDraft(actorId: string, engagementId: string, rawName: unknown): Promise<{ discarded: boolean }> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_WRITE);
    const name = DocumentDraftService.name(rawName);
    const existing = await this.db.planDocumentDraft.findUnique({ where: { engagementId_name: { engagementId, name } } });
    if (existing === null) return { discarded: false };
    await this.db.planDocumentDraft.delete({ where: { engagementId_name: { engagementId, name } } });
    await this.audit(engagementId, actorId, 'document.draft_discarded', name, `base ${existing.baseDigest === null ? 'missing' : existing.baseDigest.slice(0, 12)}`);
    return { discarded: true };
  }

  public async publish(actorId: string, engagementId: string, rawName: unknown, input: unknown): Promise<{ name: PlanningDocumentName; digest: string; updatedAt: string }> {
    await requireEngagementAccess(this.ctx(actorId), engagementId, MIN_WRITE);
    await assertEngagementOpen(this.db, engagementId);
    const name = DocumentDraftService.name(rawName);
    if (name === 'roe') {
      throw new ProjectApiError(409, 'ROE is governed by the Scope & ROE revision workflow; submit a scope revision instead of publishing the file directly.');
    }
    const { body, baseDigest } = DocumentDraftService.parseInput(input);
    const slug = await this.slug(engagementId);
    const raw = await readDocumentSource(this.workspaceRoot, slug, name);
    if (raw.state === 'unavailable') throw new ProjectApiError(409, 'The document source is unavailable; the publish precondition cannot be proven.');
    const currentDigest = raw.state === 'present' ? DocumentDraftService.digest(raw.text) : null;
    DocumentDraftService.assertPrecondition(currentDigest, baseDigest);
    const parsed = DocumentDraftService.validation(name, body);
    if (!parsed.valid) throw new ProjectApiError(400, `The document does not satisfy the ${name} schema: ${parsed.errors.join('; ')}`);
    const planDir = await prepareEngagementPlanDir(this.workspaceRoot, slug);
    const target = path.join(planDir, `${name}.json`);
    const temp = path.join(planDir, `.${name}.json.${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(temp, body, { encoding: 'utf8', flag: 'wx' });
    try {
      await rename(temp, target);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
    const written = await readDocumentSource(this.workspaceRoot, slug, name);
    if (written.state !== 'present') throw new ProjectApiError(500, 'The published document could not be read back; inspect the workspace before retrying.');
    await this.db.planDocumentDraft.deleteMany({ where: { engagementId, name } });
    await this.audit(engagementId, actorId, 'document.published', name, `base ${baseDigest === null ? 'missing' : baseDigest.slice(0, 12)}`);
    return { name, digest: DocumentDraftService.digest(written.text), updatedAt: written.updatedAt };
  }
}
