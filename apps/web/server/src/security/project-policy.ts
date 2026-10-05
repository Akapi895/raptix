import * as net from 'node:net';

/**
 * Project create/patch input policy (W02) — independent new-backend port of
 * the legacy validation rules (clients/web/src/lib/workspace.ts + engagement
 * API routes, reference only, no source import). `name` doubles as the
 * on-disk workspace slug; targets are validated exactly: no network
 * resolution, no sibling inference, no normalization beyond stdlib parsers.
 */

export type ProjectPolicyErrorCode = 'bad_request' | 'conflict' | 'not_found';

export interface ProjectPolicyErrorDetails { readonly field?: string }

export class ProjectPolicyError extends Error {
  public readonly code: ProjectPolicyErrorCode;
  public readonly details?: ProjectPolicyErrorDetails;

  public constructor(code: ProjectPolicyErrorCode, message: string, details?: ProjectPolicyErrorDetails) {
    super(message);
    this.name = 'ProjectPolicyError';
    this.code = code;
    this.details = details;
  }
}

/** Legacy slug reference: 3-64 chars, [a-z0-9], internal hyphens only. */
export const PROJECT_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export function isProjectSlug(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_SLUG_RE.test(value);
}

export const PROJECT_TARGET_TYPES = ['web_url', 'ip_range'] as const;
export type ProjectTargetType = (typeof PROJECT_TARGET_TYPES)[number];

export function isProjectTargetType(value: unknown): value is ProjectTargetType {
  return typeof value === 'string' && (PROJECT_TARGET_TYPES as readonly string[]).includes(value);
}

const DISPLAY_NAME_MAX = 200;
const IPV4_PREFIX_BITS = 32;
const IPV6_PREFIX_BITS = 128;

function badField(field: string, message: string): ProjectPolicyError {
  return new ProjectPolicyError('bad_request', message, { field });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDisplayName(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > DISPLAY_NAME_MAX) {
    throw badField('displayName', `Invalid displayName — must be a non-empty string of at most ${DISPLAY_NAME_MAX} characters`);
  }
  return raw;
}

function assertWebUrlTarget(value: string): void {
  if (/\s/.test(value)) {
    throw badField('targetValue', 'Invalid web_url target — must be an absolute HTTP(S) URL without whitespace');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badField('targetValue', 'Invalid web_url target — must be an absolute HTTP(S) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badField('targetValue', 'Invalid web_url target — only http: and https: schemes are supported');
  }
  if (url.hostname === '') {
    throw badField('targetValue', 'Invalid web_url target — a host is required');
  }
  if (url.username !== '' || url.password !== '') {
    throw badField('targetValue', 'Invalid web_url target — embedded credentials are not allowed');
  }
}

function assertIpRangeTarget(value: string): void {
  const slash = value.indexOf('/');
  const address = slash === -1 ? value : value.slice(0, slash);
  const prefixText = slash === -1 ? undefined : value.slice(slash + 1);
  if (address.includes('%')) {
    throw badField('targetValue', 'Invalid ip_range target — IPv6 zone IDs are not supported');
  }
  const family = net.isIP(address);
  if (family === 0) {
    throw badField('targetValue', 'Invalid ip_range target — must be a bare IPv4/IPv6 address or CIDR');
  }
  if (prefixText !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(prefixText)) {
      throw badField('targetValue', 'Invalid ip_range target — prefix length must be a decimal integer');
    }
    const maxBits = family === 4 ? IPV4_PREFIX_BITS : IPV6_PREFIX_BITS;
    if (Number(prefixText) > maxBits) {
      throw badField('targetValue', `Invalid ip_range target — IPv${family} prefix must be 0-${maxBits}`);
    }
  }
}

/** Exact target validation for the given type. No network IO. */
export function assertProjectTarget(targetType: ProjectTargetType, targetValue: string): void {
  if (targetType === 'web_url') assertWebUrlTarget(targetValue);
  else assertIpRangeTarget(targetValue);
}

export interface ParsedCreateProject {
  readonly name: string;
  readonly displayName?: string;
  readonly targetType: ProjectTargetType;
  readonly targetValue: string;
  readonly authorizationConfirmed: true;
}

const CREATE_ALLOWED_KEYS = ['name', 'displayName', 'targetType', 'targetValue', 'authorizationConfirmed'] as const;

