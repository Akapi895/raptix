/**
 * Pure tool-guard rules: shapes, normalisation, request validation and error mapping.
 * No DOM, no network. The backend (RE2) stays the authority for pattern syntax.
 */
import { z } from 'zod';

export const RULE_FIELDS = ['name', 'pattern', 'message'] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export interface GuardRule {
  id: string;
  name: string;
  enabled: boolean;
  pattern: string;
  message: string;
}

export interface GuardConfig {
  enabled: boolean;
  rules: GuardRule[];
}

export const MAX_RULES = 100;
export const FIELD_LIMITS: Record<RuleField, number> = { name: 200, pattern: 4096, message: 4096 };

// internal/handler/tool_guard.go: GET/PUT /api/tool-guard and POST /api/tool-guard/test.
export const configSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    pattern: z.string().optional(),
    message: z.string().optional(),
  })).nullish(),
});

export const testResultSchema = z.object({
  blocked: z.boolean(),
  match: z.object({
    ruleId: z.string().optional(),
    ruleName: z.string().optional(),
    matchedText: z.string(),
    message: z.string(),
  }).nullish(),
});
export type GuardTestResult = z.infer<typeof testResultSchema>;

/** Tolerates missing optional fields and returns the stable shape the UI edits. */
export function normalizeConfig(raw: z.infer<typeof configSchema>): GuardConfig {
  return {
    enabled: raw.enabled,
    rules: (raw.rules ?? []).map(rule => ({
      id: String(rule.id ?? ''),
      name: String(rule.name ?? ''),
      enabled: rule.enabled === true,
      pattern: String(rule.pattern ?? ''),
      message: String(rule.message ?? ''),
    })),
  };
}

export function isDirty(current: GuardConfig | null, saved: GuardConfig | null): boolean {
  return current !== null && JSON.stringify(current) !== JSON.stringify(saved);
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A validation failure tied to one rule and field, so the editor can point at it. */
export class RuleValidationError extends Error {
  constructor(message: string, readonly ruleIndex: number, readonly ruleId: string, readonly field: RuleField) {
    super(message);
    this.name = 'RuleValidationError';
  }
}

export interface MessageKeys {
  requiredFields: string;
  fieldTooLong: string;
}

/**
 * Client-side checks before a request: required fields and UTF-8 length limits.
 * `message` may be empty; name and pattern may not.
 */
export function validateRules(rules: readonly GuardRule[], keys: MessageKeys): void {
  rules.forEach((rule, index) => {
    for (const field of RULE_FIELDS) {
      const value = rule[field];
      let failure: string | null = null;
      if (field !== 'message' && !value.trim()) failure = keys.requiredFields;
      else if (utf8Length(value) > FIELD_LIMITS[field]) failure = keys.fieldTooLong;
      if (failure) throw new RuleValidationError(failure, index, rule.id, field);
    }
  });
}

/**
 * The server reports RE2 errors as "tool guard rule N (...): name|message|pattern ...".
 * Returns the 0-based rule index and the field, or null when the text does not match.
 */
export function parseServerRuleError(message: string): { ruleIndex: number; field: RuleField } | null {
  const match = /tool guard rule (\d+)(?: \([^\n]*\))?: (.*)/.exec(message);
  if (!match) return null;
  const detail = match[2] ?? '';
  const field: RuleField = /^name\b/.test(detail) ? 'name' : /^message\b/.test(detail) ? 'message' : 'pattern';
  return { ruleIndex: Number(match[1]) - 1, field };
}

/** Parses the single-rule test arguments; they must be a JSON object. */
export function parseToolArguments(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('invalid-arguments'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('invalid-arguments');
  return value as Record<string, unknown>;
}

export function newRuleId(randomUUID: (() => string) | undefined, now: number, random: number): string {
  return randomUUID ? randomUUID() : `rule-${now.toString(36)}-${random.toString(36).slice(2)}`;
}
