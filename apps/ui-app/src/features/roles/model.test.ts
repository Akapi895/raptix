import { describe, expect, it } from 'vitest';
import { decodeRoleIcon, encodeRoleIcon, filterByRoleLink, RoleToolSelection, sortRoles, toolKey, type RoleTool } from './model';

const builtin = (name: string, enabled = true): RoleTool => ({ name, enabled });
const external = (mcp: string, name: string, enabled = true): RoleTool => ({ name, enabled, is_external: true, external_mcp: mcp });

describe('role icons', () => {
  it('stores an emoji as the escape the server expects and decodes it back', () => {
    const escaped = encodeRoleIcon('🏆');
    expect(escaped).toBe('\\U0001F3C6');
    expect(decodeRoleIcon(escaped)).toBe('🏆');
    expect(decodeRoleIcon(`"${escaped}"`)).toBe('🏆');
  });

  it('keeps ASCII as typed and treats blank input as no icon', () => {
    expect(encodeRoleIcon('  ab  ')).toBe('ab');
    expect(encodeRoleIcon('   ')).toBe('');
  });
});

describe('sortRoles and descriptions', () => {
  it('puts the default role first and sorts the others by name', () => {
    const sorted = sortRoles([{ name: 'b' }, { name: '\u9ed8\u8ba4' }, { name: 'a' }]);
    expect(sorted.map(role => role.name)).toEqual(['\u9ed8\u8ba4', 'a', 'b']);
  });
});

describe('tool identity', () => {
  it('namespaces external tools by their MCP server', () => {
    expect(toolKey(external('github', 'search'))).toBe('github::search');
    expect(toolKey(builtin('nmap'))).toBe('nmap');
  });
});

describe('RoleToolSelection', () => {
  it('links the configured tools and keeps the MCP switch when the user changes a checkbox', () => {
    const selection = new RoleToolSelection();
    selection.configured.add('nmap');
    selection.merge(builtin('nmap', false));
    expect(selection.isLinked('nmap', builtin('nmap', false))).toBe(true);
    selection.write('nmap', { name: 'nmap', is_external: false, external_mcp: '' }, false);
    expect(selection.states.get('nmap')).toMatchObject({ enabled: false, mcpEnabled: false });
  });

  it('only saves tools the MCP page still enables', () => {
    const selection = new RoleToolSelection();
    selection.merge(builtin('nmap', true));
    selection.merge(builtin('hydra', false));
    selection.setSelected(['nmap', 'hydra']);
    expect(selection.selectedKeys()).toEqual(['nmap']);
    expect(selection.disabledKeys(['nmap', 'hydra'])).toEqual(['hydra']);
  });

  it('marks every enabled tool when the role keeps all tools', () => {
    const selection = new RoleToolSelection();
    selection.usesAllTools = true;
    selection.merge(builtin('nmap', true));
    selection.merge(builtin('hydra', false));
    expect(selection.isLinked('nmap', builtin('nmap'))).toBe(true);
    expect(selection.isLinked('hydra', builtin('hydra', false))).toBe(false);
    expect(selection.hasUnselectedEnabled()).toBe(false);
  });

  it('counts only linked tools that are enabled on the MCP page', () => {
    const selection = new RoleToolSelection();
    selection.merge(builtin('nmap', true));
    selection.merge(builtin('hydra', false));
    selection.setSelected(['nmap', 'hydra']);
    expect(selection.linkedCount()).toBe(1);
  });
});

describe('filterByRoleLink', () => {
  const tools = [builtin('nmap'), builtin('hydra'), builtin('ffuf')];
  const linked = (key: string) => key !== 'hydra';

  it('keeps everything without a filter', () => {
    expect(filterByRoleLink(tools, '', (key) => linked(key))).toHaveLength(3);
  });

  it('splits the list into linked and unlinked tools', () => {
    expect(filterByRoleLink(tools, 'role_on', (key) => linked(key)).map(tool => tool.name)).toEqual(['nmap', 'ffuf']);
    expect(filterByRoleLink(tools, 'role_off', (key) => linked(key)).map(tool => tool.name)).toEqual(['hydra']);
  });
});
