/**
 * Generated console data: the knowledge list filters and pages over the whole index, its facets ignore the filters, and a
 * missing, unconfigured or malformed file answers 503 instead of an empty list.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConsoleDataService } from '../src/services/console-data-service.js';
import { ProjectApiError } from '../src/services/projects-service.js';

const index = {
  generatedOn: '2026-10-23',
  items: [
    { id: 'attack:T1078', source: 'attack', type: 'technique', name: 'Valid Accounts', description: 'Adversaries obtain credentials.', status: null, path: 'attack/T1078.yaml' },
    { id: 'attack:T1190', source: 'attack', type: 'technique', name: 'Exploit Public-Facing Application', description: null, status: null, path: 'attack/T1190.yaml' },
    { id: 'cisa:kev:CVE-2002-0367', source: 'cisa', type: 'kev_entry', name: 'Windows privilege escalation', description: 'smss.exe debugging subsystem.', status: null, path: null },
  ],
};

const catalog = {
  generatedOn: '2026-10-23',
  agents: [{ id: 'recon', description: 'Recon Agent', module: 'packages/raptix/raptix/intelligence/agents/standard/recon.py', toolDomains: ['bash', 'web'], prompt: '# Recon prompt', source: 'class ReconAgent: ...' }],
  subagents: [{ id: 'recon', package: 'raptix-core', target: 'raptix.recon:factory', module: 'packages/raptix/raptix/intelligence/agents/standard/recon.py', source: 'SUBAGENT_SPEC = ...' }],
  tools: [{ name: 'web_fetch', domain: 'web', description: 'Fetch a URL.', docstring: 'Fetch a URL. Bounded.', signature: 'def web_fetch(url: str) -> str', source: 'def web_fetch(url: str) -> str: return url', file: 'packages/raptix/raptix/execution/tools/web/search.py' }],
  binaries: [{ executable: 'nmap', profile: 'base', adapterId: 'network.nmap', capabilityId: 'network.scan', capabilityDescription: 'Port scan', riskClass: 'medium', allowedRoles: ['recon', 'exploit'], sourceModule: 'raptix.execution.adapters.network.nmap', sourceClass: 'NmapAdapter', source: 'class NmapAdapter: ...' }],
  mcp: { envVar: 'RAPTIX_MCP__SERVERS', configured: false, servers: [] },
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'console-data-'));
  await mkdir(path.join(dir, 'knowledge'));
  await mkdir(path.join(dir, 'capabilities'));
  await mkdir(path.join(dir, 'knowledge/attack'));
  await writeFile(path.join(dir, 'knowledge/index.json'), JSON.stringify(index));
  await writeFile(path.join(dir, 'knowledge/attack/T1078.yaml'), 'id: attack:T1078\nname: Valid Accounts\n');
  await writeFile(path.join(dir, 'capabilities/catalog.json'), JSON.stringify(catalog));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('knowledge list', () => {
  it('filters by text, source and type, and keeps the facets over the whole index', async () => {
    const service = new ConsoleDataService(dir);
    const byText = await service.listKnowledge({ q: 'credentials' });
    expect(byText.items.map(item => item.id)).toEqual(['attack:T1078']);
    expect(byText.total).toBe(1);
    const bySource = await service.listKnowledge({ source: 'attack' });
    expect(bySource.total).toBe(2);
    expect(bySource.sources).toEqual({ attack: 2, cisa: 1 });
    expect(bySource.types).toEqual({ technique: 2, kev_entry: 1 });
  });

  it('pages the matches and clamps an out-of-range page', async () => {
    const service = new ConsoleDataService(dir);
    const page = await service.listKnowledge({ pageSize: 2, page: 9 });
    expect(page.page).toBe(2);
    expect(page.items.map(item => item.id)).toEqual(['cisa:kev:CVE-2002-0367']);
  });
});

describe('knowledge content', () => {
  it('returns the record file for an id in the index', async () => {
    const detail = await new ConsoleDataService(dir).knowledgeContent('attack:T1078');
    expect(detail.item.name).toBe('Valid Accounts');
    expect(detail.content).toBe('id: attack:T1078\nname: Valid Accounts\n');
  });

  it('answers 404 for an id the index does not hold', async () => {
    const error = await new ConsoleDataService(dir).knowledgeContent('attack:T9999').catch((caught: unknown) => caught);
    expect((error as ProjectApiError).statusCode).toBe(404);
  });

  it('answers 404 for an index entry that has no record file', async () => {
    const error = await new ConsoleDataService(dir).knowledgeContent('cisa:kev:CVE-2002-0367').catch((caught: unknown) => caught);
    expect((error as ProjectApiError).statusCode).toBe(404);
  });

  it('answers 503 when an indexed record file is missing from the folder', async () => {
    const error = await new ConsoleDataService(dir).knowledgeContent('attack:T1190').catch((caught: unknown) => caught);
    expect((error as ProjectApiError).statusCode).toBe(503);
  });
});

describe('unavailable console data', () => {
  it('answers 503 when no data folder is configured', async () => {
    const error = await new ConsoleDataService(undefined).listKnowledge({}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProjectApiError);
    expect((error as ProjectApiError).statusCode).toBe(503);
  });

  it('answers 503 when the index file is missing', async () => {
    const error = await new ConsoleDataService(path.join(dir, 'absent')).listKnowledge({}).catch((caught: unknown) => caught);
    expect((error as ProjectApiError).statusCode).toBe(503);
  });

  it('answers 503 and does not cache a malformed catalog', async () => {
    await writeFile(path.join(dir, 'capabilities/catalog.json'), JSON.stringify({ agents: 'nope' }));
    const service = new ConsoleDataService(dir);
    const first = await service.capabilityCatalog().catch((caught: unknown) => caught);
    expect((first as ProjectApiError).statusCode).toBe(503);
    await writeFile(path.join(dir, 'capabilities/catalog.json'), JSON.stringify(catalog));
    const second = await service.capabilityCatalog();
    expect(second.agents.map(agent => agent.id)).toEqual(['recon']);
  });
});

describe('capability catalog', () => {
  it('reads agents, subagents, tools and MCP state without reading any server URL', async () => {
    const result = await new ConsoleDataService(dir).capabilityCatalog();
    expect(result.agents[0]?.toolDomains).toEqual(['bash', 'web']);
    expect(result.subagents[0]?.package).toBe('raptix-core');
    expect(result.tools[0]?.name).toBe('web_fetch');
    expect(result.tools[0]?.signature).toBe('def web_fetch(url: str) -> str');
    expect(result.binaries.map(binary => binary.executable)).toEqual(['nmap']);
    expect(result.binaries[0]?.profile).toBe('base');
    expect(result.mcp).toEqual({ envVar: 'RAPTIX_MCP__SERVERS', configured: false, servers: [] });
  });
});