/** Strict create parsing: unknown keys, weak types and unsafe targets fail closed. */
export function parseCreateProject(raw: unknown): ParsedCreateProject {
  if (!isPlainObject(raw)) {
    throw new ProjectPolicyError('bad_request', 'Project payload must be a JSON object');
  }
  for (const key of Object.keys(raw)) {
    if (!(CREATE_ALLOWED_KEYS as readonly string[]).includes(key)) {
      throw badField(key, `Unknown field "${key}" is not accepted`);
    }
  }
  if (!isProjectSlug(raw.name)) {
    throw badField('name', 'Invalid project name — must be 3-64 chars, lowercase letters / digits / internal hyphens');
  }
  const displayName = parseDisplayName(raw.displayName);
  if (!isProjectTargetType(raw.targetType)) {
    throw badField('targetType', `Invalid targetType. Must be one of: ${PROJECT_TARGET_TYPES.join(', ')}`);
  }
  if (typeof raw.targetValue !== 'string' || raw.targetValue.length === 0) {
    throw badField('targetValue', 'targetValue must be a non-empty string');
  }
  assertProjectTarget(raw.targetType, raw.targetValue);
  if (raw.authorizationConfirmed !== true) {
    throw badField('authorizationConfirmed', 'Explicit authorization confirmation is required');
  }
  return {
    name: raw.name,
    ...(displayName === undefined ? {} : { displayName }),
    targetType: raw.targetType,
    targetValue: raw.targetValue,
    authorizationConfirmed: true,
  };
}

export interface ParsedProjectPatch {
  readonly displayName?: string;
  readonly targetType?: ProjectTargetType;
  readonly targetValue?: string;
}

const PATCH_ALLOWED_KEYS = ['displayName', 'targetType', 'targetValue'] as const;

/**
 * PATCH never accepts authority/control/immutable fields: `name` is the
 * workspace slug (a rename would desync filesystem/runtime), `userId` and
 * `workspacePath` are server-authority, `threadId` is runtime-authority and
 * `status` is not PATCH-controlled lifecycle state.
 */
const PATCH_REJECTED_REASONS: Readonly<Record<string, string>> = {
  name: 'Project name is immutable — it is the workspace slug; create a new project instead',
  userId: 'userId is server-authority and cannot be set from requests',
  threadId: 'threadId is runtime-authority and cannot be set from requests',
  workspacePath: 'workspacePath is server-authority — the browser never supplies absolute paths',
  status: 'Lifecycle status is not patch-controlled',
};

/** Strict patch parsing: only displayName/targetType/targetValue are supported. */
export function parseProjectPatch(raw: unknown): ParsedProjectPatch {
  if (!isPlainObject(raw)) {
    throw new ProjectPolicyError('bad_request', 'Patch payload must be a JSON object');
  }
  for (const key of Object.keys(raw)) {
    const rejected = PATCH_REJECTED_REASONS[key];
    if (rejected !== undefined) throw badField(key, rejected);
    if (!(PATCH_ALLOWED_KEYS as readonly string[]).includes(key)) {
      throw badField(key, `Unknown field "${key}" is not accepted`);
    }
  }
  const displayName = parseDisplayName(raw.displayName);
  let targetType: ProjectTargetType | undefined;
  if (raw.targetType !== undefined) {
    if (!isProjectTargetType(raw.targetType)) {
      throw badField('targetType', `Invalid targetType. Must be one of: ${PROJECT_TARGET_TYPES.join(', ')}`);
    }
    targetType = raw.targetType;
  }
  let targetValue: string | undefined;
  if (raw.targetValue !== undefined) {
    if (typeof raw.targetValue !== 'string' || raw.targetValue.length === 0) {
      throw badField('targetValue', 'targetValue must be a non-empty string');
    }
    targetValue = raw.targetValue;
  }
  if (displayName === undefined && targetType === undefined && targetValue === undefined) {
    throw new ProjectPolicyError('bad_request', 'No supported fields to update');
  }
  if (targetType !== undefined && targetValue !== undefined) assertProjectTarget(targetType, targetValue);
  return {
    ...(displayName === undefined ? {} : { displayName }),
    ...(targetType === undefined ? {} : { targetType }),
    ...(targetValue === undefined ? {} : { targetValue }),
  };
}

export interface ProjectTargetChangeContext {
  /** Engagement lifecycle status (draft/planning/running/completed/failed). */
  readonly lifecycleStatus: string;
  /** Runtime thread binding; null until a run starts. */
  readonly threadId: string | null;
  readonly runtimeContextLocked?: boolean;
}

/**
 * Target changes are a service-level gate: only draft projects without a
 * linked runtime thread may change target. Call after merging the patch with
 * the current record, before persisting.
 */
export function assertProjectTargetChangeAllowed(context: ProjectTargetChangeContext): void {
  if (context.lifecycleStatus !== 'draft') {
    throw new ProjectPolicyError('conflict', 'Target changes are only allowed while the project is in draft', { field: 'targetType' });
  }
  if (context.threadId !== null || context.runtimeContextLocked) {
    throw new ProjectPolicyError('conflict', 'Target changes are not allowed once a runtime thread is linked', { field: 'targetValue' });
  }
}
