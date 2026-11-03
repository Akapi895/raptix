import { createHash } from "node:crypto";
import type { GraphNode, GraphResult } from "../adapters/runtime/graph.js";
import type { RuntimeTransport } from "../adapters/runtime/client.js";
import type { ProjectRecord } from "../db/project-store.js";
import type { FactStore, FactRecord } from "../db/fact-store.js";
import { FactConflictError, type FactEvidenceInput } from "../db/fact-verification.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

export function observationSnapshot(engagement: string, node: GraphNode): FactEvidenceInput {
  const snapshotJson = JSON.stringify(canonical({ engagement, kind: node.kind, key: node.key, label: node.label, props: node.props }));
  if (Buffer.byteLength(snapshotJson) > 16_000) throw new FactConflictError();
  const snapshotHash = createHash("sha256").update(snapshotJson).digest("hex");
  return {
    engagement, akgObservationKind: node.kind ?? "", akgObservationKey: node.key ?? "",
    observationId: String(node.props?.observation_id ?? `legacy:${snapshotHash}`),
    provenanceChannel: String(node.props?.provenance_channel ?? "legacy_unknown"), snapshotJson, snapshotHash,
  };
}

export function candidatesWithHashes(engagement: string, response: GraphResult): GraphResult {
  return { ...response, nodes: response.nodes.map(node => ({ ...node, snapshot_hash: observationSnapshot(engagement, node).snapshotHash })) };
}

export interface ProposeFactInput {
  fact_key: string;
  summary?: string;
  body?: string;
  expected_revision?: number;
  observations: { kind: string; key: string; snapshot_hash: string }[];
}

export class FactPromotionService {
  public constructor(private readonly runtime: RuntimeTransport, private readonly facts: FactStore) {}

  public async propose(project: ProjectRecord, input: ProposeFactInput, actor: string): Promise<FactRecord> {
    const existing = await this.facts.findByKey(project.id, input.fact_key);
    const evidence: FactEvidenceInput[] = [];
    for (const reference of input.observations) {
      const response = await this.runtime.queryKnowledgeGraph(project.workspaceSlug, { graph: "runtime", query_type: "observation", params: { kind: reference.kind, key: reference.key, limit: 1 } });
      const node = response.nodes.find(candidate => candidate.kind === reference.kind && candidate.key === reference.key);
      if (!node) throw new MissingObservationError();
      const snapshot = observationSnapshot(project.workspaceSlug, node);
      if (reference.snapshot_hash !== snapshot.snapshotHash) throw new FactConflictError();
      evidence.push(snapshot);
    }
    const first = JSON.parse(evidence[0]!.snapshotJson) as { label?: string };
    return this.facts.propose(project.id, {
      factKey: input.fact_key, category: "finding", summary: input.summary ?? existing?.summary ?? first.label ?? input.fact_key,
      body: input.body ?? existing?.body ?? "", verificationSource: "akg",
    }, evidence, actor, input.expected_revision);
  }
}

export class MissingObservationError extends Error {
  public readonly statusCode = 404;
  public constructor() { super("Observation not found in this project"); }
}
