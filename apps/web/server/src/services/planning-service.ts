import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { Ajv } from 'ajv';
import { PLANNING_DOCUMENTS, isPlanningView, type PlanningDocumentName, type PlanningState, type PlanningView } from '@raptix/web-contracts';
import schemas from './planning-schemas.json' with { type: 'json' };
import type { ProjectRecord } from './projects-service.js';

// Generated from the runtime Pydantic models. No coercion of malformed JSON;
// defaults are applied only to the in-memory read, never persisted to disk.
const ajv = new Ajv({ strict: false, useDefaults: true });
const validators = Object.fromEntries(PLANNING_DOCUMENTS.map(name => [name, ajv.compile(schemas[name])]));
const MAX_BYTES = 1024 * 1024;
type ReadDocument = { state: PlanningState; payload?: Record<string, unknown> };
const PUBLIC_FIELDS = {
  roe: ['engagement_name', 'client', 'start_date', 'end_date', 'engagement_type', 'testing_window', 'authorization_reference', 'in_scope', 'out_of_scope', 'prohibited_actions', 'permitted_actions'],
  conops: ['engagement_name', 'executive_summary', 'attack_narrative', 'methodology', 'success_criteria', 'threat_actors'],
  deconfliction: ['engagement_name', 'identifiers', 'notification_procedure', 'soc_contact'],
  opplan: ['engagement_name', 'threat_profile', 'objectives'],
} as const;
const NESTED_FIELDS: Record<string, readonly string[]> = {
  in_scope: ['target', 'type', 'notes'], out_of_scope: ['target', 'type', 'notes'],
  threat_actors: ['name', 'sophistication', 'motivation'], identifiers: ['type', 'value', 'description'],
  objectives: ['id', 'title', 'description', 'phase', 'status', 'blocked_by'],
};

function projectContent(name: keyof typeof PUBLIC_FIELDS, payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(PUBLIC_FIELDS[name].filter(key => payload[key] !== undefined).map(key => {
    const value = payload[key];
    const allowed = NESTED_FIELDS[key];
    return [key, allowed && Array.isArray(value) ? value.map(row => Object.fromEntries(allowed.filter(field => row[field] !== undefined).map(field => [field, row[field]]))) : value];
  }));
}

/** O06: the readable/public view of one document's payload (same projection as the planning view). */
export function projectContentFor(name: PlanningDocumentName, payload: Record<string, unknown>): Record<string, unknown> | null {
  return name in PUBLIC_FIELDS ? projectContent(name as keyof typeof PUBLIC_FIELDS, payload) : null;
}

async function readDocument(root: string, slug: string, name: PlanningDocumentName): Promise<ReadDocument> {
  const raw = await readDocumentSource(root, slug, name);
  if (raw.state !== 'present') return { state: raw.state === 'oversized' ? 'invalid' : raw.state };
  let payload: unknown;
  try { payload = JSON.parse(raw.text); } catch { return { state: 'invalid' }; }
  if (!validators[name]!(payload)) return { state: 'invalid' };
  return { state: 'ready', payload: payload as Record<string, unknown> };
}

/**
 * O06 (ADR-0083): the hardened raw read behind both planning views and the
 * document draft API. Returns the bounded raw bytes when the file is a
 * regular, non-symlink file inside the canonical plan directory, plus the
 * file mtime; `oversized` files are refused without content. Validity is the
 * caller's job (parse + `validateDocument`).
 */
export async function readDocumentSource(root: string, slug: string, name: PlanningDocumentName): Promise<{ state: 'present'; text: string; updatedAt: string } | { state: 'oversized' } | { state: 'missing' } | { state: 'unavailable' }> {
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(root); } catch { return { state: 'unavailable' }; }
  try {
    const segments = [slug, 'plan', `${name}.json`];
    let candidate = canonicalRoot;
    for (const segment of segments) {
      candidate = path.join(candidate, segment);
      const info = await lstat(candidate);
      if (info.isSymbolicLink() || await realpath(candidate) !== candidate) return { state: 'unavailable' };
      if (segment !== segments[2] && !info.isDirectory()) return { state: 'unavailable' };
    }
    const info = await lstat(candidate);
    if (!info.isFile()) return { state: 'unavailable' };
    const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let text: string;
    let updatedAt: string;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev) return { state: 'unavailable' };
      for (let i = 1; i <= segments.length; i++) {
        const expected = path.join(canonicalRoot, ...segments.slice(0, i));
        if ((await lstat(expected)).isSymbolicLink() || await realpath(expected) !== expected) return { state: 'unavailable' };
      }
      if (opened.size > MAX_BYTES) return { state: 'oversized' };
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      if (total > MAX_BYTES) return { state: 'oversized' };
      text = buffer.subarray(0, total).toString('utf8');
      updatedAt = opened.mtime.toISOString();
    } finally { await handle.close(); }
    return { state: 'present', text, updatedAt };
  } catch (error) {
    return { state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable' };
  }
}

/** O06: schema errors for one document's parsed payload, formatted for the draft API. */
export function validateDocument(name: PlanningDocumentName, payload: unknown): string[] {
  if (!validators[name]!(payload)) {
    return (validators[name]!.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
  }
  return [];
}

export async function readPlanningView(workspaceRoot: string, project: ProjectRecord, metadataVerified: boolean): Promise<PlanningView> {
  const entries = await Promise.all(PLANNING_DOCUMENTS.map(async name => [name, await readDocument(workspaceRoot, project.workspaceSlug, name)] as const));
  const reads = Object.fromEntries(entries) as Record<PlanningDocumentName, ReadDocument>;
  const reasons: string[] = [];
  if (!project.authorizationConfirmed) reasons.push('authorization_not_confirmed');
  if (!metadataVerified) reasons.push('metadata_needs_review');
  const required = PLANNING_DOCUMENTS.filter(name => name !== 'opplan');
  for (const name of required) if (reads[name].state !== 'ready') reasons.push(`${name}:${reads[name].state}`);
  if (required.every(name => reads[name].state === 'ready')) {
    const names = new Set(required.map(name => String(reads[name].payload!.engagement_name).trim()));
    if (names.size !== 1 || names.has('')) reasons.push('engagement_name_mismatch');
    const roe = reads.roe.payload!;
    if (!String(roe.authorization_reference ?? '').trim()) reasons.push('authorization_reference_missing');
    if (!(roe.in_scope as { target: string }[]).some(entry => entry.target === project.targetValue)) reasons.push('target_not_in_scope');
  }
  const documents = Object.fromEntries(Object.keys(PUBLIC_FIELDS).map(key => {
    const name = key as keyof typeof PUBLIC_FIELDS;
    const doc = reads[name];
    return [name, doc.state === 'ready' ? { state: 'ready', content: projectContent(name, doc.payload!) } : { state: doc.state }];
  }));
  const view = { version: 1, engagementId: project.id, documents, bundle: Object.fromEntries(entries.map(([name, doc]) => [name, doc.state])), readiness: { state: reasons.length ? 'blocked' : 'ready', reasons, runtimeSignal: 'not_observed' } };
  if (!isPlanningView(view)) throw new Error('Planning projection contract mismatch');
  return view;
}
