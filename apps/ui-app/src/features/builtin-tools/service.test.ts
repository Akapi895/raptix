import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BuiltinTools, getAllBuiltinTools, isBuiltinTool } from './index';

describe('builtin tool metadata compatibility', () => {
  it('retains the original UI names and ordering', () => {
    expect(BuiltinTools).toEqual({
      RECORD_VULNERABILITY: 'record_vulnerability',
      LIST_KNOWLEDGE_RISK_TYPES: 'list_knowledge_risk_types',
      SEARCH_KNOWLEDGE_BASE: 'search_knowledge_base',
    });
    expect(getAllBuiltinTools()).toEqual(['record_vulnerability', 'list_knowledge_risk_types', 'search_knowledge_base']);
  });

  it('matches backend constants without broadening the legacy UI classification', () => {
    const backend = readFileSync(new URL('../../../../internal/mcp/builtin/constants.go', import.meta.url), 'utf8');
    for (const name of getAllBuiltinTools()) {
      expect(backend).toContain(`= "${name}"`);
      expect(isBuiltinTool(name)).toBe(true);
    }
    for (const name of ['', 'SEARCH_KNOWLEDGE_BASE', 'search_knowledge_base ', 'list_vulnerabilities', null, undefined, {}]) {
      expect(isBuiltinTool(name)).toBe(false);
    }
  });

  it('returns an independent list on each call', () => {
    const names = getAllBuiltinTools();
    names.pop();
    expect(getAllBuiltinTools()).toHaveLength(3);
    expect(isBuiltinTool(BuiltinTools.SEARCH_KNOWLEDGE_BASE)).toBe(true);
  });
});
