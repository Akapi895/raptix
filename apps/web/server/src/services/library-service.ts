import type { GraphView } from '@raptix/web-contracts';
import type { GraphConfig, GraphService } from './graph-service.js';
import { neo4jQuery } from './graph-service.js';
import { ProjectApiError } from './projects-service.js';

/**
 * Ticket 14: tradecraft library and observed analysis.
 *
 * Library/technique reads resolve the approved corpus through its canonical
 * public contract — the knowledge graph's global Skill/Technique nodes — so
 * no second browser corpus is created. Skill corpus data stays owned by the
 * runtime (packages/raptix-skills + the skills graph engine); revision
 * writes have no web contract on purpose and are recorded as excluded.
 *
 * Analysis derives technique coverage and bounded paths ONLY from
 * engagement-scoped observed graph nodes/edges; missing records render as
 * explicit missing-data states, never inferred execution or detection.
 */

export interface LibrarySkillView {
  readonly name: string;
  readonly description: string | null;
  readonly subdomain: string | null;
  readonly mitreIds: readonly string[];
  readonly whenToUse: string | null;
  readonly path: string | null;
}

export interface LibraryView {
  readonly skills: readonly LibrarySkillView[];
  readonly counts: { readonly skills: number; readonly techniques: number | null };
  readonly excludedActions: readonly string[];
  readonly sources: { readonly skills: 'knowledge-graph' };
  readonly source: 'graph';
}

/** Canonical single-skill read: the graph's Skill node is the only publication. */
export interface LibrarySkillDetailView {
  readonly name: string;
  readonly description: string | null;
  readonly subdomain: string | null;
  readonly mitreIds: readonly string[];
  readonly whenToUse: string | null;
  readonly path: string | null;
  readonly body: string;
  readonly contentSha256: string | null;
  readonly commitSha: string | null;
  readonly allowedTools: readonly string[];
  readonly publication: 'canonical';
}

/** Canonical single-technique read with the corpus skills that cover it. */
export interface LibraryTechniqueView {
  readonly id: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly url: string | null;
  readonly skills: readonly { readonly name: string }[];
}

export interface ObservedTechniqueView {
  readonly techniqueId: string;
  readonly label: string | null;
  readonly nodeIds: readonly string[];
}

export interface AnalysisPathView {
  readonly id: string;
  readonly steps: readonly { readonly nodeId: string; readonly techniqueId: string | null; readonly label: string | null }[];
}

export interface AnalysisView {
  readonly engagementId: string;
  readonly observed: readonly ObservedTechniqueView[];
  readonly coverage: { readonly observedTechniques: number; readonly corpusTechniques: number | null; readonly inCorpus: number | null };
  readonly paths: readonly AnalysisPathView[];
  readonly quality: { readonly graph: 'available' | 'empty'; readonly truncated: boolean };
  readonly excludedActions: readonly string[];
  readonly source: 'graph';
}

const SKILL_STATEMENT = 'MATCH (n:Skill) RETURN n.name AS name, n.description AS description, n.subdomain AS subdomain, n.mitre_attack_raw AS mitre, n.when_to_use AS whenToUse, n.path AS path ORDER BY n.name LIMIT $limit';
const COUNT_STATEMENT = 'MATCH (n:Skill) WITH count(n) AS skills OPTIONAL MATCH (t:Technique) RETURN skills, count(t) AS techniques';
const CORPUS_MATCH_STATEMENT = 'MATCH (t:Technique) WHERE t.id IN $ids RETURN collect(t.id) AS found';
const SKILL_DETAIL_STATEMENT = 'MATCH (n:Skill) WHERE n.name = $name RETURN n ORDER BY n.name LIMIT 1';
const TECHNIQUE_DETAIL_STATEMENT = 'MATCH (t:Technique) WHERE t.id = $id OPTIONAL MATCH (s:Skill)-[:IMPLEMENTS]->(t) RETURN t, collect(s) AS skills LIMIT 1';

const MAX_SKILLS = 500;
const MAX_OBSERVED = 100;
const MAX_PATHS = 20;
const MAX_PATH_STEPS = 6;
const MITRE_RE = /^T?(\d{4}(?:\.\d{3})?)$/i;

export const LIBRARY_EXCLUDED_ACTIONS = ['skill-revision-submit', 'skill-revision-review'] as const;

/** Normalize an observed property token to a canonical MITRE technique id. */
function toTechniqueId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = MITRE_RE.exec(String(value).trim());
  return match === null ? null : `T${match[1]}`;
}

