import { createHash } from 'node:crypto';
import { ProjectPolicyError } from './project-policy.js';

function canonical(value: unknown, depth: number): string {
  if (depth > 20) throw new ProjectPolicyError('bad_request', 'Request payload is too deeply nested');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, v => canonical(v, depth + 1)).join(',')}]`;
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k], depth + 1)}`).join(',')}}`;
  }
  throw new ProjectPolicyError('bad_request', 'Request payload must contain only JSON values');
}

export function requestFingerprint(value: unknown): string {
  const serialized = canonical(value, 0);
  if (Buffer.byteLength(serialized) > 65536) throw new ProjectPolicyError('bad_request', 'Request payload exceeds 64 KiB');
  return createHash('sha256').update(serialized).digest('hex');
}
