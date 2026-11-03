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

  // This used to also compare getAllBuiltinTools() against the original
  // CyberStrikeAI Go backend's internal/mcp/builtin/constants.go. That file
  // was never part of this repo's import (apps/ui-app/README.md: "this
  // package does not include the real Raptix backend") and structurally
  // cannot exist here -- not a gap to fix, a check that doesn't apply to
  // this repo's architecture. The isBuiltinTool() classification coverage
  // (the part that *is* testable here) stays.
  it('classifies only the exact legacy tool names, nothing broader', () => {
    for (const name of getAllBuiltinTools()) {
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