function nodeLabel(properties: Record<string, string | number | boolean | null>, labels: readonly string[]): string | null {
  for (const key of ['name', 'title', 'hostname', 'host', 'ip', 'url', 'technique']) {
    const value = properties[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return labels[0] ?? null;
}

/** Chains over observed edges starting at technique-bearing nodes (bounded). */
export function projectAnalysisPaths(view: Omit<GraphView, 'engagementId' | 'truncated' | 'source'>): AnalysisPathView[] {
  const techniqueOf = new Map<string, string>();
  const labelOf = new Map<string, string | null>();
  for (const node of view.nodes) {
    for (const key of ['technique_id', 'mitre_id']) {
      const id = toTechniqueId(node.properties[key]);
      if (id !== null) { techniqueOf.set(node.id, id); break; }
    }
    labelOf.set(node.id, nodeLabel(node.properties, node.labels));
  }
  if (techniqueOf.size === 0) return [];
  const adjacency = new Map<string, { target: string; type: string }[]>();
  for (const edge of view.edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push({ target: edge.target, type: edge.type });
    adjacency.set(edge.source, list);
  }
  const paths: AnalysisPathView[] = [];
  const seen = new Set<string>();
  for (const start of techniqueOf.keys()) {
    if (paths.length >= MAX_PATHS) break;
    const stack: { nodeId: string; steps: AnalysisPathView['steps'] }[] = [{ nodeId: start, steps: [] }];
    while (stack.length > 0 && paths.length < MAX_PATHS) {
      const current = stack.pop()!;
      if (current.steps.some((step) => step.nodeId === current.nodeId)) continue;
      const steps = [...current.steps, { nodeId: current.nodeId, techniqueId: techniqueOf.get(current.nodeId) ?? null, label: labelOf.get(current.nodeId) ?? null }];
      const signature = steps.map((step) => step.nodeId).join('>');
      if (steps.length >= 2 && !seen.has(signature)) {
        seen.add(signature);
        paths.push({ id: `p${paths.length + 1}`, steps });
      }
      if (steps.length >= MAX_PATH_STEPS) continue;
      for (const next of adjacency.get(current.nodeId) ?? []) stack.push({ nodeId: next.target, steps });
    }
  }
  return paths;
}

export class LibraryService {
  public constructor(private readonly graphs: GraphService, private readonly config: GraphConfig) {}

  /**
   * Detail reads resolve a single canonical record. A well-formed EMPTY graph
   * result means "not found" here (the shared query helper cannot distinguish
   * it), while transport/auth failures still surface as unavailable.
   */
  /**
   * W16: a successful empty result resolves to no rows (the caller decides
   * not-found); query/schema failures throw and surface as unavailable —
   * never collapsed into "not found" by matching error message text.
   */
  private async detailRows(statement: string, parameters: Record<string, unknown>): Promise<unknown[][]> {
    return await neo4jQuery(this.config, statement, parameters);
  }

  public async skillDetail(name: unknown): Promise<LibrarySkillDetailView> {
    const skillName = typeof name === 'string' ? name.trim() : '';
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(skillName)) throw new ProjectApiError(400, 'A skill name is required.');
    const rows = await this.detailRows(SKILL_DETAIL_STATEMENT, { name: skillName });
    const props = (rows[0]?.[0] ?? null) as Record<string, unknown> | null;
    if (props === null || typeof props !== 'object') throw new ProjectApiError(404, `Skill ${skillName} is not in the canonical corpus.`);
    const body = typeof props.body === 'string' ? props.body : null;
    if (body === null) throw new ProjectApiError(503, 'The canonical skill body is unreadable in the knowledge graph.');
    return {
      name: skillName,
      description: typeof props.description === 'string' ? props.description : null,
      subdomain: typeof props.subdomain === 'string' ? props.subdomain : null,
      mitreIds: Array.isArray(props.mitre_attack_raw) ? props.mitre_attack_raw.filter((m): m is string => typeof m === 'string').slice(0, 24) : [],
      whenToUse: typeof props.when_to_use === 'string' ? props.when_to_use : null,
      path: typeof props.path === 'string' ? props.path : null,
      body,
      contentSha256: typeof props.content_sha256 === 'string' ? props.content_sha256 : null,
      commitSha: typeof props.commit_sha === 'string' ? props.commit_sha : null,
      allowedTools: Array.isArray(props.allowed_tools) ? props.allowed_tools.filter((t): t is string => typeof t === 'string').slice(0, 32) : [],
      publication: 'canonical',
    };
  }

  public async techniqueDetail(id: unknown): Promise<LibraryTechniqueView> {
    const techniqueId = typeof id === 'string' ? id.trim().toUpperCase() : '';
    if (!/^T\d{4}(?:\.\d{3})?$/.test(techniqueId)) throw new ProjectApiError(400, 'A MITRE technique id such as T1003.006 is required.');
    const rows = await this.detailRows(TECHNIQUE_DETAIL_STATEMENT, { id: techniqueId });
    const props = (rows[0]?.[0] ?? null) as Record<string, unknown> | null;
    if (props === null || typeof props !== 'object' || typeof props.id !== 'string') throw new ProjectApiError(404, `Technique ${techniqueId} is not in the canonical corpus.`);
    const related = Array.isArray(rows[0]?.[1]) ? (rows[0]![1] as unknown[]) : [];
    const skills = related
      .filter((s): s is { name: string } => typeof s === 'object' && s !== null && typeof (s as { name?: unknown }).name === 'string')
      .slice(0, 100)
      .map((s) => ({ name: s.name }));
    return {
      id: props.id,
      name: typeof props.name === 'string' ? props.name : null,
      description: typeof props.description === 'string' ? props.description : null,
      url: typeof props.url === 'string' ? props.url : null,
      skills,
    };
  }

  public async library(): Promise<LibraryView> {
    const [skillRows, countRows] = await Promise.all([
      neo4jQuery(this.config, SKILL_STATEMENT, { limit: MAX_SKILLS }),
      neo4jQuery(this.config, COUNT_STATEMENT, {}),
    ]);
    const skills: LibrarySkillView[] = [];
    for (const row of skillRows) {
      const [name, description, subdomain, mitre, whenToUse, path] = row as [unknown, unknown, unknown, unknown, unknown, unknown];
      if (typeof name !== 'string' || name.length === 0) continue;
      skills.push({
        name,
        description: typeof description === 'string' ? description : null,
        subdomain: typeof subdomain === 'string' ? subdomain : null,
        mitreIds: Array.isArray(mitre) ? mitre.filter((m): m is string => typeof m === 'string').slice(0, 24) : [],
        whenToUse: typeof whenToUse === 'string' ? whenToUse : null,
        path: typeof path === 'string' ? path : null,
      });
    }
    const countRow = (countRows[0] ?? []) as [unknown, unknown];
    return {
      skills,
      counts: {
        skills: typeof countRow[0] === 'number' ? countRow[0] : skills.length,
        techniques: typeof countRow[1] === 'number' ? countRow[1] : null,
      },
      excludedActions: LIBRARY_EXCLUDED_ACTIONS,
      sources: { skills: 'knowledge-graph' },
      source: 'graph',
    };
  }

  public async analysis(userId: string, engagementId: string): Promise<AnalysisView> {
    const view = await this.graphs.graph(userId, engagementId);
    const observedMap = new Map<string, { label: string | null; nodeIds: string[] }>();
    for (const node of view.nodes) {
      for (const key of ['technique_id', 'mitre_id']) {
        const id = toTechniqueId(node.properties[key]);
        if (id === null) continue;
        const entry = observedMap.get(id) ?? { label: nodeLabel(node.properties, node.labels), nodeIds: [] };
        if (entry.nodeIds.length < 20) entry.nodeIds.push(node.id);
        observedMap.set(id, entry);
        break;
      }
    }
    const observed = [...observedMap.entries()].slice(0, MAX_OBSERVED).map(([techniqueId, entry]) => ({ techniqueId, label: entry.label, nodeIds: entry.nodeIds }));
    let corpusTechniques: number | null = null;
    let inCorpus: number | null = null;
    if (observed.length > 0) {
      // Corpus lookups are an enrichment, not a hard dependency: when the
      // corpus side of the graph is missing, coverage degrades to an explicit
      // null instead of failing the whole observed read.
      try {
        const countRows = await neo4jQuery(this.config, COUNT_STATEMENT, {});
        const countRow = (countRows[0] ?? []) as [unknown, unknown];
        corpusTechniques = typeof countRow[1] === 'number' ? countRow[1] : null;
        const matchRows = await neo4jQuery(this.config, CORPUS_MATCH_STATEMENT, { ids: observed.map((o) => o.techniqueId) });
        const found = ((matchRows[0]?.[0] ?? []) as unknown[]).filter((id): id is string => typeof id === 'string');
        inCorpus = found.length;
      } catch { /* missing corpus data stays null */ }
    }
    return {
      engagementId,
      observed,
      coverage: { observedTechniques: observed.length, corpusTechniques, inCorpus },
      paths: projectAnalysisPaths(view),
      quality: { graph: view.nodes.length === 0 ? 'empty' : 'available', truncated: view.truncated },
      excludedActions: LIBRARY_EXCLUDED_ACTIONS,
      source: 'graph',
    };
  }
}
