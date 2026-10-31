import { describe, expect, it } from 'vitest';
import {
  FIELD_LIMITS, RuleValidationError, isDirty, normalizeConfig, parseServerRuleError, parseToolArguments, validateRules, configSchema,
  type GuardRule,
} from './model';

const keys = { requiredFields: 'required', fieldTooLong: 'too-long' };
const rule = (overrides: Partial<GuardRule> = {}): GuardRule => ({
  id: 'r1', name: 'Block shell', enabled: true, pattern: 'rm -rf', message: 'Blocked', ...overrides,
});

describe('tool-guard model', () => {
  it('normalises a sparse server payload into the editable shape', () => {
    const parsed = configSchema.parse({ enabled: true, rules: [{ id: 'a', pattern: 'x' }] });
    expect(normalizeConfig(parsed)).toEqual({
      enabled: true,
      rules: [{ id: 'a', name: '', enabled: false, pattern: 'x', message: '' }],
    });
    expect(normalizeConfig(configSchema.parse({ enabled: false, rules: null }))).toEqual({ enabled: false, rules: [] });
  });

  it('detects unsaved edits by comparing against the saved snapshot', () => {
    const saved = { enabled: true, rules: [rule()] };
    expect(isDirty(structuredClone(saved), saved)).toBe(false);
    expect(isDirty({ ...saved, enabled: false }, saved)).toBe(true);
    expect(isDirty(null, saved)).toBe(false);
  });

  it('requires name and pattern, but allows an empty message', () => {
    expect(() => validateRules([rule()], keys)).not.toThrow();
    expect(() => validateRules([rule({ message: '' })], keys)).not.toThrow();
    expect(() => validateRules([rule({ pattern: '   ' })], keys)).toThrow(RuleValidationError);
  });

  it('pins the failing rule and field for a validation error', () => {
    try {
      validateRules([rule(), rule({ id: 'r2', name: '' })], keys);
      throw new Error('expected a validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(RuleValidationError);
      const failure = error as RuleValidationError;
      expect(failure.ruleIndex).toBe(1);
      expect(failure.ruleId).toBe('r2');
      expect(failure.field).toBe('name');
    }
  });

  it('counts UTF-8 bytes, not characters, against the field limits', () => {
    const longName = '\u540d'.repeat(Math.floor(FIELD_LIMITS.name / 3) + 1);
    expect(() => validateRules([rule({ name: longName })], keys)).toThrow(RuleValidationError);
  });

  it('maps RE2 errors reported as "tool guard rule N" to the zero-based rule and field', () => {
    expect(parseServerRuleError('tool guard rule 3 (block): pattern: invalid regexp')).toEqual({ ruleIndex: 2, field: 'pattern' });
    expect(parseServerRuleError('tool guard rule 1: message is too long')).toEqual({ ruleIndex: 0, field: 'message' });
    expect(parseServerRuleError('tool guard rule 2: name must not be empty')).toEqual({ ruleIndex: 1, field: 'name' });
    expect(parseServerRuleError('something else')).toBeNull();
  });

  it('accepts only JSON objects as test arguments', () => {
    expect(parseToolArguments('{"url": "https://example.gov.cn"}')).toEqual({ url: 'https://example.gov.cn' });
    expect(() => parseToolArguments('[1, 2]')).toThrow('invalid-arguments');
    expect(() => parseToolArguments('null')).toThrow('invalid-arguments');
    expect(() => parseToolArguments('{')).toThrow('invalid-arguments');
  });
});
