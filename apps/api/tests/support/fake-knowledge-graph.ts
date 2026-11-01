import type { KgHost, KnowledgeGraph } from "../../src/adapters/knowledge-graph/client.js";

export class FakeKnowledgeGraph implements KnowledgeGraph {
  public hostsByEngagement = new Map<string, KgHost[]>();
  public queries: string[] = [];

  public async hostsForEngagement(engagement: string): Promise<KgHost[]> {
    this.queries.push(engagement);
    return this.hostsByEngagement.get(engagement) ?? [];
  }
}
