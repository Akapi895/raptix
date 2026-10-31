import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from '../../platform/storage';
import { createRoleToolsEditor } from './editor';
import type { RoleTool } from './model';
import type { RolesService } from './service';

const catalog: RoleTool[] = [
  { name: 'nmap', enabled: true },
  { name: 'hydra', enabled: false },
];

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    get: key => values.get(key) ?? null,
    set: (key, value) => { values.set(key, value); return true; },
    remove: key => values.delete(key),
  };
}

function fakeService(tools: RoleTool[] = catalog): RolesService {
  return {
    listTools: async (page: number, pageSize: number) => ({
      tools, page, pageSize, total: tools.length, totalPages: 1, totalEnabled: tools.filter(tool => tool.enabled).length,
    }),
    listAllTools: async () => tools,
  } as unknown as RolesService;
}

function editorFor(tools?: RoleTool[]) {
  return createRoleToolsEditor({ service: fakeService(tools), storage: memoryStorage() });
}

describe('role tool editor save plan', () => {
  it('saves no tools for the default role', async () => {
    const editor = editorFor();
    await editor.beginCreate();
    const plan = await editor.planSave(true, false);
    expect(plan).toMatchObject({ tools: [], disabledNames: [], firstRoleDefault: false });
  });

  it('gives the first user role every tool when nothing was picked', async () => {
    const editor = editorFor();
    await editor.beginCreate();
    const plan = await editor.planSave(false, true);
    expect(plan).toMatchObject({ tools: [], usesAllTools: true, firstRoleDefault: true });
  });

  it('saves the linked tools and reports the ones the MCP page switched off', async () => {
    const editor = editorFor();
    await editor.beginEdit({ name: 'pentest', tools: ['nmap', 'hydra'] });
    const plan = await editor.planSave(false, false);
    expect(plan.tools).toEqual(['nmap']);
    expect(plan.disabledNames).toEqual(['hydra']);
  });

  it('keeps the role on all tools when nothing was unlinked', async () => {
    const editor = editorFor();
    await editor.beginEdit({ name: 'all', tools: [] });
    const plan = await editor.planSave(false, false);
    expect(plan).toMatchObject({ tools: [], usesAllTools: true, disabledNames: [] });
  });

  it('switches to picked tools when the user unlinks one of the enabled tools', async () => {
    const editor = editorFor();
    await editor.beginEdit({ name: 'all', tools: [] });
    editor.write('nmap', catalog[0]!, false);
    const plan = await editor.planSave(false, false);
    expect(plan.usesAllTools).toBe(false);
    expect(plan.tools).toEqual([]);
  });
});

describe('role tool editor filter', () => {
  it('shows only the tools linked to the role when the filter is on', async () => {
    const editor = editorFor();
    await editor.beginEdit({ name: 'pentest', tools: ['nmap'] });
    await editor.setFilter('role_on');
    expect(editor.visible.map(tool => tool.name)).toEqual(['nmap']);
    await editor.setFilter('role_off');
    expect(editor.visible.map(tool => tool.name)).toEqual(['hydra']);
  });
});
