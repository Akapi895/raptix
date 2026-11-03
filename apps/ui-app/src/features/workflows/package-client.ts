import { z } from 'zod';
import type { RequestFn } from './model';

export type ImportAction = 'create' | 'keep_existing' | 'overwrite' | 'rename';
export class WorkflowPackageError extends Error {
  constructor(public readonly code = '', message = code || 'WFPKG_REQUEST_FAILED', public readonly details: Record<string, unknown> = {}) {
    super(message || code || 'WFPKG_REQUEST_FAILED'); this.name = 'WorkflowPackageError';
  }
}
const actions: Record<string, readonly ImportAction[]> = { none: ['create'], identical: ['keep_existing'], id_conflict: ['keep_existing', 'overwrite', 'rename'] };
export function allowedActions(conflict: string): ImportAction[] { return [...actions[conflict] ?? []]; }
export interface ImportRequest { inspection_id: string; resolution: { action: ImportAction; new_workflow_id: string }; confirm_overwrite: boolean }
export function buildImportRequest(input: { inspectionId?: string; action?: string; newWorkflowId?: string; confirmOverwrite?: boolean } | null = {}): ImportRequest {
  input ??= {};
  const id = (input.inspectionId ?? '').trim(), action = (input.action ?? '').trim(), newId = (input.newWorkflowId ?? '').trim();
  if (!id) throw new WorkflowPackageError('WFPKG_INSPECTION_REQUIRED', 'Inspection record missing');
  if (action !== 'create' && action !== 'keep_existing' && action !== 'overwrite' && action !== 'rename') throw new WorkflowPackageError('WFPKG_INVALID_ACTION', 'Invalid import action');
  if (action === 'rename' && !newId) throw new WorkflowPackageError('WFPKG_INVALID_RENAME_ID', 'Enter a new workflow ID');
  if (action !== 'rename' && newId) throw new WorkflowPackageError('WFPKG_INVALID_ACTION', 'The current action does not allow a new workflow ID');
  if (action === 'overwrite' && input.confirmOverwrite !== true) throw new WorkflowPackageError('WFPKG_OVERWRITE_CONFIRMATION_REQUIRED', 'Confirm overwriting the local workflow');
  return { inspection_id: id, resolution: { action, new_workflow_id: action === 'rename' ? newId : '' }, confirm_overwrite: action === 'overwrite' };
}
export function createIdempotencyKey(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') throw new WorkflowPackageError('WFPKG_IDEMPOTENCY_KEY_REQUIRED', 'The browser could not generate the import request key');
  return crypto.randomUUID();
}
export async function readApiError(response: Response): Promise<{ code: string; message: string; details: Record<string, unknown> }> {
  const raw: unknown = await response.json().catch(() => ({}));
  const parsed = z.object({ error: z.union([z.string(), z.object({ code: z.string().optional(), message: z.string().optional(), details: z.record(z.string(), z.unknown()).optional() })]).optional() }).safeParse(raw);
  const error = parsed.success ? parsed.data.error : undefined;
  return typeof error === 'string' ? { code: '', message: error, details: {} } : { code: error?.code ?? '', message: error?.message ?? '', details: error?.details ?? {} };
}
async function read(response: Response): Promise<unknown> {
  if (response.ok) return response.json() as Promise<unknown>;
  const e = await readApiError(response); throw new WorkflowPackageError(e.code, e.message, e.details);
}
export function validatePackageFile(file: File | null): asserts file is File {
  if (!file) throw new WorkflowPackageError('WFPKG_FILE_REQUIRED', 'Select a local workflow package');
  if (file.size > 10 * 1024 * 1024) throw new WorkflowPackageError('WFPKG_FILE_TOO_LARGE');
  if (!file.name.toLowerCase().endsWith('.csapkg.zip')) throw new WorkflowPackageError('WFPKG_UNSUPPORTED_FORMAT');
}
export async function createInspection(request: RequestFn, file: File | null): Promise<unknown> {
  validatePackageFile(file);
  const body = new FormData(); body.append('file', file, file.name || 'workflow.csapkg.zip');
  return read(await request('/api/workflow-package-inspections', { method: 'POST', body }));
}
export async function getInspection(request: RequestFn, id: string): Promise<unknown> { return read(await request('/api/workflow-package-inspections/' + encodeURIComponent(id))); }
export async function applyImport(request: RequestFn, payload: ImportRequest, key: string): Promise<unknown> {
  if (!key) throw new WorkflowPackageError('WFPKG_IDEMPOTENCY_KEY_REQUIRED', 'Import request key missing');
  return read(await request('/api/workflow-package-imports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) }));
}
export async function getImport(request: RequestFn, id: string): Promise<unknown> { return read(await request('/api/workflow-package-imports/' + encodeURIComponent(id))); }

const inspectionSchema = z.object({
  id: z.string(), status: z.string().default(''), expires_at: z.string().default(''),
  workflow: z.object({ name: z.string().default(''), source_id: z.string().default(''), source_revision: z.number().default(0), node_count: z.number().default(0), edge_count: z.number().default(0), content_hash: z.string().default('') }).prefault({}),
  conflict: z.object({ state: z.enum(['none', 'identical', 'id_conflict']).default('none') }).prefault({}),
  warnings: z.array(z.string()).default([]),
});
const importSchema = z.object({ id: z.string(), result: z.string().default(''), status: z.string().default('') });
export type Inspection = z.infer<typeof inspectionSchema>;
export type ImportRecord = z.infer<typeof importSchema>;
export function decodeInspection(raw: unknown): Inspection {
  const envelope = z.object({ inspection: z.unknown().optional(), inspectionId: z.string().optional() }).passthrough().parse(raw);
  return inspectionSchema.parse(envelope.inspection ?? { ...envelope, id: envelope.id ?? envelope.inspectionId });
}
export function decodeImport(raw: unknown): ImportRecord {
  const envelope = z.object({ import: z.unknown().optional(), importId: z.string().optional() }).passthrough().parse(raw);
  return importSchema.parse(envelope.import ?? { ...envelope, id: envelope.id ?? envelope.importId });
}
