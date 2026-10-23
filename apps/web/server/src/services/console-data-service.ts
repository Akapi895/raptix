import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ProjectApiError } from './projects-service.js';

/**
 * Generated console data: the knowledge index and the capability catalog. Both are read-only files in one folder
 * (RAPTIX_CONSOLE_DATA_DIR). A missing or malformed file answers 503 rather than an empty list, so an absent source
 * never reads as "none".
 */

export interface KnowledgeItemView {
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string | null;
  /** The record file, relative to the knowledge folder; read on demand by knowledgeContent. */
  readonly path: string | null;
}

export interface KnowledgeItemDetail {
  readonly item: KnowledgeItemView;
  /** The record file as the ingestion wrote it (YAML). */
  readonly content: string;
}

export interface KnowledgeQuery {
  readonly q?: string;
  readonly source?: string;
  readonly type?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface KnowledgeListView {
  readonly items: readonly KnowledgeItemView[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  /** Counts over the whole index; filters never change them. */
  readonly sources: Readonly<Record<string, number>>;
  readonly types: Readonly<Record<string, number>>;
  readonly generatedOn: string | null;
}

export interface AgentView {
  readonly id: string;
  readonly description: string | null;
  readonly module: string;
  readonly toolDomains: readonly string[];
  /** The agent's standard prompt markdown; null when the agent has no standard prompt file. */
  readonly prompt: string | null;
  /** The module source that defines the agent. */
  readonly source: string | null;
}

export interface SubagentView {
  readonly id: string;
  readonly package: string;
  readonly target: string;
  /** The module the entry point resolves to in the repo; null when it cannot be found. */
  readonly module: string | null;
  readonly source: string | null;
}

export interface ToolView {
  readonly name: string;
  readonly domain: string;
  readonly description: string | null;
  readonly docstring: string | null;
  readonly signature: string;
  /** The tool's own source, from its decorator to its last line (capped by the generator). */
  readonly source: string;
  readonly file: string;
}

/** A binary-backed capability: the external executable, the sandbox profile that ships it, and the adapter that runs it. */
export interface BinaryToolView {
  readonly executable: string;
  /** `base` is the sandbox base image; any other value is an optional profile. */
  readonly profile: string | null;
  readonly adapterId: string;
  readonly capabilityId: string;
  readonly capabilityDescription: string | null;
  readonly riskClass: string;
  /** Empty means every role. */
  readonly allowedRoles: readonly string[];
  readonly sourceModule: string | null;
  readonly sourceClass: string | null;
  readonly source: string | null;
}

export interface McpServerView {
  readonly name: string;
  readonly transport: string;
}

export interface McpView {
  readonly envVar: string;
  readonly configured: boolean;
  readonly servers: readonly McpServerView[];
}

export interface CapabilityCatalogView {
  readonly generatedOn: string | null;
  readonly agents: readonly AgentView[];
  readonly subagents: readonly SubagentView[];
  readonly tools: readonly ToolView[];
  readonly binaries: readonly BinaryToolView[];
  readonly mcp: McpView;
}

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const KNOWLEDGE_FILE = 'knowledge/index.json';
const CATALOG_FILE = 'capabilities/catalog.json';

type Knowledge = { readonly generatedOn: string | null; readonly items: readonly KnowledgeItemView[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(file: string): ProjectApiError {
  return new ProjectApiError(503, `Console data file ${file} has an unexpected shape.`);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

function parseKnowledge(value: unknown): Knowledge {
  if (!isRecord(value) || !Array.isArray(value.items)) throw malformed(KNOWLEDGE_FILE);
  const items = value.items.map((row): KnowledgeItemView => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.source !== 'string' || typeof row.type !== 'string' || typeof row.name !== 'string') throw malformed(KNOWLEDGE_FILE);
    return { id: row.id, source: row.source, type: row.type, name: row.name, description: textOrNull(row.description), status: textOrNull(row.status), path: textOrNull(row.path) };
  });
  return { generatedOn: textOrNull(value.generatedOn), items };
}

function parseCatalog(value: unknown): CapabilityCatalogView {
  if (!isRecord(value) || !Array.isArray(value.agents) || !Array.isArray(value.subagents) || !Array.isArray(value.tools) || !isRecord(value.mcp)) throw malformed(CATALOG_FILE);
  const agents = value.agents.map((row): AgentView => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.module !== 'string' || !Array.isArray(row.toolDomains)) throw malformed(CATALOG_FILE);
    return { id: row.id, description: textOrNull(row.description), module: row.module, toolDomains: row.toolDomains.filter((d): d is string => typeof d === 'string'), prompt: textOrNull(row.prompt), source: textOrNull(row.source) };
  });
  const subagents = value.subagents.map((row): SubagentView => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.package !== 'string' || typeof row.target !== 'string') throw malformed(CATALOG_FILE);
    return { id: row.id, package: row.package, target: row.target, module: textOrNull(row.module), source: textOrNull(row.source) };
  });
  const tools = value.tools.map((row): ToolView => {
    if (!isRecord(row) || typeof row.name !== 'string' || typeof row.domain !== 'string' || typeof row.file !== 'string' || typeof row.signature !== 'string' || typeof row.source !== 'string') throw malformed(CATALOG_FILE);
    return { name: row.name, domain: row.domain, description: textOrNull(row.description), docstring: textOrNull(row.docstring), signature: row.signature, source: row.source, file: row.file };
  });
  if (!Array.isArray(value.binaries)) throw malformed(CATALOG_FILE);
  const binaries = value.binaries.map((row): BinaryToolView => {
    if (!isRecord(row) || typeof row.executable !== 'string' || typeof row.adapterId !== 'string' || typeof row.capabilityId !== 'string' || typeof row.riskClass !== 'string' || !Array.isArray(row.allowedRoles)) throw malformed(CATALOG_FILE);
    return {
      executable: row.executable,
      profile: textOrNull(row.profile),
      adapterId: row.adapterId,
      capabilityId: row.capabilityId,
      capabilityDescription: textOrNull(row.capabilityDescription),
      riskClass: row.riskClass,
      allowedRoles: row.allowedRoles.filter((role): role is string => typeof role === 'string'),
      sourceModule: textOrNull(row.sourceModule),
      sourceClass: textOrNull(row.sourceClass),
      source: textOrNull(row.source),
    };
  });
  const mcp = value.mcp;
  if (typeof mcp.envVar !== 'string' || typeof mcp.configured !== 'boolean' || !Array.isArray(mcp.servers)) throw malformed(CATALOG_FILE);
  const servers = mcp.servers.map((row): McpServerView => {
    if (!isRecord(row) || typeof row.name !== 'string' || typeof row.transport !== 'string') throw malformed(CATALOG_FILE);
    return { name: row.name, transport: row.transport };
  });
  return {
    generatedOn: textOrNull(value.generatedOn),
    agents,
    subagents,
    tools,
    binaries,
    mcp: { envVar: mcp.envVar, configured: mcp.configured, servers },
  };
}

export class ConsoleDataService {
  private knowledge?: Promise<Knowledge>;
  private catalog?: Promise<CapabilityCatalogView>;

  public constructor(private readonly dir: string | undefined) {}

  public async listKnowledge(query: KnowledgeQuery): Promise<KnowledgeListView> {
    const data = await this.loadKnowledge();
    const needle = query.q?.trim().toLowerCase() ?? '';
    const matches = data.items.filter(item =>
      (!query.source || item.source === query.source)
      && (!query.type || item.type === query.type)
      && (!needle || [item.name, item.id, item.description ?? ''].some(text => text.toLowerCase().includes(needle))));
    const pageSize = Math.min(Math.max(1, query.pageSize ?? PAGE_SIZE), MAX_PAGE_SIZE);
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    const page = Math.min(Math.max(1, query.page ?? 1), pages);
    return {
      items: matches.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: matches.length,
      sources: countBy(data.items, item => item.source),
      types: countBy(data.items, item => item.type),
      generatedOn: data.generatedOn,
    };
  }

  /** One record's file as the ingestion wrote it. Only ids in the index are read, and the path always comes from the index. */
  public async knowledgeContent(id: string): Promise<KnowledgeItemDetail> {
    const data = await this.loadKnowledge();
    const item = data.items.find(candidate => candidate.id === id);
    if (!item || item.path === null) throw new ProjectApiError(404, `Knowledge entry ${id} is not in the index.`);
    if (path.isAbsolute(item.path) || item.path.split('/').includes('..')) throw malformed(KNOWLEDGE_FILE);
    return { item, content: await this.readText(path.join('knowledge', item.path)) };
  }

  public async capabilityCatalog(): Promise<CapabilityCatalogView> {
    this.catalog ??= this.read(CATALOG_FILE).then(parseCatalog).catch((error: unknown) => {
      this.catalog = undefined;
      throw error;
    });
    return this.catalog;
  }

  private loadKnowledge(): Promise<Knowledge> {
    this.knowledge ??= this.read(KNOWLEDGE_FILE).then(parseKnowledge).catch((error: unknown) => {
      this.knowledge = undefined;
      throw error;
    });
    return this.knowledge;
  }

  private async readText(relative: string): Promise<string> {
    if (this.dir === undefined) throw new ProjectApiError(503, 'Console data is not configured on this server (RAPTIX_CONSOLE_DATA_DIR).');
    try {
      return await readFile(path.join(this.dir, relative), 'utf8');
    } catch {
      throw new ProjectApiError(503, `Console data file ${relative} is missing or unreadable.`);
    }
  }

  private async read(relative: string): Promise<unknown> {
    if (this.dir === undefined) throw new ProjectApiError(503, 'Console data is not configured on this server (RAPTIX_CONSOLE_DATA_DIR).');
    try {
      return JSON.parse(await readFile(path.join(this.dir, relative), 'utf8')) as unknown;
    } catch {
      throw new ProjectApiError(503, `Console data file ${relative} is missing or unreadable.`);
    }
  }
}
